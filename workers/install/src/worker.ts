/**
 * Serves `scripts/install.sh` from the repo's default branch at a stable URL.
 *
 * This Worker is a supply-chain component: whatever it returns gets piped into `sh`. Everything
 * below follows from that.
 *
 * The single most important property is that a failure must **not** be a 200. `curl -fsSL` aborts
 * on a non-2xx status, so an error page or a truncated body served with a 200 would be executed,
 * while the same thing served as a 502 is simply an install that refuses to start. So: upstream
 * failures propagate as 5xx, unknown paths are 404, and the body is sanity-checked before it is
 * handed back with a 200.
 */
export interface Env {
  /** `owner/repo` to serve from. */
  GITHUB_REPO: string;
  /** Branch, tag or sha used when the request does not pin one. */
  DEFAULT_REF: string;
  /** Path to the script inside the repo. */
  SCRIPT_PATH: string;
  /**
   * Optional fine-grained token with read access to the repo's contents.
   *
   * Only needed while the repo is private: `raw.githubusercontent.com` answers 404 for a private
   * repo with no credential, so without this the Worker has nothing to serve. Set it with
   * `wrangler secret put GITHUB_TOKEN`. When the repo is public, leave it unset and the Worker
   * uses the unauthenticated raw URL, which caches better and cannot leak a credential.
   */
  GITHUB_TOKEN?: string;
}

/** Refs we are willing to interpolate into an upstream URL. */
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/** Seconds to cache at the edge. Short enough that a push to main lands quickly. */
const CACHE_SECONDS = 300;

const text = (body: string, status: number, extra: HeadersInit = {}): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...extra },
  });

export async function handle(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text('Method not allowed.\n', 405, { allow: 'GET, HEAD' });
  }

  const url = new URL(request.url);
  if (url.pathname !== '/install.sh') {
    // A 404 rather than a redirect or a friendly page: anything with a 2xx status could be piped
    // into a shell by someone who mistyped the URL.
    return text(
      `Not found.\n\nInstall the Runta CLI with:\n\n  curl -fsSL ${url.origin}/install.sh | sh\n`,
      404,
    );
  }

  // `?ref=` lets someone pin the installer itself — useful for reproducing an old install, and for
  // testing a change to the script before it reaches the default branch.
  const requestedRef = url.searchParams.get('ref');
  if (requestedRef !== null && !SAFE_REF.test(requestedRef)) {
    return text('Invalid ref.\n', 400);
  }
  const ref = requestedRef ?? env.DEFAULT_REF;

  // The raw host has no way to authenticate, so a private repo has to go through the API.
  const authenticated = Boolean(env.GITHUB_TOKEN);
  const upstream = authenticated
    ? `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.SCRIPT_PATH}?ref=${encodeURIComponent(ref)}`
    : `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${ref}/${env.SCRIPT_PATH}`;

  let response: Response;
  try {
    response = await fetch(upstream, {
      headers: {
        // `raw` on the contents API returns the file itself rather than base64 JSON.
        accept: authenticated ? 'application/vnd.github.raw' : 'text/plain',
        'user-agent': 'runta-install-worker',
        ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
      },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
    });
  } catch (cause) {
    return text(`Could not reach the installer source.\n${String(cause)}\n`, 502);
  }

  if (!response.ok) {
    // 404 from upstream usually means a bad `?ref=`, so pass that through as a 404 and treat
    // everything else as an upstream fault.
    const status = response.status === 404 ? 404 : 502;
    return text(`Installer source returned ${response.status} for ref '${ref}'.\n`, status);
  }

  const script = await response.text();

  // A body that is not a shell script means something replaced it — a GitHub error page, an
  // interstitial, a truncated proxy response. Refusing beats handing it to `sh`.
  if (!script.startsWith('#!/bin/sh') && !script.startsWith('#!/usr/bin/env sh')) {
    return text('Installer source did not return a shell script.\n', 502);
  }

  return new Response(request.method === 'HEAD' ? null : script, {
    status: 200,
    headers: {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': `public, max-age=${CACHE_SECONDS}`,
      'content-length': String(new TextEncoder().encode(script).byteLength),
      // The script is meant to be read before it is run.
      'content-disposition': 'inline; filename="install.sh"',
      'x-runta-ref': ref,
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  fetch: handle,
} satisfies ExportedHandler<Env>;
