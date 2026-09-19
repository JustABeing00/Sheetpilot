const API_PREFIX = '/api/';
const PROBE_PATHS = new Set(['/healthz', '/readyz']);

function isBackendRequest(pathname) {
  return PROBE_PATHS.has(pathname) || pathname.startsWith(API_PREFIX);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!isBackendRequest(url.pathname)) {
      return env.ASSETS.fetch(request);
    }

    if (!env.API_ORIGIN) {
      return Response.json(
        { error: { code: 'misconfigured', message: 'API_ORIGIN is not configured' } },
        { status: 502 },
      );
    }

    const headers = new Headers(request.headers);
    headers.delete('host');
    if (env.API_KEY) {
      headers.set('x-api-key', env.API_KEY);
    }

    const init = {
      method: request.method,
      headers,
      redirect: 'manual',
    };
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      init.duplex = 'half';
    }

    return fetch(new Request(new URL(url.pathname + url.search, env.API_ORIGIN), init));
  },
};
