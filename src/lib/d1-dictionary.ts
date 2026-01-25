/**
 * =============================================================================
 * lingua.xaostech.io - D1 Dictionary Service
 * =============================================================================
 * Provides D1 database access for dictionary lookups with fallback to static data.
 * Supports translations, etymology, and learned words management.
 * =============================================================================
 */

import type { DictionaryEntry, EtymologyData, TranslationResult } from './dictionary';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

// D1Database interface for Cloudflare Workers
interface D1Database {
    prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results?: T[] }>;
    run(): Promise<{ success: boolean }>;
}

export interface D1DictionaryEntry {
    id: number;
    word: string;
    translations_json: string;
    etymology_json: string | null;
    pos: string | null;
    frequency: number;
    variants_json: string | null;
    source_language: string;
    is_core: boolean;
    created_at: string;
    updated_at: string;
}

export interface D1LearnedWord {
    id: number;
    word: string;
    target_language: string;
    translation: string;
    confidence: number;
    source: string;
    verified: boolean;
    created_at: string;
}

// =============================================================================
// D1 SERVICE FUNCTIONS
// =============================================================================

/**
 * Look up a word in the D1 dictionary
 */
export async function lookupWordFromD1(
    db: D1Database,
    word: string
): Promise<DictionaryEntry | null> {
    const normalized = word.toLowerCase().trim();

    const result = await db
        .prepare('SELECT * FROM dictionary_entries WHERE word = ? LIMIT 1')
        .bind(normalized)
        .first<D1DictionaryEntry>();

    if (!result) {
        return null;
    }

    return rowToDictionaryEntry(result);
}

/**
 * Translate a word using D1 dictionary
 */
export async function translateWordFromD1(
    db: D1Database,
    word: string,
    targetLang: string
): Promise<TranslationResult | null> {
    const entry = await lookupWordFromD1(db, word);

    if (!entry || !entry.translations[targetLang]) {
        return null;
    }

    return {
        original: word,
        translated: entry.translations[targetLang],
        source: 'dictionary',
        etymology: entry.etymology,
        confidence: 1.0,
    };
}

/**
 * Translate multiple words from D1
 */
export async function translateWordsFromD1(
    db: D1Database,
    words: string[],
    targetLang: string
): Promise<{ translated: TranslationResult[]; notFound: string[] }> {
    const translated: TranslationResult[] = [];
    const notFound: string[] = [];

    // Batch lookup for efficiency
    const placeholders = words.map(() => '?').join(',');
    const normalizedWords = words.map((w) => w.toLowerCase().trim());

    const results = await db
        .prepare(`SELECT * FROM dictionary_entries WHERE word IN (${placeholders})`)
        .bind(...normalizedWords)
        .all<D1DictionaryEntry>();

    const entriesMap = new Map<string, DictionaryEntry>();
    for (const row of results.results || []) {
        entriesMap.set(row.word, rowToDictionaryEntry(row));
    }

    for (const word of words) {
        const normalized = word.toLowerCase().trim();
        const entry = entriesMap.get(normalized);

        if (entry && entry.translations[targetLang]) {
            translated.push({
                original: word,
                translated: entry.translations[targetLang],
                source: 'dictionary',
                etymology: entry.etymology,
                confidence: 1.0,
            });
        } else {
            notFound.push(word);
        }
    }

    return { translated, notFound };
}

/**
 * Search dictionary entries by pattern
 */
export async function searchDictionaryFromD1(
    db: D1Database,
    query: string,
    options: { limit?: number; pos?: string } = {}
): Promise<Array<{ word: string; entry: DictionaryEntry }>> {
    const { limit = 20, pos } = options;
    const pattern = `%${query.toLowerCase().trim()}%`;

    let sql = 'SELECT * FROM dictionary_entries WHERE word LIKE ?';
    const bindings: (string | number)[] = [pattern];

    if (pos) {
        sql += ' AND pos = ?';
        bindings.push(pos);
    }

    sql += ' ORDER BY frequency ASC LIMIT ?';
    bindings.push(limit);

    const results = await db.prepare(sql).bind(...bindings).all<D1DictionaryEntry>();

    return (results.results || []).map((row) => ({
        word: row.word,
        entry: rowToDictionaryEntry(row),
    }));
}

/**
 * Get dictionary statistics from D1
 */
export async function getDictionaryStatsFromD1(db: D1Database): Promise<{
    wordCount: number;
    languagesSupported: string[];
    categoryCounts: Record<string, number>;
}> {
    // Get total word count
    const countResult = await db
        .prepare('SELECT COUNT(*) as count FROM dictionary_entries')
        .first<{ count: number }>();
    const wordCount = countResult?.count || 0;

    // Get POS distribution
    const posResults = await db
        .prepare('SELECT pos, COUNT(*) as count FROM dictionary_entries GROUP BY pos')
        .all<{ pos: string | null; count: number }>();

    const categoryCounts: Record<string, number> = {};
    for (const row of posResults.results || []) {
        categoryCounts[row.pos || 'unknown'] = row.count;
    }

    // Get supported languages from a sample entry
    const sampleResult = await db
        .prepare('SELECT translations_json FROM dictionary_entries LIMIT 1')
        .first<{ translations_json: string }>();

    let languagesSupported: string[] = [];
    if (sampleResult) {
        try {
            const translations = JSON.parse(sampleResult.translations_json);
            languagesSupported = Object.keys(translations);
        } catch {
            languagesSupported = [];
        }
    }

    return { wordCount, languagesSupported, categoryCounts };
}

/**
 * Get etymology for a word from D1
 */
export async function getEtymologyFromD1(
    db: D1Database,
    word: string
): Promise<EtymologyData | null> {
    const entry = await lookupWordFromD1(db, word);
    return entry?.etymology || null;
}

// =============================================================================
// LEARNED WORDS FUNCTIONS
// =============================================================================

/**
 * Store a learned word in D1
 */
export async function storeLearnedWordInD1(
    db: D1Database,
    word: string,
    targetLanguage: string,
    translation: string,
    confidence: number = 0.9,
    source: string = 'ai'
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO learned_words (word, target_language, translation, confidence, source)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(word, target_language) DO UPDATE SET
         translation = excluded.translation,
         confidence = excluded.confidence`
        )
        .bind(word.toLowerCase().trim(), targetLanguage, translation, confidence, source)
        .run();
}

/**
 * Get a learned translation from D1
 */
export async function getLearnedTranslationFromD1(
    db: D1Database,
    word: string,
    targetLanguage: string
): Promise<string | null> {
    const result = await db
        .prepare(
            'SELECT translation FROM learned_words WHERE word = ? AND target_language = ?'
        )
        .bind(word.toLowerCase().trim(), targetLanguage)
        .first<{ translation: string }>();

    return result?.translation || null;
}

/**
 * Get learned words stats from D1
 */
export async function getLearnedStatsFromD1(db: D1Database): Promise<{
    total: number;
    byLanguage: Record<string, number>;
    verified: number;
}> {
    const totalResult = await db
        .prepare('SELECT COUNT(*) as count FROM learned_words')
        .first<{ count: number }>();

    const byLanguageResults = await db
        .prepare(
            'SELECT target_language, COUNT(*) as count FROM learned_words GROUP BY target_language'
        )
        .all<{ target_language: string; count: number }>();

    const verifiedResult = await db
        .prepare('SELECT COUNT(*) as count FROM learned_words WHERE verified = 1')
        .first<{ count: number }>();

    const byLanguage: Record<string, number> = {};
    for (const row of byLanguageResults.results || []) {
        byLanguage[row.target_language] = row.count;
    }

    return {
        total: totalResult?.count || 0,
        byLanguage,
        verified: verifiedResult?.count || 0,
    };
}

// =============================================================================
// EXPORT FUNCTIONS
// =============================================================================

/**
 * Export all dictionary entries to JSON format
 */
export async function exportDictionaryToJSON(
    db: D1Database,
    options: { coreOnly?: boolean } = {}
): Promise<{
    entries: Array<{ word: string; entry: DictionaryEntry }>;
    exportedAt: string;
    count: number;
}> {
    const { coreOnly = false } = options;

    let sql = 'SELECT * FROM dictionary_entries';
    if (coreOnly) {
        sql += ' WHERE is_core = 1';
    }
    sql += ' ORDER BY frequency ASC';

    const results = await db.prepare(sql).all<D1DictionaryEntry>();

    const entries = (results.results || []).map((row) => ({
        word: row.word,
        entry: rowToDictionaryEntry(row),
    }));

    return {
        entries,
        exportedAt: new Date().toISOString(),
        count: entries.length,
    };
}

/**
 * Export learned words to JSON format
 */
export async function exportLearnedWordsToJSON(
    db: D1Database
): Promise<{
    words: D1LearnedWord[];
    exportedAt: string;
    count: number;
}> {
    const results = await db
        .prepare('SELECT * FROM learned_words ORDER BY word ASC')
        .all<D1LearnedWord>();

    return {
        words: results.results || [],
        exportedAt: new Date().toISOString(),
        count: results.results?.length || 0,
    };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Convert D1 row to DictionaryEntry object
 */
function rowToDictionaryEntry(row: D1DictionaryEntry): DictionaryEntry {
    let translations: Record<string, string> = {};
    let etymology: EtymologyData | undefined;
    let variants: string[] | undefined;

    try {
        translations = JSON.parse(row.translations_json);
    } catch {
        translations = {};
    }

    if (row.etymology_json) {
        try {
            etymology = JSON.parse(row.etymology_json);
        } catch {
            etymology = undefined;
        }
    }

    if (row.variants_json) {
        try {
            variants = JSON.parse(row.variants_json);
        } catch {
            variants = undefined;
        }
    }

    return {
        translations,
        etymology,
        pos: row.pos || undefined,
        frequency: row.frequency,
        variants,
    };
}

/**
 * Add a new dictionary entry to D1
 */
export async function addDictionaryEntry(
    db: D1Database,
    word: string,
    entry: DictionaryEntry,
    isCore: boolean = false
): Promise<void> {
    await db
        .prepare(
            `INSERT INTO dictionary_entries (word, translations_json, etymology_json, pos, frequency, variants_json, is_core)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET
         translations_json = excluded.translations_json,
         etymology_json = excluded.etymology_json,
         pos = excluded.pos,
         frequency = excluded.frequency,
         variants_json = excluded.variants_json,
         updated_at = CURRENT_TIMESTAMP`
        )
        .bind(
            word.toLowerCase().trim(),
            JSON.stringify(entry.translations),
            entry.etymology ? JSON.stringify(entry.etymology) : null,
            entry.pos || null,
            entry.frequency || 999,
            entry.variants ? JSON.stringify(entry.variants) : null,
            isCore ? 1 : 0
        )
        .run();
}
