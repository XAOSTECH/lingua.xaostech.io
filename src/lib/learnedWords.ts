/**
 * =============================================================================
 * lingua.xaostech.io - Learned Words Storage System
 * =============================================================================
 * Stores unknown words that required AI translation for future dictionary 
 * integration. When 10+ new words accumulate, triggers a GitHub action to 
 * create a PR adding them to the embedded dictionary.
 * 
 * Storage Structure (KV: LEARNED_WORDS_KV):
 * - `word:{word}` -> LearnedWord JSON
 * - `meta:stats` -> { count, lastSync, pendingPR }
 * - `queue:pending` -> Array of pending word keys
 * =============================================================================
 */

export interface LearnedWord {
    word: string;
    sourceLanguage: string;
    translations: Record<string, string>;
    detectedPos?: string;
    firstSeen: string;
    seenCount: number;
    lastSeen: string;
    confidence: number;
    contexts?: string[];
}

export interface LearningStats {
    totalLearned: number;
    pendingCount: number;
    lastSyncToRepo: string | null;
    lastPRNumber: number | null;
    isProcessing: boolean;
}

export interface LearnedWordsEnv {
    LEARNED_WORDS_KV: KVNamespace;
    GITHUB_TOKEN?: string;
    GITHUB_REPO?: string;
}

// Threshold for triggering GitHub PR
const PR_TRIGGER_THRESHOLD = 10;

/**
 * Check if a word has been learned previously
 */
export async function getLearnedWord(
    kv: KVNamespace,
    word: string
): Promise<LearnedWord | null> {
    const key = `word:${word.toLowerCase().trim()}`;
    const data = await kv.get(key);
    return data ? JSON.parse(data) : null;
}

/**
 * Store a newly learned word (after AI translation)
 */
export async function storeLearnedWord(
    kv: KVNamespace,
    word: string,
    translations: Record<string, string>,
    options: {
        sourceLanguage?: string;
        detectedPos?: string;
        confidence?: number;
        context?: string;
    } = {}
): Promise<{ stored: boolean; shouldTriggerPR: boolean; pendingCount: number }> {
    const normalizedWord = word.toLowerCase().trim();
    const key = `word:${normalizedWord}`;

    // Check if word already exists
    const existing = await getLearnedWord(kv, normalizedWord);
    const now = new Date().toISOString();

    if (existing) {
        // Update existing word with new translations and increment count
        const updated: LearnedWord = {
            ...existing,
            translations: { ...existing.translations, ...translations },
            seenCount: existing.seenCount + 1,
            lastSeen: now,
            confidence: Math.min((existing.confidence + (options.confidence || 0.7)) / 2, 1),
            contexts: options.context
                ? [...(existing.contexts || []).slice(-4), options.context]
                : existing.contexts,
        };

        await kv.put(key, JSON.stringify(updated));

        // Get current stats
        const stats = await getStats(kv);
        return { stored: true, shouldTriggerPR: false, pendingCount: stats.pendingCount };
    }

    // Create new learned word
    const newWord: LearnedWord = {
        word: normalizedWord,
        sourceLanguage: options.sourceLanguage || 'en',
        translations,
        detectedPos: options.detectedPos,
        firstSeen: now,
        seenCount: 1,
        lastSeen: now,
        confidence: options.confidence || 0.7,
        contexts: options.context ? [options.context] : undefined,
    };

    await kv.put(key, JSON.stringify(newWord));

    // Add to pending queue
    await addToPendingQueue(kv, normalizedWord);

    // Check if we should trigger PR
    const stats = await getStats(kv);
    const shouldTriggerPR = stats.pendingCount >= PR_TRIGGER_THRESHOLD && !stats.isProcessing;

    return { stored: true, shouldTriggerPR, pendingCount: stats.pendingCount };
}

/**
 * Add word to pending queue
 */
async function addToPendingQueue(kv: KVNamespace, word: string): Promise<void> {
    const queueKey = 'queue:pending';
    const queueData = await kv.get(queueKey);
    const queue: string[] = queueData ? JSON.parse(queueData) : [];

    if (!queue.includes(word)) {
        queue.push(word);
        await kv.put(queueKey, JSON.stringify(queue));

        // Update stats
        await updateStats(kv, { pendingCount: queue.length });
    }
}

/**
 * Get pending words ready for PR
 */
export async function getPendingWords(kv: KVNamespace): Promise<LearnedWord[]> {
    const queueKey = 'queue:pending';
    const queueData = await kv.get(queueKey);
    const queue: string[] = queueData ? JSON.parse(queueData) : [];

    const words: LearnedWord[] = [];
    for (const word of queue) {
        const learned = await getLearnedWord(kv, word);
        if (learned) {
            words.push(learned);
        }
    }

    return words;
}

/**
 * Clear pending queue after successful PR
 */
export async function clearPendingQueue(
    kv: KVNamespace,
    prNumber: number
): Promise<void> {
    await kv.put('queue:pending', JSON.stringify([]));
    await updateStats(kv, {
        pendingCount: 0,
        lastSyncToRepo: new Date().toISOString(),
        lastPRNumber: prNumber,
        isProcessing: false,
    });
}

/**
 * Get learning statistics
 */
export async function getStats(kv: KVNamespace): Promise<LearningStats> {
    const statsKey = 'meta:stats';
    const data = await kv.get(statsKey);

    if (data) {
        return JSON.parse(data);
    }

    return {
        totalLearned: 0,
        pendingCount: 0,
        lastSyncToRepo: null,
        lastPRNumber: null,
        isProcessing: false,
    };
}

/**
 * Update statistics
 */
async function updateStats(
    kv: KVNamespace,
    updates: Partial<LearningStats>
): Promise<void> {
    const current = await getStats(kv);
    const updated = { ...current, ...updates };
    await kv.put('meta:stats', JSON.stringify(updated));
}

/**
 * Mark processing as started (to prevent duplicate PRs)
 */
export async function markProcessing(kv: KVNamespace): Promise<void> {
    await updateStats(kv, { isProcessing: true });
}

/**
 * Get learned translation for a word (returns null if not learned)
 */
export async function getLearnedTranslation(
    kv: KVNamespace,
    word: string,
    targetLang: string
): Promise<string | null> {
    const learned = await getLearnedWord(kv, word);
    if (learned && learned.translations[targetLang]) {
        // Only return if confidence is high enough
        if (learned.confidence >= 0.7 || learned.seenCount >= 3) {
            return learned.translations[targetLang];
        }
    }
    return null;
}

/**
 * Export all learned words in dictionary format
 */
export async function exportAsDict(kv: KVNamespace): Promise<Record<string, any>> {
    const pending = await getPendingWords(kv);
    const dict: Record<string, any> = {};

    for (const word of pending) {
        dict[word.word] = {
            translations: word.translations,
            pos: word.detectedPos,
            frequency: 999, // Unknown frequency, use high number
            learned: true,
            firstSeen: word.firstSeen,
            confidence: word.confidence,
        };
    }

    return dict;
}

/**
 * Generate dictionary entries TypeScript code for PR
 */
export function generateDictEntries(words: LearnedWord[]): string {
    const entries: string[] = [];

    for (const word of words) {
        const translationsStr = Object.entries(word.translations)
            .map(([lang, trans]) => `${lang}: "${trans.replace(/"/g, '\\"')}"`)
            .join(', ');

        entries.push(`    "${word.word}": {
        translations: { ${translationsStr} },
        pos: "${word.detectedPos || 'unknown'}",
        frequency: 999
    }`);
    }

    return entries.join(',\n');
}
