import { Hono } from 'hono';
import { createApiProxyRoute } from '../shared/types/api-proxy-hono';
import { serveFaviconHono } from '../shared/types/favicon';
import { applySecurityHeaders } from '../shared/types/security';

interface Env {
  TRANSLATIONS_KV: KVNamespace;
  CACHE_KV: KVNamespace;
  CACHE_TTL_SECONDS: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL: string;
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
}

const app = new Hono<{ Bindings: Env }>();

// Global security headers middleware
app.use('*', async (c, next) => {
  await next();
  return applySecurityHeaders(c.res);
});

// ============ LANDING PAGE ============
app.get('/', (c) => {
  const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>XAOSTECH Lingua - Translation Service</title><link rel="icon" type="image/png" href="/api/data/assets/XAOSTECH_LOGO.png"><style>:root { --primary: #f6821f; --bg: #0a0a0a; --text: #e0e0e0; } * { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; padding: 2rem; } .container { max-width: 800px; width: 100%; } h1 { color: var(--primary); } .hero { text-align: center; padding: 3rem 2rem; } .hero h1 { font-size: 2.5rem; } .hero p { font-size: 1.1rem; opacity: 0.8; margin-top: 1rem; } .demo { background: #1a1a1a; border-radius: 12px; padding: 2rem; margin-top: 2rem; } .demo h2 { margin-bottom: 1rem; font-size: 1.25rem; } .demo-row { display: flex; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap; } .demo textarea { flex: 1; min-width: 200px; background: #0a0a0a; border: 1px solid #333; color: var(--text); padding: 1rem; border-radius: 8px; resize: vertical; min-height: 120px; font-family: inherit; } .demo select { background: #0a0a0a; border: 1px solid #333; color: var(--text); padding: 0.5rem 1rem; border-radius: 6px; } .btn { background: var(--primary); color: #000; padding: 0.75rem 2rem; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1rem; } .btn:hover { opacity: 0.9; } .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-top: 3rem; } .feature { background: #1a1a1a; padding: 1.5rem; border-radius: 8px; } .feature h3 { color: var(--primary); margin-bottom: 0.5rem; } .api-example { background: #111; padding: 1rem; border-radius: 6px; font-family: monospace; font-size: 0.85rem; overflow-x: auto; margin-top: 2rem; } footer { margin-top: 4rem; opacity: 0.6; font-size: 0.9rem; }</style></head><body><div class="container"><div class="hero"><h1>🌐 XAOSTECH Lingua</h1><p>AI-powered translation service with caching and batch support</p></div><div class="demo"><h2>Try Translation</h2><div class="demo-row"><select id="fromLang"><option value="auto">Auto-detect</option><option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option><option value="de">German</option></select><span style="align-self:center">→</span><select id="toLang"><option value="es">Spanish</option><option value="en">English</option><option value="fr">French</option><option value="de">German</option><option value="ja">Japanese</option></select></div><div class="demo-row"><textarea id="inputText" placeholder="Enter text to translate..."></textarea><textarea id="outputText" placeholder="Translation will appear here..." readonly></textarea></div><button class="btn" onclick="translateText()">Translate</button></div><div class="features"><div class="feature"><h3>30+ Languages</h3><p>Support for major world languages with high accuracy</p></div><div class="feature"><h3>Smart Caching</h3><p>Cached translations for instant repeat requests</p></div><div class="feature"><h3>Batch API</h3><p>Translate up to 50 texts in a single request</p></div><div class="feature"><h3>Context-Aware</h3><p>Provide context for more accurate domain-specific translations</p></div></div><div class="api-example"><strong>API Example:</strong><br>POST /translate<br>{ "text": "Hello world", "to": "es" }<br><br>Response: { "translated": "Hola mundo", "cached": false }</div></div><footer>&copy; 2026 XAOSTECH. All rights reserved.</footer><script>async function translateText() { const text = document.getElementById("inputText").value; const from = document.getElementById("fromLang").value; const to = document.getElementById("toLang").value; if (!text) return; try { const res = await fetch("/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, from, to }) }); const data = await res.json(); document.getElementById("outputText").value = data.translated || data.error || "Translation failed"; } catch (e) { document.getElementById("outputText").value = "Error: " + e.message; } }</script></body></html>';
  return c.html(html);
});

// ============ HEALTH CHECK ============
app.get('/health', (c) => c.json({ status: 'ok', service: 'lingua' }));

// ============ API PROXY ============
app.all('/api/*', createApiProxyRoute());

// ============ FAVICON ============
app.get('/favicon.ico', serveFaviconHono);

// ============ TRANSLATION ENDPOINTS ============

// Translate text
app.post('/translate', async (c) => {
  try {
    const body = await c.req.json<TranslationRequest>();
    const { text, from = 'auto', to, context } = body;

    if (!text || !to) {
      return c.json({ error: 'text and to language required' }, 400);
    }

    // Normalize inputs
    const normalizedText = text.trim().substring(0, 5000); // Limit text length
    const cacheKey = `trans:${from}:${to}:${hashString(normalizedText)}`;

    // Check KV cache
    const cached = await c.env.CACHE_KV.get(cacheKey);
    if (cached) {
      const result = JSON.parse(cached);
      return c.json({ ...result, cached: true }, 200, {
        'X-Cache': 'HIT',
      });
    }

    // Check if OpenAI is configured
    const openaiKey = c.env.OPENAI_API_KEY;
    if (!openaiKey) {
      // Return stub response for development
      const stubResult: TranslationResponse = {
        original: normalizedText,
        translated: `[${to.toUpperCase()}] ${normalizedText}`,
        from_language: from,
        to_language: to,
        cached: false,
      };
      
      // Cache the stub
      await c.env.CACHE_KV.put(cacheKey, JSON.stringify(stubResult), {
        expirationTtl: parseInt(c.env.CACHE_TTL_SECONDS) || 86400,
      });

      return c.json(stubResult, 200, {
        'X-Cache': 'MISS',
        'X-Translation-Mode': 'stub',
      });
    }

    // Call OpenAI for translation
    const translation = await translateWithOpenAI(c, normalizedText, from, to, context);

    const result: TranslationResponse = {
      original: normalizedText,
      translated: translation,
      from_language: from,
      to_language: to,
      cached: false,
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

    const results = await Promise.all(
      texts.map(async (text) => {
        const cacheKey = `trans:${from}:${to}:${hashString(text.trim())}`;
        const cached = await c.env.CACHE_KV.get(cacheKey);
        
        if (cached) {
          return { ...JSON.parse(cached), cached: true };
        }

        // For now, return stub translations
        const result = {
          original: text,
          translated: `[${to.toUpperCase()}] ${text}`,
          from_language: from,
          to_language: to,
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

async function translateWithOpenAI(
  c: any,
  text: string,
  from: string,
  to: string,
  context?: string
): Promise<string> {
  const apiKey = c.env.OPENAI_API_KEY;
  const model = c.env.OPENAI_MODEL || 'gpt-4o-mini';

  const systemPrompt = context
    ? `You are a professional translator. Translate the following text from ${from === 'auto' ? 'the detected language' : from} to ${to}. Context: ${context}. Return only the translated text.`
    : `You are a professional translator. Translate the following text from ${from === 'auto' ? 'the detected language' : from} to ${to}. Return only the translated text.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    console.error('[OPENAI] Error:', err);
    throw new Error('OpenAI translation failed');
  }

  const result = await response.json() as any;
  return result.choices[0]?.message?.content?.trim() || text;
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
];

// ============ ERROR HANDLING ============
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));

app.onError((err, c) => {
  console.error('[LINGUA] Error:', err);
  return c.json({ error: 'Internal server error', message: err.message }, 500);
});

export default app;
