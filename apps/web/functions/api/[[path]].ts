/**
 * Pages Function — proxy {@code /api/*} requests to the Gateway worker.
 *
 * Uses a Service Binding ({@code GATEWAY_SERVICE}) for zero-cost,
 * in-account routing. This eliminates:
 *   - Build-time hardcoding of the Gateway's workers.dev URL,
 *   - Cross-origin (CORS) requests from the SPA,
 *   - DNS resolution issues for {@code *.workers.dev} domains.
 *
 * The Gateway receives the original path (including the {@code /api/}
 * prefix) and handles auth, rate-limiting, and downstream routing.
 */
interface Env {
  GATEWAY_SERVICE: Fetcher;
}

export async function onRequest(context: {
  request: Request;
  env: Env;
}): Promise<Response> {
  const { request, env } = context;

  if (!env.GATEWAY_SERVICE) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INTERNAL',
          message: 'Gateway service binding is not configured.',
        },
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const url = new URL(request.url);
  // Service Binding {@code fetch} ignores the host component; only the
  // path + querystring are delivered to the bound Worker.
  const targetUrl = `https://internal${url.pathname}${url.search}`;

  // Clone the inbound headers and drop {@code host} (the binding sets
  // its own). Everything else — Content-Type, Authorization, Origin —
  // is forwarded verbatim so the Gateway's CORS + auth logic works.
  const headers = new Headers(request.headers);
  headers.delete('host');

  return env.GATEWAY_SERVICE.fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  });
}
