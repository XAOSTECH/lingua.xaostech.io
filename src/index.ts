import { Hono } from 'hono';
import { createApiProxyRoute } from '../shared/types/api-proxy-hono';
import { serveFaviconHono } from '../shared/types/favicon';
import { applySecurityHeaders } from '../shared/types/security';
import {
  lookupWord,
  translateWord,
  translateWords,
  getSupportedLanguages,
  getDictionaryStats,
  getEtymology as getDictEtymology,
  CORE_DICTIONARY,
  type TranslationResult,
} from './lib/dictionary';
import { getFullEtymology, getDefinitions } from './lib/etymology';

// Cloudflare AI model IDs
const CF_TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b';
const CF_TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CF_TEXT_MODEL_FAST = '@cf/meta/llama-3.1-8b-instruct-fast';

interface Env {
  TRANSLATIONS_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  CACHE_TTL_SECONDS: string;
  AI: Ai; // Cloudflare Workers AI binding
  API_ACCESS_CLIENT_ID?: string;
  API_ACCESS_CLIENT_SECRET?: string;
}

interface TranslationRequest {
  text: string;
  from?: string;
  to: string;
  context?: string;
}

interface TranslationResponse {
  original: string;
  translated: string;
  from_language: string;
  to_language: string;
  cached: boolean;
  source?: 'dictionary' | 'cache' | 'api';
  words?: Array<{
    original: string;
    translated: string;
    hasEtymology: boolean;
  }>;
}

const app = new Hono<{ Bindings: Env }>();

// Global security headers middleware
app.use('*', async (c, next) => {
  await next();
  return applySecurityHeaders(c.res);
});

// ============ LANDING PAGE - DUAL PANEL UI ============
app.get('/', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XAOSTECH Lingua - Translation & Etymology</title>
  <link rel="icon" type="image/png" href="/api/data/assets/XAOSTECH_LOGO.png">
  <style>
    :root {
      --primary: #f6821f;
      --secondary: #3b82f6;
      --bg: #0a0a0a;
      --card: #1a1a1a;
      --border: #333;
      --text: #e0e0e0;
      --muted: #888;
      --success: #22c55e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.6;
    }
    .container { max-width: 1400px; margin: 0 auto; padding: 1rem 2rem; }
    
    /* Header */
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 0;
      border-bottom: 1px solid var(--border);
      margin-bottom: 1.5rem;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .logo h1 {
      color: var(--primary);
      font-size: 1.5rem;
    }
    .logo span { font-size: 1.5rem; }
    .header-links {
      display: flex;
      gap: 1.5rem;
    }
    .header-links a {
      color: var(--muted);
      text-decoration: none;
      font-size: 0.9rem;
    }
    .header-links a:hover { color: var(--primary); }
    
    /* Main Layout - Two Panels */
    .main-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
      min-height: calc(100vh - 200px);
    }
    @media (max-width: 900px) {
      .main-grid {
        grid-template-columns: 1fr;
      }
    }
    
    /* Panel Styling */
    .panel {
      background: var(--card);
      border-radius: 12px;
      border: 1px solid var(--border);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .panel-header {
      background: linear-gradient(90deg, rgba(246,130,31,0.1) 0%, transparent 100%);
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-header h2 {
      font-size: 1.1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .panel-header h2 span { color: var(--primary); }
    .panel-body {
      padding: 1.5rem;
      flex: 1;
      overflow-y: auto;
    }
    
    /* Translation Panel */
    .lang-selector {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .lang-selector select {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 0.6rem 1rem;
      border-radius: 6px;
      font-size: 0.95rem;
    }
    .lang-selector .swap-btn {
      background: none;
      border: 1px solid var(--border);
      color: var(--muted);
      padding: 0.5rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: 1.2rem;
    }
    .lang-selector .swap-btn:hover { color: var(--primary); border-color: var(--primary); }
    
    .text-area {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 1rem;
      border-radius: 8px;
      resize: vertical;
      min-height: 150px;
      font-family: inherit;
      font-size: 1rem;
      line-height: 1.6;
      margin-bottom: 1rem;
    }
    .text-area:focus {
      outline: none;
      border-color: var(--primary);
    }
    
    .btn {
      background: var(--primary);
      color: #000;
      padding: 0.75rem 1.5rem;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      font-size: 1rem;
      transition: all 0.2s;
    }
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    .btn-row {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .btn-secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }
    .btn-secondary:hover { border-color: var(--primary); color: var(--primary); }
    
    /* Translation Output */
    .output-area {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      min-height: 150px;
      margin-top: 1rem;
    }
    .output-area .label {
      font-size: 0.8rem;
      color: var(--muted);
      margin-bottom: 0.5rem;
    }
    .translated-text {
      font-size: 1.1rem;
      line-height: 1.8;
    }
    .translated-word {
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 4px;
      transition: background 0.15s;
      position: relative;
    }
    .translated-word:hover {
      background: rgba(246, 130, 31, 0.2);
    }
    .translated-word.has-etymology::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--primary);
      opacity: 0.5;
    }
    .translated-word.selected {
      background: rgba(246, 130, 31, 0.3);
    }
    
    /* Source Indicator */
    .source-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      background: rgba(34, 197, 94, 0.2);
      color: var(--success);
    }
    .source-badge.api {
      background: rgba(59, 130, 246, 0.2);
      color: var(--secondary);
    }
    
    /* Etymology Panel */
    .etymology-content {
      opacity: 0.6;
      text-align: center;
      padding: 3rem;
    }
    .etymology-content.active {
      opacity: 1;
      text-align: left;
      padding: 0;
    }
    
    .word-title {
      font-size: 2rem;
      color: var(--primary);
      margin-bottom: 0.5rem;
    }
    .word-translation {
      font-size: 1.25rem;
      color: var(--muted);
      margin-bottom: 1.5rem;
    }
    
    .etymology-section {
      margin-bottom: 1.5rem;
    }
    .etymology-section h4 {
      font-size: 0.85rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .etymology-section p {
      font-size: 1rem;
    }
    
    .cognates-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .cognate-tag {
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.85rem;
    }
    .cognate-tag .lang {
      color: var(--muted);
      font-size: 0.75rem;
    }
    
    /* Hover Tooltip */
    .word-tooltip {
      position: absolute;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      z-index: 1000;
      max-width: 300px;
      pointer-events: none;
      opacity: 0;
      transform: translateY(5px);
      transition: opacity 0.15s, transform 0.15s;
    }
    .word-tooltip.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .tooltip-word {
      font-weight: bold;
      color: var(--primary);
    }
    .tooltip-origin {
      font-size: 0.85rem;
      color: var(--muted);
      margin-top: 0.25rem;
    }
    .tooltip-hint {
      font-size: 0.75rem;
      color: var(--secondary);
      margin-top: 0.5rem;
    }
    
    /* Stats Bar */
    .stats-bar {
      display: flex;
      gap: 2rem;
      padding: 0.75rem 1rem;
      background: var(--bg);
      border-radius: 6px;
      margin-top: 1rem;
      font-size: 0.85rem;
    }
    .stat {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .stat-value {
      color: var(--primary);
      font-weight: bold;
    }
    
    /* Footer */
    footer {
      text-align: center;
      padding: 1.5rem;
      color: var(--muted);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
      margin-top: 2rem;
    }
    footer a { color: var(--primary); text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo">
        <span>🌐</span>
        <h1>XAOSTECH Lingua</h1>
      </div>
      <div class="header-links">
        <a href="/languages">Languages</a>
        <a href="https://edu.xaostech.io">Learning</a>
        <a href="https://xaostech.io">XAOSTECH</a>
      </div>
    </header>
    
    <div class="main-grid">
      <!-- Translation Panel (Left) -->
      <div class="panel">
        <div class="panel-header">
          <h2><span>📝</span> Translation</h2>
          <div class="source-badge" id="sourceBadge" style="display:none">
            <span>⚡</span> <span id="sourceText">Dictionary</span>
          </div>
        </div>
        <div class="panel-body">
          <div class="lang-selector">
            <select id="fromLang">
              <option value="auto">Auto-detect</option>
              <option value="en" selected>English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese</option>
              <option value="ko">Korean</option>
              <option value="ar">Arabic</option>
              <option value="ru">Russian</option>
            </select>
            <button class="swap-btn" onclick="swapLanguages()" title="Swap languages">⇄</button>
            <select id="toLang">
              <option value="es" selected>Spanish</option>
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="it">Italian</option>
              <option value="pt">Portuguese</option>
              <option value="ja">Japanese</option>
              <option value="zh">Chinese</option>
              <option value="ko">Korean</option>
              <option value="ar">Arabic</option>
              <option value="ru">Russian</option>
            </select>
          </div>
          
          <textarea id="inputText" class="text-area" placeholder="Enter text to translate..."></textarea>
          
          <div class="btn-row">
            <button class="btn" onclick="translateText()" id="translateBtn">Translate</button>
            <button class="btn btn-secondary" onclick="clearAll()">Clear</button>
          </div>
          
          <div class="output-area" id="outputArea">
            <div class="label">Translation</div>
            <div class="translated-text" id="translatedText">
              <span style="color: var(--muted)">Translation will appear here. Click any word to see its etymology.</span>
            </div>
          </div>
          
          <div class="stats-bar">
            <div class="stat">
              <span>📚</span>
              <span class="stat-value" id="dictWords">${Object.keys(CORE_DICTIONARY).length}</span>
              <span>dictionary words</span>
            </div>
            <div class="stat">
              <span>🌍</span>
              <span class="stat-value">${getSupportedLanguages().length}</span>
              <span>languages</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Etymology Panel (Right) -->
      <div class="panel">
        <div class="panel-header">
          <h2><span>📖</span> Etymology</h2>
        </div>
        <div class="panel-body">
          <div class="etymology-content" id="etymologyContent">
            <p style="font-size: 1.25rem">🔍</p>
            <p style="margin-top: 0.5rem">Click on any translated word<br>to explore its etymology</p>
          </div>
        </div>
      </div>
    </div>
    
    <footer>
      &copy; 2026 XAOSTECH. All rights reserved. |
      <a href="https://edu.xaostech.io">EDU Platform</a> |
      <a href="/health">API Status</a>
    </footer>
  </div>
  
  <!-- Hover Tooltip -->
  <div class="word-tooltip" id="wordTooltip">
    <div class="tooltip-word" id="tooltipWord"></div>
    <div class="tooltip-origin" id="tooltipOrigin"></div>
    <div class="tooltip-hint">Click for full etymology →</div>
  </div>
  
  <script>
    let currentWordData = {};
    let selectedWord = null;
    
    function swapLanguages() {
      const from = document.getElementById('fromLang');
      const to = document.getElementById('toLang');
      if (from.value !== 'auto') {
        [from.value, to.value] = [to.value, from.value];
      }
    }
    
    function clearAll() {
      document.getElementById('inputText').value = '';
      document.getElementById('translatedText').innerHTML = '<span style="color: var(--muted)">Translation will appear here. Click any word to see its etymology.</span>';
      document.getElementById('etymologyContent').innerHTML = '<p style="font-size: 1.25rem">🔍</p><p style="margin-top: 0.5rem">Click on any translated word<br>to explore its etymology</p>';
      document.getElementById('etymologyContent').classList.remove('active');
      document.getElementById('sourceBadge').style.display = 'none';
      currentWordData = {};
      selectedWord = null;
    }
    
    async function translateText() {
      const text = document.getElementById('inputText').value.trim();
      const from = document.getElementById('fromLang').value;
      const to = document.getElementById('toLang').value;
      
      if (!text) return;
      
      const btn = document.getElementById('translateBtn');
      btn.disabled = true;
      btn.textContent = 'Translating...';
      
      try {
        const res = await fetch('/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, from, to })
        });
        const data = await res.json();
        
        if (data.error) {
          document.getElementById('translatedText').innerHTML = '<span style="color: #ef4444">' + data.error + '</span>';
          return;
        }
        
        // Display translated text with clickable words
        displayTranslation(data);
        
        // Show source badge
        const sourceBadge = document.getElementById('sourceBadge');
        const sourceText = document.getElementById('sourceText');
        sourceBadge.style.display = 'inline-flex';
        
        if (data.source === 'dictionary') {
          sourceText.textContent = 'Dictionary (instant)';
          sourceBadge.className = 'source-badge';
        } else if (data.cached) {
          sourceText.textContent = 'Cached';
          sourceBadge.className = 'source-badge';
        } else {
          sourceText.textContent = 'AI Translation';
          sourceBadge.className = 'source-badge api';
        }
        
      } catch (e) {
        document.getElementById('translatedText').innerHTML = '<span style="color: #ef4444">Error: ' + e.message + '</span>';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Translate';
      }
    }
    
    function displayTranslation(data) {
      const container = document.getElementById('translatedText');
      const translated = data.translated;
      currentWordData = {};
      
      // Store word data if available
      if (data.words) {
        for (const w of data.words) {
          currentWordData[w.translated.toLowerCase()] = {
            original: w.original,
            translated: w.translated,
            hasEtymology: w.hasEtymology
          };
        }
      }
      
      // Split into words and wrap each in a span
      const words = translated.split(/(\s+)/);
      let html = '';
      
      for (const word of words) {
        if (/\s+/.test(word)) {
          html += word;
        } else {
          const cleanWord = word.replace(/[.,!?;:'"()\\[\\]{}]/g, '').toLowerCase();
          const wordInfo = currentWordData[cleanWord];
          const hasEtym = wordInfo?.hasEtymology || false;
          
          html += '<span class="translated-word' + (hasEtym ? ' has-etymology' : '') + '" ' +
                  'data-word="' + cleanWord + '" ' +
                  'data-original="' + (wordInfo?.original || cleanWord) + '" ' +
                  'onclick="showEtymology(this)" ' +
                  'onmouseenter="showTooltip(event, this)" ' +
                  'onmouseleave="hideTooltip()">' +
                  word + '</span>';
        }
      }
      
      container.innerHTML = html;
    }
    
    function showTooltip(event, el) {
      const word = el.dataset.original || el.dataset.word;
      const tooltip = document.getElementById('wordTooltip');
      const tooltipWord = document.getElementById('tooltipWord');
      const tooltipOrigin = document.getElementById('tooltipOrigin');
      
      tooltipWord.textContent = word;
      tooltipOrigin.textContent = el.classList.contains('has-etymology') 
        ? 'Etymology available' 
        : 'Click to search etymology';
      
      // Position tooltip
      const rect = el.getBoundingClientRect();
      tooltip.style.left = rect.left + 'px';
      tooltip.style.top = (rect.bottom + 8) + 'px';
      tooltip.classList.add('visible');
    }
    
    function hideTooltip() {
      document.getElementById('wordTooltip').classList.remove('visible');
    }
    
    async function showEtymology(el) {
      // Remove selected class from previous
      document.querySelectorAll('.translated-word.selected').forEach(w => w.classList.remove('selected'));
      el.classList.add('selected');
      
      const word = el.dataset.original || el.dataset.word;
      const container = document.getElementById('etymologyContent');
      
      container.innerHTML = '<p style="text-align: center; color: var(--muted)">Loading etymology...</p>';
      container.classList.add('active');
      
      try {
        const res = await fetch('/etymology', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, language: 'en' })
        });
        const data = await res.json();
        
        displayEtymology(word, el.textContent, data);
      } catch (e) {
        container.innerHTML = '<p style="color: #ef4444">Failed to load etymology: ' + e.message + '</p>';
      }
    }
    
    function displayEtymology(word, translation, data) {
      const container = document.getElementById('etymologyContent');
      
      let html = '<div class="word-title">' + word + '</div>';
      html += '<div class="word-translation">→ ' + translation + '</div>';
      
      // Origin
      if (data.origin || data.etymology?.origin) {
        html += '<div class="etymology-section">';
        html += '<h4>Origin</h4>';
        html += '<p>' + (data.origin || data.etymology?.origin || 'Unknown') + '</p>';
        html += '</div>';
      }
      
      // Original Form
      if (data.originalForm || data.etymology?.originalForm) {
        html += '<div class="etymology-section">';
        html += '<h4>Original Form</h4>';
        html += '<p><em>' + (data.originalForm || data.etymology?.originalForm) + '</em>';
        if (data.meaning || data.etymology?.meaning) {
          html += ' - "' + (data.meaning || data.etymology?.meaning) + '"';
        }
        html += '</p></div>';
      }
      
      // Root
      if (data.root || data.etymology?.root) {
        html += '<div class="etymology-section">';
        html += '<h4>Root</h4>';
        html += '<p>*' + (data.root || data.etymology?.root);
        if (data.rootLanguage || data.etymology?.rootLanguage) {
          html += ' (' + (data.rootLanguage || data.etymology?.rootLanguage) + ')';
        }
        html += '</p></div>';
      }
      
      // Cognates
      const cognates = data.cognates || data.etymology?.cognates;
      if (cognates && cognates.length > 0) {
        html += '<div class="etymology-section">';
        html += '<h4>Cognates</h4>';
        html += '<div class="cognates-list">';
        for (const c of cognates) {
          html += '<span class="cognate-tag">' + c.word + ' <span class="lang">(' + c.language + ')</span></span>';
        }
        html += '</div></div>';
      }
      
      // First Use
      if (data.firstUse || data.firstRecorded || data.etymology?.firstUse) {
        html += '<div class="etymology-section">';
        html += '<h4>First Recorded</h4>';
        html += '<p>' + (data.firstUse || data.firstRecorded || data.etymology?.firstUse) + '</p>';
        html += '</div>';
      }
      
      // Evolution
      const evolution = data.evolution || data.etymology?.evolution;
      if (evolution && evolution.length > 0) {
        html += '<div class="etymology-section">';
        html += '<h4>Evolution</h4>';
        html += '<p>' + evolution.join(' → ') + '</p>';
        html += '</div>';
      }
      
      container.innerHTML = html;
    }
    
    // Handle Enter key in input
    document.getElementById('inputText').addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        translateText();
      }
    });
  </script>
</body>
</html>`;
  return c.html(html);
});

// ============ HEALTH CHECK ============
app.get('/health', (c) => c.json({ status: 'ok', service: 'lingua', dictionary_words: Object.keys(CORE_DICTIONARY).length }));

// ============ API PROXY ============
app.all('/api/*', createApiProxyRoute());

// ============ FAVICON ============
app.get('/favicon.ico', serveFaviconHono);

// Cache version - increment to invalidate old cached translations
const CACHE_VERSION = 'v2';

// ============ TRANSLATION ENDPOINTS ============

// Translate text - Now with dictionary fallback
app.post('/translate', async (c) => {
  try {
    const body = await c.req.json<TranslationRequest>();
    const { text, from = 'auto', to, context } = body;

    if (!text || !to) {
      return c.json({ error: 'text and to language required' }, 400);
    }

    // Check for cache bypass header
    const bypassCache = c.req.header('X-Bypass-Cache') === 'true';

    // Normalize inputs
    const normalizedText = text.trim().substring(0, 5000);
    const cacheKey = `${CACHE_VERSION}:trans:${from}:${to}:${hashString(normalizedText)}`;

    // 1. Check KV cache first (unless bypassed)
    if (!bypassCache) {
      const cached = await c.env.CACHE_KV.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached);
        return c.json({ ...result, cached: true }, 200, {
          'X-Cache': 'HIT',
        });
      }
    }

    // 2. Try dictionary-based translation for simple words/phrases
    const words = normalizedText.toLowerCase().split(/\s+/).filter(w => w.length > 0);

    // Check if ALL words are in dictionary (for short texts)
    if (words.length <= 10 && (from === 'en' || from === 'auto')) {
      const { translated, notFound } = translateWords(words, to);

      // If all words found in dictionary, use dictionary translation
      if (notFound.length === 0 && translated.length === words.length) {
        const translatedText = translated.map(t => t.translated).join(' ');

        const result: TranslationResponse = {
          original: normalizedText,
          translated: translatedText,
          from_language: from === 'auto' ? 'en' : from,
          to_language: to,
          cached: false,
          source: 'dictionary',
          words: translated.map(t => ({
            original: t.original,
            translated: t.translated,
            hasEtymology: !!t.etymology,
          })),
        };

        // Cache the dictionary result
        await c.env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
          expirationTtl: parseInt(c.env.CACHE_TTL_SECONDS) || 86400,
        });

        return c.json(result, 200, {
          'X-Cache': 'MISS',
          'X-Translation-Mode': 'dictionary',
        });
      }
    }

    // 3. Use Cloudflare AI for complex translations (no API key needed)
    // Try partial dictionary translation for words we know
    const partialResult = words.map(word => {
      const dictTranslation = translateWord(word, to);
      return dictTranslation
        ? { word, translated: dictTranslation.translated, source: 'dictionary' as const }
        : { word, translated: word, source: 'unknown' as const };
    });

    const hasUnknown = partialResult.some(r => r.source === 'unknown');
    let translatedText: string;

    if (hasUnknown) {
      // Use CF AI for full translation
      translatedText = await translateWithCF(c, normalizedText, from, to, context);

      const result: TranslationResponse = {
        original: normalizedText,
        translated: translatedText,
        from_language: from,
        to_language: to,
        cached: false,
        source: 'api',
        words: partialResult.map(r => ({
          original: r.word,
          translated: r.translated,
          hasEtymology: !!getDictEtymology(r.word),
        })),
      };

      await c.env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
        expirationTtl: parseInt(c.env.CACHE_TTL_SECONDS) || 86400,
      });

      return c.json(result, 200, {
        'X-Cache': 'MISS',
        'X-Translation-Mode': 'dictionary-partial',
      });
    }

    // 4. Call OpenAI for full translation
    const translation = await translateWithCF(c, normalizedText, from, to, context);

    // Build word data for the response
    const translatedWords = translation.split(/\s+/);
    const wordData = translatedWords.map((tw, i) => {
      const originalWord = words[i] || tw;
      return {
        original: originalWord,
        translated: tw,
        hasEtymology: !!getDictEtymology(originalWord),
      };
    });

    const result: TranslationResponse = {
      original: normalizedText,
      translated: translation,
      from_language: from,
      to_language: to,
      cached: false,
      source: 'api',
      words: wordData,
    };

    // Cache the result
    await c.env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
      expirationTtl: parseInt(c.env.CACHE_TTL_SECONDS) || 86400,
    });

    return c.json(result, 200, {
      'X-Cache': 'MISS',
    });
  } catch (err: any) {
    console.error('[TRANSLATE] Error:', err);
    return c.json({ error: 'Translation failed', message: err.message }, 500);
  }
});

// Batch translate
app.post('/translate/batch', async (c) => {
  try {
    const { texts, to, from = 'auto' } = await c.req.json<{
      texts: string[];
      to: string;
      from?: string;
    }>();

    if (!texts || !Array.isArray(texts) || !to) {
      return c.json({ error: 'texts array and to language required' }, 400);
    }

    if (texts.length > 50) {
      return c.json({ error: 'Maximum 50 texts per batch' }, 400);
    }

    const sourceLanguage = from === 'auto' ? 'en' : from;

    const results = await Promise.all(
      texts.map(async (text) => {
        const trimmedText = text.trim().toLowerCase();
        const cacheKey = `${CACHE_VERSION}:trans:${sourceLanguage}:${to}:${hashString(trimmedText)}`;
        const cached = await c.env.CACHE_KV.get(cacheKey);

        if (cached) {
          return { ...JSON.parse(cached), cached: true };
        }

        // Try dictionary lookup first for single words
        const words = trimmedText.split(/\s+/);
        let translated: string;
        let translationSource: 'dictionary' | 'api' | 'stub' = 'stub';

        if (words.length === 1) {
          // Single word - try dictionary
          const dictResult = translateWord(trimmedText, to);
          if (dictResult && dictResult.translated !== trimmedText) {
            translated = dictResult.translated;
            translationSource = 'dictionary';
          } else {
            // Fall back to CF AI
            translated = await translateWithCF(c, text, sourceLanguage, to);
            translationSource = 'api';
          }
        } else {
          // Multiple words - try word-by-word dictionary, then CF AI
          const dictResults = translateWords(words, to);
          const allFromDict = dictResults.notFound.length === 0;

          if (allFromDict) {
            translated = dictResults.translated.map(r => r.translated).join(' ');
            translationSource = 'dictionary';
          } else {
            // Use CF AI for full translation
            translated = await translateWithCF(c, text, sourceLanguage, to);
            translationSource = 'api';
          }
        }

        const result = {
          original: text,
          translated,
          from_language: sourceLanguage,
          to_language: to,
          source: translationSource,
          cached: false,
        };

        await c.env.CACHE_KV.put(cacheKey, JSON.stringify(result), {
          expirationTtl: parseInt(c.env.CACHE_TTL_SECONDS) || 86400,
        });

        return result;
      })
    );

    return c.json({ translations: results, count: results.length });
  } catch (err: any) {
    console.error('[BATCH] Error:', err);
    return c.json({ error: 'Batch translation failed' }, 500);
  }
});

// Detect language
app.post('/detect', async (c) => {
  try {
    const { text } = await c.req.json<{ text: string }>();

    if (!text) {
      return c.json({ error: 'text required' }, 400);
    }

    // Simple language detection heuristics (would use OpenAI in production)
    const detected = detectLanguage(text);

    return c.json({
      text: text.substring(0, 100),
      detected_language: detected.code,
      confidence: detected.confidence,
    });
  } catch (err: any) {
    console.error('[DETECT] Error:', err);
    return c.json({ error: 'Language detection failed' }, 500);
  }
});

// List supported languages
app.get('/languages', (c) => {
  return c.json({
    languages: SUPPORTED_LANGUAGES,
    default: 'en',
  });
});

// Clear translation cache (admin only)
app.delete('/cache', async (c) => {
  const adminKey = c.req.header('X-Admin-Key');

  // Simple admin check - in production, use proper auth
  if (!adminKey) {
    return c.json({ error: 'Admin key required' }, 401);
  }

  // Note: KV doesn't support bulk delete, would need to track keys
  return c.json({
    message: 'Cache clearing not implemented - KV requires individual key deletion',
    suggestion: 'Set shorter TTL or use Cloudflare Dashboard',
  });
});

// ============ HELPER FUNCTIONS ============

// Language code mapping for m2m100 model
const M2M100_LANG_CODES: Record<string, string> = {
  en: 'en', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt',
  zh: 'zh', ja: 'ja', ko: 'ko', ar: 'ar', ru: 'ru', hi: 'hi',
  nl: 'nl', pl: 'pl', tr: 'tr', vi: 'vi', th: 'th', id: 'id',
  cs: 'cs', ro: 'ro', hu: 'hu', el: 'el', sv: 'sv', da: 'da',
  fi: 'fi', no: 'nb', uk: 'uk', he: 'he', bg: 'bg', hr: 'hr',
};

async function translateWithCF(
  c: any,
  text: string,
  from: string,
  to: string,
  context?: string
): Promise<string> {
  // Map language codes for m2m100
  const sourceLang = M2M100_LANG_CODES[from] || 'en';
  const targetLang = M2M100_LANG_CODES[to];

  if (!targetLang) {
    // Fallback to LLM for unsupported language pairs
    return translateWithCFLLM(c, text, from, to, context);
  }

  try {
    // Try m2m100 translation model first (fast, specialized)
    const result = await c.env.AI.run(CF_TRANSLATION_MODEL, {
      text,
      source_lang: sourceLang,
      target_lang: targetLang,
    }) as { translated_text: string };

    if (result?.translated_text) {
      return result.translated_text;
    }
  } catch (err) {
    console.warn('[CF-TRANSLATE] m2m100 failed, falling back to LLM:', err);
  }

  // Fallback to LLM translation
  return translateWithCFLLM(c, text, from, to, context);
}

async function translateWithCFLLM(
  c: any,
  text: string,
  from: string,
  to: string,
  context?: string
): Promise<string> {
  const systemPrompt = context
    ? `You are a professional translator. Translate the following text from ${from === 'auto' ? 'the detected language' : from} to ${to}. Context: ${context}. Return ONLY the translated text, nothing else.`
    : `You are a professional translator. Translate the following text from ${from === 'auto' ? 'the detected language' : from} to ${to}. Return ONLY the translated text, nothing else.`;

  try {
    // Try fast model first
    const result = await c.env.AI.run(CF_TEXT_MODEL_FAST, {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      max_tokens: 2000,
      temperature: 0.3,
    }) as { response?: string };

    if (result?.response) {
      return result.response.trim();
    }
  } catch (err) {
    console.warn('[CF-LLM] Fast model failed, trying primary:', err);
  }

  // Fallback to primary model
  const result = await c.env.AI.run(CF_TEXT_MODEL, {
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  }) as { response?: string };

  return result?.response?.trim() || text;
}

/**
 * Call CF AI for JSON structured output
 */
async function callCFAIForJSON(
  c: any,
  systemPrompt: string,
  userPrompt: string
): Promise<any> {
  try {
    // Try fast model first
    const result = await c.env.AI.run(CF_TEXT_MODEL_FAST, {
      messages: [
        { role: 'system', content: systemPrompt + '\n\nReturn ONLY valid JSON, no markdown code blocks.' },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    }) as { response?: string };

    if (result?.response) {
      const cleaned = result.response.trim().replace(/```json\n?|\n?```/g, '');
      return JSON.parse(cleaned);
    }
  } catch (err) {
    console.warn('[CF-AI-JSON] Fast model failed:', err);
  }

  // Fallback to primary model
  try {
    const result = await c.env.AI.run(CF_TEXT_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt + '\n\nReturn ONLY valid JSON, no markdown code blocks.' },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    }) as { response?: string };

    if (result?.response) {
      const cleaned = result.response.trim().replace(/```json\n?|\n?```/g, '');
      return JSON.parse(cleaned);
    }
  } catch (err) {
    console.warn('[CF-AI-JSON] Primary model failed:', err);
  }

  return null;
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function detectLanguage(text: string): { code: string; confidence: number } {
  // Simple heuristic detection - would use proper NLP in production
  const patterns: Record<string, RegExp> = {
    zh: /[\u4e00-\u9fff]/,
    ja: /[\u3040-\u309f\u30a0-\u30ff]/,
    ko: /[\uac00-\ud7af]/,
    ar: /[\u0600-\u06ff]/,
    ru: /[\u0400-\u04ff]/,
    he: /[\u0590-\u05ff]/,
    th: /[\u0e00-\u0e7f]/,
    el: /[\u0370-\u03ff]/,
  };

  for (const [code, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      return { code, confidence: 0.8 };
    }
  }

  // Default to English for Latin script
  return { code: 'en', confidence: 0.5 };
}

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'ar', name: 'Arabic' },
  { code: 'ru', name: 'Russian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'pl', name: 'Polish' },
  { code: 'sv', name: 'Swedish' },
  { code: 'da', name: 'Danish' },
  { code: 'no', name: 'Norwegian' },
  { code: 'fi', name: 'Finnish' },
  { code: 'tr', name: 'Turkish' },
  { code: 'he', name: 'Hebrew' },
  { code: 'hi', name: 'Hindi' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'id', name: 'Indonesian' },
  { code: 'ms', name: 'Malay' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'cs', name: 'Czech' },
  { code: 'el', name: 'Greek' },
  { code: 'ro', name: 'Romanian' },
  { code: 'hu', name: 'Hungarian' },
  { code: 'la', name: 'Latin' },
  { code: 'grc', name: 'Ancient Greek' },
  { code: 'sa', name: 'Sanskrit' },
];

// ============ EDUCATIONAL ENDPOINTS ============

// Etymology lookup - traces word origins using Wiktionary + AI fallback
app.post('/etymology', async (c) => {
  try {
    const { word, language = 'en' } = await c.req.json<{ word: string; language?: string }>();

    if (!word) {
      return c.json({ error: 'word required' }, 400);
    }

    // Use the etymology library which handles caching, Wiktionary, and CF AI fallback
    const etymologyData = await getFullEtymology(
      word,
      language,
      c.env.CACHE_KV,
      c.env.AI
    );

    return c.json(etymologyData);
  } catch (err: any) {
    console.error('[ETYMOLOGY] Error:', err);
    return c.json({ error: 'Etymology lookup failed', message: err.message }, 500);
  }
});

// Conjugation tables for verbs
app.post('/conjugate', async (c) => {
  try {
    const { verb, language, tenses = ['present', 'past', 'future'] } = await c.req.json<{
      verb: string;
      language: string;
      tenses?: string[];
    }>();

    if (!verb || !language) {
      return c.json({ error: 'verb and language required' }, 400);
    }

    const cacheKey = `conj:${language}:${hashString(verb)}:${tenses.join('-')}`;
    const cached = await c.env.CACHE_KV.get(cacheKey);

    if (cached) {
      return c.json({ ...JSON.parse(cached), cached: true });
    }

    // Use Cloudflare AI for conjugation
    const systemPrompt = `You are a linguistics expert. Provide verb conjugations in JSON format:
{
  "infinitive": "verb",
  "language": "language",
  "conjugations": {
    "tense_name": {
      "I/1sg": "form",
      "you/2sg": "form",
      "he-she-it/3sg": "form",
      "we/1pl": "form",
      "you-all/2pl": "form",
      "they/3pl": "form"
    }
  },
  "irregularities": ["note1", "note2"],
  "usage_examples": [{"tense": "tense", "example": "sentence", "translation": "english"}]
}
Adapt subject pronouns to the target language conventions.`;

    const conjugationData = await callCFAIForJSON(
      c,
      systemPrompt,
      `Conjugate the ${language} verb "${verb}" in these tenses: ${tenses.join(', ')}`
    );

    if (!conjugationData) {
      return c.json({
        verb,
        language,
        error: 'Failed to generate conjugation data',
        cached: false,
      }, 500);
    }

    const responseData = {
      verb,
      language,
      ...conjugationData,
      cached: false,
    };

    await c.env.CACHE_KV.put(cacheKey, JSON.stringify(responseData), {
      expirationTtl: 604800,
    });

    return c.json(responseData);
  } catch (err: any) {
    console.error('[CONJUGATE] Error:', err);
    return c.json({ error: 'Conjugation failed', message: err.message }, 500);
  }
});

// Word analysis for educational content
app.post('/analyze', async (c) => {
  try {
    const { text, language = 'auto', features = ['pos', 'morphology'] } = await c.req.json<{
      text: string;
      language?: string;
      features?: string[];
    }>();

    if (!text) {
      return c.json({ error: 'text required' }, 400);
    }

    // Use Cloudflare AI for analysis
    const systemPrompt = `You are a linguistics expert. Analyze the text and provide:
{
  "detectedLanguage": "language code",
  "words": [
    {
      "word": "word",
      "lemma": "dictionary form",
      "pos": "part of speech",
      "morphology": {
        "gender": "if applicable",
        "number": "singular/plural",
        "case": "if applicable",
        "tense": "if verb",
        "mood": "if verb"
      },
      "translation": "English translation"
    }
  ],
  "sentence_structure": "brief grammatical analysis",
  "difficulty_level": "beginner/intermediate/advanced"
}`;

    const analysis = await callCFAIForJSON(
      c,
      systemPrompt,
      `Analyze this ${language !== 'auto' ? language : ''} text: "${text}"`
    );

    if (!analysis) {
      return c.json({
        text,
        language,
        error: 'Failed to analyze text',
        cached: false,
      }, 500);
    }

    return c.json({
      text,
      language,
      ...analysis,
      cached: false,
    });
  } catch (err: any) {
    console.error('[ANALYZE] Error:', err);
    return c.json({ error: 'Analysis failed', message: err.message }, 500);
  }
});

// Educational translation - includes learning context
app.post('/translate/educational', async (c) => {
  try {
    const { text, from = 'auto', to, level = 'intermediate' } = await c.req.json<{
      text: string;
      from?: string;
      to: string;
      level?: 'beginner' | 'intermediate' | 'advanced';
    }>();

    if (!text || !to) {
      return c.json({ error: 'text and to language required' }, 400);
    }

    // Use Cloudflare AI for educational translation
    const systemPrompt = `You are an educational translator. Provide translation with learning aids:
{
  "translation": "translated text",
  "literal": "word-for-word translation if helpful",
  "vocabulary": [
    {"source": "word", "target": "translation", "pos": "part of speech", "note": "usage note"}
  ],
  "grammar_points": [
    {"point": "grammar concept", "explanation": "brief explanation", "example": "example"}
  ],
  "cultural_notes": ["relevant cultural context"],
  "difficulty": "${level}"
}
Adapt explanations to ${level} level learners.`;

    const eduTranslation = await callCFAIForJSON(
      c,
      systemPrompt,
      `Translate from ${from === 'auto' ? 'detected language' : from} to ${to}: "${text}"`
    );

    if (!eduTranslation) {
      // Fallback to basic translation
      const basicTranslation = await translateWithCF(c, text, from, to);
      return c.json({
        original: text,
        from_language: from,
        to_language: to,
        level,
        translation: basicTranslation,
        cached: false,
      });
    }

    return c.json({
      original: text,
      from_language: from,
      to_language: to,
      level,
      ...eduTranslation,
      cached: false,
    });
  } catch (err: any) {
    console.error('[TRANSLATE/EDUCATIONAL] Error:', err);
    return c.json({ error: 'Educational translation failed', message: err.message }, 500);
  }
});

// ============ ERROR HANDLING ============
app.notFound((c) => c.json({
  error: 'Not found',
  path: c.req.path,
  availableEndpoints: [
    'POST /translate',
    'POST /translate/batch',
    'POST /translate/educational',
    'POST /detect',
    'POST /etymology',
    'POST /conjugate',
    'POST /analyze',
    'GET /languages',
    'GET /health',
  ],
}, 404));

app.onError((err, c) => {
  console.error('[LINGUA] Error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
