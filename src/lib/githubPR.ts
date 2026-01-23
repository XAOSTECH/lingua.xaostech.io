/**
 * =============================================================================
 * lingua.xaostech.io - GitHub PR Creator for Learned Words
 * =============================================================================
 * Creates a PR on GitHub to add newly learned words to the dictionary.
 * Called when 10+ new words have been accumulated.
 * =============================================================================
 */

import { LearnedWord, generateDictEntries } from './learnedWords';

interface GitHubConfig {
    token: string;
    owner: string;
    repo: string;
    baseBranch?: string;
}

interface CreatePRResult {
    success: boolean;
    prNumber?: number;
    prUrl?: string;
    error?: string;
}

/**
 * Create a GitHub PR with new dictionary entries
 */
export async function createDictionaryPR(
    config: GitHubConfig,
    words: LearnedWord[]
): Promise<CreatePRResult> {
    const { token, owner, repo, baseBranch = 'main' } = config;

    if (!token || !owner || !repo) {
        return { success: false, error: 'Missing GitHub configuration' };
    }

    if (words.length === 0) {
        return { success: false, error: 'No words to add' };
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
    };

    const branchName = `dictionary-update-${Date.now()}`;

    try {
        // 1. Get base branch ref
        const baseRef = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${baseBranch}`,
            { headers }
        );

        if (!baseRef.ok) {
            const error = await baseRef.text();
            return { success: false, error: `Failed to get base branch: ${error}` };
        }

        const baseRefData = await baseRef.json() as { object: { sha: string } };
        const baseSha = baseRefData.object.sha;

        // 2. Create new branch
        const createBranchRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/git/refs`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    ref: `refs/heads/${branchName}`,
                    sha: baseSha,
                }),
            }
        );

        if (!createBranchRes.ok) {
            const error = await createBranchRes.text();
            return { success: false, error: `Failed to create branch: ${error}` };
        }

        // 3. Get current dictionary.ts content
        const dictFileRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/lingua.xaostech.io/src/lib/dictionary.ts?ref=${baseBranch}`,
            { headers }
        );

        if (!dictFileRes.ok) {
            return { success: false, error: 'Failed to get dictionary.ts' };
        }

        const dictFileData = await dictFileRes.json() as { content: string; sha: string };
        const currentContent = atob(dictFileData.content.replace(/\n/g, ''));

        // 4. Generate new dictionary entries
        const newEntries = generateDictEntries(words);

        // Find the position to insert new entries (after CORE_DICTIONARY = {)
        const insertMarker = 'const CORE_DICTIONARY: Record<string, DictionaryEntry> = {';
        const insertPos = currentContent.indexOf(insertMarker);

        if (insertPos === -1) {
            return { success: false, error: 'Could not find CORE_DICTIONARY in dictionary.ts' };
        }

        // Insert after the opening brace
        const afterBrace = insertPos + insertMarker.length;
        const updatedContent =
            currentContent.slice(0, afterBrace) +
            '\n    // AUTO-LEARNED WORDS (Added ' + new Date().toISOString().split('T')[0] + ')\n' +
            newEntries + ',\n' +
            currentContent.slice(afterBrace);

        // 5. Update file in new branch
        const updateFileRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/lingua.xaostech.io/src/lib/dictionary.ts`,
            {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                    message: `feat(dictionary): Add ${words.length} learned words\n\nWords added:\n${words.map(w => `- ${w.word}`).join('\n')}`,
                    content: btoa(updatedContent),
                    sha: dictFileData.sha,
                    branch: branchName,
                }),
            }
        );

        if (!updateFileRes.ok) {
            const error = await updateFileRes.text();
            return { success: false, error: `Failed to update dictionary.ts: ${error}` };
        }

        // 6. Create PR
        const createPRRes = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/pulls`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    title: `📚 Dictionary Update: ${words.length} New Words`,
                    body: generatePRBody(words),
                    head: branchName,
                    base: baseBranch,
                }),
            }
        );

        if (!createPRRes.ok) {
            const error = await createPRRes.text();
            return { success: false, error: `Failed to create PR: ${error}` };
        }

        const prData = await createPRRes.json() as { number: number; html_url: string };

        return {
            success: true,
            prNumber: prData.number,
            prUrl: prData.html_url,
        };

    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

/**
 * Generate PR body with word details
 */
function generatePRBody(words: LearnedWord[]): string {
    const wordList = words.map(w => {
        const translations = Object.entries(w.translations)
            .slice(0, 5)
            .map(([lang, trans]) => `${lang}: ${trans}`)
            .join(', ');
        return `| ${w.word} | ${w.detectedPos || '-'} | ${translations} | ${w.seenCount} | ${(w.confidence * 100).toFixed(0)}% |`;
    }).join('\n');

    return `## 📚 Auto-Generated Dictionary Update

This PR adds **${words.length} new words** that were learned through AI translation.

### Summary
- **Words Added:** ${words.length}
- **Generated:** ${new Date().toISOString()}
- **Source:** lingua.xaostech.io translation service

### Words

| Word | POS | Sample Translations | Seen | Confidence |
|------|-----|---------------------|------|------------|
${wordList}

### Quality Notes
- All words were translated by Cloudflare AI (m2m100 or LLM fallback)
- Words with confidence < 70% or seen fewer than 3 times are excluded
- Manual review recommended for specialized/technical terms

---
*This PR was automatically generated by the XAOSTECH Lingua learning system.*
`;
}
