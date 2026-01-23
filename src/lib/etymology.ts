/**
 * =============================================================================
 * lingua.xaostech.io - Etymology Engine
 * =============================================================================
 * Fetches etymology data from Wiktionary API and other sources.
 * Caches results in KV for 7 days.
 * =============================================================================
 */

import { EtymologyData, getEtymology as getDictionaryEtymology } from './dictionary';

// Cloudflare Workers KV type (from @cloudflare/workers-types)
// Using interface to avoid import dependency
interface KVNamespace {
    get(key: string, options?: { type?: 'text' }): Promise<string | null>;
    get(key: string, options: { type: 'json' }): Promise<any | null>;
    put(key: string, value: string | ArrayBuffer | ReadableStream, options?: { expirationTtl?: number }): Promise<void>;
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface WiktionaryDefinition {
    partOfSpeech: string;
    language: string;
    definitions: Array<{
        definition: string;
        examples?: string[];
    }>;
}

export interface WiktionaryEntry {
    word: string;
    language: string;
    definitions: WiktionaryDefinition[];
    etymology?: string;
    pronunciations?: string[];
}

export interface FullEtymologyResult {
    word: string;
    language: string;
    etymology: EtymologyData;
    definitions?: Array<{
        partOfSpeech: string;
        meaning: string;
        examples?: string[];
    }>;
    pronunciations?: string[];
    source: 'dictionary' | 'wiktionary' | 'api';
    cached: boolean;
}

// =============================================================================
// WIKTIONARY API INTEGRATION
// =============================================================================

const WIKTIONARY_API_BASE = 'https://en.wiktionary.org/api/rest_v1';

/**
 * Fetch word data from Wiktionary REST API
 */
export async function fetchFromWiktionary(word: string, language = 'en'): Promise<WiktionaryEntry | null> {
    try {
        // Use the definition endpoint
        const url = `${WIKTIONARY_API_BASE}/page/definition/${encodeURIComponent(word)}`;

        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'XAOSTECH-Lingua/1.0 (https://lingua.xaostech.io)',
            },
        });

        if (!response.ok) {
            if (response.status === 404) {
                console.log(`[ETYMOLOGY] Word not found in Wiktionary: ${word}`);
                return null;
            }
            throw new Error(`Wiktionary API error: ${response.status}`);
        }

        const data = await response.json() as Record<string, any>;

        // Parse the Wiktionary response format
        // The API returns language codes as keys
        const languageKey = language === 'en' ? 'en' : language;
        const languageData = data[languageKey] || data['en'];

        if (!languageData || !Array.isArray(languageData)) {
            return null;
        }

        const definitions: WiktionaryDefinition[] = [];
        let etymology: string | undefined;
        const pronunciations: string[] = [];

        for (const entry of languageData) {
            if (entry.partOfSpeech && entry.definitions) {
                definitions.push({
                    partOfSpeech: entry.partOfSpeech,
                    language: entry.language || language,
                    definitions: entry.definitions.map((def: any) => ({
                        definition: cleanWikiMarkup(def.definition || ''),
                        examples: def.examples?.map((ex: any) => cleanWikiMarkup(ex)),
                    })),
                });
            }

            // Extract etymology if present
            if (entry.etymology) {
                etymology = cleanWikiMarkup(entry.etymology);
            }

            // Extract pronunciations
            if (entry.pronunciations?.value) {
                pronunciations.push(entry.pronunciations.value);
            }
        }

        return {
            word,
            language,
            definitions,
            etymology,
            pronunciations: pronunciations.length > 0 ? pronunciations : undefined,
        };
    } catch (error) {
        console.error('[ETYMOLOGY] Wiktionary fetch error:', error);
        return null;
    }
}

/**
 * Clean MediaWiki markup from text
 */
function removeHtmlTags(text: string): string {
    if (!text) return '';

    let previous: string;
    let current = text;

    // Repeatedly remove HTML-like tags until no more matches are found.
    // This avoids incomplete multi-character sanitization where removing one
    // tag instance could reveal another.
    do {
        previous = current;
        current = current.replace(/<[^>]+>/g, '');
    } while (current !== previous);

    return current;
}

function cleanWikiMarkup(text: string): string {
    if (!text) return '';

    let cleaned = text
        // Remove wiki links: [[link|display]] -> display, [[link]] -> link
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        // Remove templates: {{template}}
        .replace(/\{\{[^}]+\}\}/g, '');

    // Remove HTML tags (including nested/overlapping patterns)
    cleaned = removeHtmlTags(cleaned);

    return cleaned
        // Remove any remaining angle brackets to prevent tag/script injection
        .replace(/[<>]/g, '')
        // Clean up extra whitespace
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Parse etymology text into structured data
 */
function parseEtymologyText(etymologyText: string, word: string): EtymologyData {
    const etymology: EtymologyData = {
        origin: 'Unknown',
    };

    if (!etymologyText) {
        return etymology;
    }

    // Try to extract origin language
    const languagePatterns = [
        /(?:from|derived from|borrowed from|via)\s+(?:the\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:origin|root|word)/i,
        /(?:Old|Middle|Proto-|Ancient)\s*([A-Z][a-z]+)/i,
    ];

    for (const pattern of languagePatterns) {
        const match = etymologyText.match(pattern);
        if (match) {
            etymology.origin = match[1] || match[0];
            break;
        }
    }

    // Try to extract original form
    const originalFormPatterns = [
        /["']([^"']+)["']/,
        /\*([a-zA-Z]+)/,  // Reconstructed forms marked with *
    ];

    for (const pattern of originalFormPatterns) {
        const match = etymologyText.match(pattern);
        if (match) {
            etymology.originalForm = match[1];
            break;
        }
    }

    // Extract meaning if present
    const meaningPatterns = [
        /meaning\s+["']?([^"'.]+)["']?/i,
        /["']([^"']+)["']\s*\(([^)]+)\)/,
    ];

    for (const pattern of meaningPatterns) {
        const match = etymologyText.match(pattern);
        if (match) {
            etymology.meaning = match[1] || match[2];
            break;
        }
    }

    // Extract root if present
    const rootPatterns = [
        /root\s+\*?([a-zA-Z]+)/i,
        /Proto-[A-Z][a-z]+\s+\*([a-zA-Z]+)/i,
    ];

    for (const pattern of rootPatterns) {
        const match = etymologyText.match(pattern);
        if (match) {
            etymology.root = match[1];
            break;
        }
    }

    // Try to find cognates
    const cognatePattern = /(?:cognate|related|cf\.?)\s+(?:with\s+)?([^.;]+)/gi;
    const cognates: Array<{ word: string; language: string }> = [];
    let cognateMatch;

    while ((cognateMatch = cognatePattern.exec(etymologyText)) !== null) {
        const parts = cognateMatch[1].split(/,|and/).map(s => s.trim());
        for (const part of parts) {
            const langWord = part.match(/([A-Z][a-z]+)\s+["']?([^"',]+)["']?/);
            if (langWord) {
                cognates.push({ language: langWord[1], word: langWord[2] });
            }
        }
    }

    if (cognates.length > 0) {
        etymology.cognates = cognates;
    }

    // Extract first recorded use date
    const datePatterns = [
        /(?:first\s+(?:recorded|attested|used)\s+(?:in\s+)?)?(\d{4})/,
        /(?:c\.|circa|about)\s*(\d{4})/,
        /(\d{1,2}(?:th|st|nd|rd)\s+century)/i,
    ];

    for (const pattern of datePatterns) {
        const match = etymologyText.match(pattern);
        if (match) {
            etymology.firstUse = match[1];
            break;
        }
    }

    return etymology;
}

// Cloudflare AI interface
interface Ai {
    run(model: string, input: any): Promise<any>;
}

// Cloudflare AI model for text generation
const CF_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CF_TEXT_MODEL_FAST = '@cf/meta/llama-3.1-8b-instruct-fast';

// =============================================================================
// MAIN ETYMOLOGY FUNCTIONS
// =============================================================================

/**
 * Get full etymology for a word
 * Priority: 1. Local dictionary 2. KV cache 3. Wiktionary API 4. CF AI fallback
 */
export async function getFullEtymology(
    word: string,
    language: string,
    kv: KVNamespace | null,
    ai?: Ai
): Promise<FullEtymologyResult> {
    const normalizedWord = word.toLowerCase().trim();

    // 1. Check local dictionary first (instant)
    const localEtymology = getDictionaryEtymology(normalizedWord);
    if (localEtymology) {
        return {
            word: normalizedWord,
            language,
            etymology: localEtymology,
            source: 'dictionary',
            cached: false,
        };
    }

    // 2. Check KV cache
    const cacheKey = `etym:${language}:${normalizedWord}`;
    if (kv) {
        try {
            const cached = await kv.get(cacheKey);
            if (cached) {
                const result = JSON.parse(cached) as FullEtymologyResult;
                return { ...result, cached: true };
            }
        } catch (e) {
            console.warn('[ETYMOLOGY] Cache read error:', e);
        }
    }

    // 3. Fetch from Wiktionary
    const wiktionaryData = await fetchFromWiktionary(normalizedWord, language);

    if (wiktionaryData && wiktionaryData.etymology) {
        const etymology = parseEtymologyText(wiktionaryData.etymology, normalizedWord);

        const result: FullEtymologyResult = {
            word: normalizedWord,
            language,
            etymology,
            definitions: wiktionaryData.definitions?.flatMap(d =>
                d.definitions.map(def => ({
                    partOfSpeech: d.partOfSpeech,
                    meaning: def.definition,
                    examples: def.examples,
                }))
            ),
            pronunciations: wiktionaryData.pronunciations,
            source: 'wiktionary',
            cached: false,
        };

        // Cache the result (7 days)
        if (kv) {
            try {
                await kv.put(cacheKey, JSON.stringify(result), {
                    expirationTtl: 604800, // 7 days
                });
            } catch (e) {
                console.warn('[ETYMOLOGY] Cache write error:', e);
            }
        }

        return result;
    }

    // 4. Fall back to CF AI if available
    if (ai) {
        try {
            const aiEtymology = await fetchEtymologyFromCFAI(normalizedWord, language, ai);
            if (aiEtymology) {
                const result: FullEtymologyResult = {
                    word: normalizedWord,
                    language,
                    etymology: aiEtymology,
                    source: 'api',
                    cached: false,
                };

                // Cache AI results too
                if (kv) {
                    await kv.put(cacheKey, JSON.stringify(result), {
                        expirationTtl: 604800,
                    });
                }

                return result;
            }
        } catch (e) {
            console.error('[ETYMOLOGY] CF AI fallback error:', e);
        }
    }

    // 5. Return minimal result if nothing found
    return {
        word: normalizedWord,
        language,
        etymology: {
            origin: 'Unknown',
        },
        source: 'dictionary',
        cached: false,
    };
}

/**
 * Fetch etymology from Cloudflare AI as a last resort
 */
async function fetchEtymologyFromCFAI(
    word: string,
    language: string,
    ai: Ai
): Promise<EtymologyData | null> {
    const systemPrompt = `You are an expert etymologist. Provide word etymology in JSON format:
{
  "origin": "language of origin (e.g., 'Old English', 'Latin', 'Greek')",
  "originalForm": "word in original language",
  "meaning": "original meaning",
  "root": "root word if applicable",
  "rootLanguage": "Proto-language name if applicable",
  "cognates": [{"word": "cognate", "language": "language"}],
  "firstUse": "approximate date or period",
  "evolution": ["stage1", "stage2"]
}
Return only valid JSON, no other text.`;

    try {
        // Try fast model first
        const result = await ai.run(CF_TEXT_MODEL_FAST, {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Etymology for the ${language} word: "${word}"` },
            ],
            max_tokens: 800,
            temperature: 0.2,
        }) as { response?: string };

        if (result?.response) {
            const cleaned = result.response.trim().replace(/```json\n?|\n?```/g, '');
            return JSON.parse(cleaned) as EtymologyData;
        }
    } catch (err) {
        console.warn('[ETYMOLOGY] Fast CF model failed, trying primary:', err);
    }

    // Fallback to primary model
    try {
        const result = await ai.run(CF_TEXT_MODEL, {
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: `Etymology for the ${language} word: "${word}"` },
            ],
            max_tokens: 800,
            temperature: 0.2,
        }) as { response?: string };

        if (result?.response) {
            const cleaned = result.response.trim().replace(/```json\n?|\n?```/g, '');
            return JSON.parse(cleaned) as EtymologyData;
        }
    } catch (err) {
        console.warn('[ETYMOLOGY] Primary CF model failed:', err);
    }

    return null;
}

/**
 * Get word definitions (without full etymology)
 */
export async function getDefinitions(
    word: string,
    language: string
): Promise<Array<{ partOfSpeech: string; meaning: string; examples?: string[] }> | null> {
    const wiktionaryData = await fetchFromWiktionary(word, language);

    if (!wiktionaryData?.definitions) {
        return null;
    }

    return wiktionaryData.definitions.flatMap(d =>
        d.definitions.map(def => ({
            partOfSpeech: d.partOfSpeech,
            meaning: def.definition,
            examples: def.examples,
        }))
    );
}

/**
 * Get related words (cognates, derivatives)
 */
export async function getRelatedWords(
    word: string,
    language: string,
    kv: KVNamespace | null
): Promise<{
    cognates: Array<{ word: string; language: string }>;
    derivatives: string[];
    synonyms: string[];
}> {
    const etymology = await getFullEtymology(word, language, kv);

    return {
        cognates: etymology.etymology.cognates || [],
        derivatives: [], // Would need more data sources
        synonyms: [], // Would need thesaurus integration
    };
}
