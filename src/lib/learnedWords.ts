/**
 * =============================================================================
 * lingua.xaostech.io - Learned Words Storage System
 * =============================================================================
 * Stores unknown words that required AI translation for future dictionary 
 * integration. Supports configurable PR thresholds and bulk uploads.
 * 
 * Storage Structure (KV: LEARNED_WORDS_KV):
 * - `word:{word}` -> LearnedWord JSON
 * - `meta:stats` -> { count, lastSync, pendingPR, config }
 * - `meta:config` -> { prThreshold, maxBulkSize, autoTrigger }
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
    source?: 'ai' | 'bulk' | 'user'; // How the word was added
}

export interface LearningStats {
    totalLearned: number;
    pendingCount: number;
    lastSyncToRepo: string | null;
    lastPRNumber: number | null;
    isProcessing: boolean;
}

export interface LearningConfig {
    prThreshold: number;      // Words needed to trigger PR (default: 10)
    maxBulkSize: number;      // Max words per bulk upload (default: 1000)
    maxWordsPerPR: number;    // Max words to include in single PR (default: 500)
    autoTrigger: boolean;     // Auto-trigger PR when threshold reached
    minConfidence: number;    // Min confidence for PR inclusion (default: 0.7)
}

export interface LearnedWordsEnv {
    LEARNED_WORDS_KV: KVNamespace;
    GITHUB_TOKEN?: string;
    GITHUB_REPO?: string;
}

// Default configuration
const DEFAULT_CONFIG: LearningConfig = {
    prThreshold: 10,
    maxBulkSize: 1000,
    maxWordsPerPR: 500,
    autoTrigger: true,
    minConfidence: 0.7,
};

// Bulk upload size tiers
export const BULK_TIERS = {
    small: { max: 100, label: 'Small (up to 100 words)' },
    medium: { max: 500, label: 'Medium (up to 500 words)' },
    large: { max: 1000, label: 'Large (up to 1,000 words)' },
    xlarge: { max: 5000, label: 'Extra Large (up to 5,000 words)' },
    unlimited: { max: Infinity, label: 'Unlimited (admin only)' },
} as const;

export type BulkTier = keyof typeof BULK_TIERS;

/**
 * Get current learning configuration
 */
export async function getConfig(kv: KVNamespace): Promise<LearningConfig> {
    const configKey = 'meta:config';
    const data = await kv.get(configKey);
    return data ? { ...DEFAULT_CONFIG, ...JSON.parse(data) } : DEFAULT_CONFIG;
}

/**
 * Update learning configuration
 */
export async function setConfig(
    kv: KVNamespace,
    updates: Partial<LearningConfig>
): Promise<LearningConfig> {
    const current = await getConfig(kv);
    const updated = { ...current, ...updates };
    await kv.put('meta:config', JSON.stringify(updated));
    return updated;
}

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
        source?: 'ai' | 'bulk' | 'user';
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
        source: options.source || 'ai',
    };

    await kv.put(key, JSON.stringify(newWord));

    // Add to pending queue
    await addToPendingQueue(kv, normalizedWord);

    // Check if we should trigger PR based on config
    const [stats, config] = await Promise.all([getStats(kv), getConfig(kv)]);
    const shouldTriggerPR = config.autoTrigger && 
                            stats.pendingCount >= config.prThreshold && 
                            !stats.isProcessing;

    return { stored: true, shouldTriggerPR, pendingCount: stats.pendingCount };
}

/**
 * Bulk upload words - supports large batches with tier-based limits
 */
export interface BulkUploadOptions {
    tier?: BulkTier;
    source?: 'bulk' | 'user';
    sourceLanguage?: string;
    triggerPRThreshold?: number;  // Override default PR threshold for this upload
    skipDuplicates?: boolean;      // Skip words already in queue
}

export interface BulkUploadResult {
    success: boolean;
    added: number;
    updated: number;
    skipped: number;
    errors: Array<{ word: string; error: string }>;
    pendingCount: number;
    shouldTriggerPR: boolean;
    prThreshold: number;
}

export async function bulkUploadWords(
    kv: KVNamespace,
    words: Array<{ word: string; translations: Record<string, string>; pos?: string; confidence?: number }>,
    options: BulkUploadOptions = {}
): Promise<BulkUploadResult> {
    const tier = options.tier || 'medium';
    const maxAllowed = BULK_TIERS[tier].max;
    const config = await getConfig(kv);
    
    // Validate batch size
    if (words.length > maxAllowed && tier !== 'unlimited') {
        return {
            success: false,
            added: 0,
            updated: 0,
            skipped: 0,
            errors: [{ word: '', error: `Batch size ${words.length} exceeds tier limit of ${maxAllowed}` }],
            pendingCount: 0,
            shouldTriggerPR: false,
            prThreshold: config.prThreshold,
        };
    }

    let added = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ word: string; error: string }> = [];
    const now = new Date().toISOString();

    // Process in batches for efficiency
    const batchSize = 50;
    for (let i = 0; i < words.length; i += batchSize) {
        const batch = words.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (item) => {
            try {
                const normalizedWord = item.word.toLowerCase().trim();
                
                // Validate word
                if (!normalizedWord || normalizedWord.length < 2 || normalizedWord.length > 50) {
                    skipped++;
                    return;
                }
                
                const existing = await getLearnedWord(kv, normalizedWord);
                
                if (existing) {
                    if (options.skipDuplicates) {
                        skipped++;
                        return;
                    }
                    // Update existing
                    const updatedWord: LearnedWord = {
                        ...existing,
                        translations: { ...existing.translations, ...item.translations },
                        seenCount: existing.seenCount + 1,
                        lastSeen: now,
                        confidence: item.confidence || existing.confidence,
                    };
                    await kv.put(`word:${normalizedWord}`, JSON.stringify(updatedWord));
                    updated++;
                } else {
                    // Create new
                    const newWord: LearnedWord = {
                        word: normalizedWord,
                        sourceLanguage: options.sourceLanguage || 'en',
                        translations: item.translations,
                        detectedPos: item.pos,
                        firstSeen: now,
                        seenCount: 1,
                        lastSeen: now,
                        confidence: item.confidence || 0.9, // Higher confidence for bulk uploads
                        source: options.source || 'bulk',
                    };
                    await kv.put(`word:${normalizedWord}`, JSON.stringify(newWord));
                    await addToPendingQueue(kv, normalizedWord);
                    added++;
                }
            } catch (err: any) {
                errors.push({ word: item.word, error: err.message });
            }
        }));
    }

    const stats = await getStats(kv);
    const prThreshold = options.triggerPRThreshold || config.prThreshold;
    const shouldTriggerPR = config.autoTrigger && 
                            stats.pendingCount >= prThreshold && 
                            !stats.isProcessing;

    return {
        success: errors.length === 0,
        added,
        updated,
        skipped,
        errors,
        pendingCount: stats.pendingCount,
        shouldTriggerPR,
        prThreshold,
    };
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
