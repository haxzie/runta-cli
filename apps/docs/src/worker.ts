/**
 * Serves the built docs site.
 *
 * Static assets do essentially all of it — Cloudflare serves a matching file before this code runs,
 * which is why header rewriting lives in `public/_headers` rather than here. The Worker exists for
 * the one thing assets cannot do: send the bare hostname to `/docs/`, since the site is mounted
 * under that prefix and the apex would otherwise 404.
 */
export interface Env {
  ASSETS: Fetcher;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/' || url.pathname === '/docs') {
    return Response.redirect(`${url.origin}/docs/`, 301);
  }

  return await env.ASSETS.fetch(request);
}

export default { fetch: handle } satisfies ExportedHandler<Env>;
