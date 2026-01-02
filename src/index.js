export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' }
      });
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

    // Debug endpoints
    if (url.pathname === '/debug/env') {
      return new Response(JSON.stringify({
        CACHE_KV: !!env.CACHE_KV,
        processEnvHasClientId: !!(globalThis.process && process.env && process.env.CF_ACCESS_CLIENT_ID)
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/debug/fetch-direct') {
      try {
        const clientId = env.CF_ACCESS_CLIENT_ID;
        const clientSecret = env.CF_ACCESS_CLIENT_SECRET;
        const headers = { 'User-Agent': 'XAOSTECH debug fetch' };
        if (clientId && clientSecret) {
          headers['CF-Access-Client-Id'] = clientId;
          headers['CF-Access-Client-Secret'] = clientSecret;
          headers['X-Proxy-CF-Injected'] = 'direct-test';
        }
        const resp = await fetch('https://api.xaostech.io/debug/headers', { method: 'GET', headers });
        const txt = await resp.text();
        return new Response(JSON.stringify({ status: resp.status, bodyStartsWith: txt.slice(0, 200) }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'fetch failed', message: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response('Not found', { status: 404 });
  }
};
