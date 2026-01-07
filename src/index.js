import { getSecurityHeaders } from '../shared/types/security';
import { createProxyHandler } from '../shared/types/api-proxy';
import { serveFavicon } from '../shared/types/favicon';

const proxyHandler = createProxyHandler();

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Delegate API calls to shared proxy to ensure API_ACCESS headers are injected
    if (url.pathname.startsWith('/api/')) {
      const proxied = await proxyHandler({ request, locals: { runtime: { env } } });
      return applySecurityHeadersJS(proxied);
    }

    function applySecurityHeadersJS(response) {
      const headers = new Headers(response.headers || {});
      const sec = getSecurityHeaders();
      for (const k in sec) headers.set(k, sec[k]);
      return new Response(response.body, { status: response.status || 200, headers });
    }

    if (url.pathname === '/health') {
      const r = new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
      return applySecurityHeadersJS(r);
    }

    if (url.pathname === '/translate' && request.method === 'POST') {
      const { text, from, to } = await request.json();

      if (!text || !to) {
        return new Response(JSON.stringify({ error: 'text and to language required' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      const cacheKey = `trans:${from}:${to}:${text.substring(0, 50)}`;

      try {
        // Check Cache API
        const cached = await caches.default.match(new Request(`https://lingua/${cacheKey}`));
        if (cached) {
          return new Response(cached.body, {
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' }
          });
        }

        // Check KV
        const kvResult = await env.CACHE_KV.get(cacheKey);
        if (kvResult) {
          return new Response(kvResult, {
            headers: { 'Content-Type': 'application/json', 'X-Cache': 'KV' }
          });
        }

        // Call LLM (stub - requires OPENAI_KEY secret)
        const translation = { original: text, translated: `[Translated to ${to}]`, language: to };
        const result = JSON.stringify(translation);

        // Cache in KV
        await env.CACHE_KV.put(cacheKey, result, { expirationTtl: env.CACHE_TTL_SECONDS });

        return new Response(result, {
          headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Translation failed' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Serve favicon via shared handler
    if (url.pathname === '/favicon.ico') {
      return serveFavicon(request, env, proxyHandler, applySecurityHeadersJS);
    }

    return new Response('Not found', { status: 404 });
  }
};
