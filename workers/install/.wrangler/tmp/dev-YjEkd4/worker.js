var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../node_modules/.pnpm/wrangler@4.141.0_@cloudflare+workers-types@5.20260927.1_@types+node@22.20.4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../../node_modules/.pnpm/wrangler@4.141.0_@cloudflare+workers-types@5.20260927.1_@types+node@22.20.4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.141.0_@cloudflare+workers-types@5.20260927.1_@types+node@22.20.4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// src/worker.ts
var SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
var CACHE_SECONDS = 300;
var text = /* @__PURE__ */ __name((body, status, extra = {}) => new Response(body, {
  status,
  headers: { "content-type": "text/plain; charset=utf-8", ...extra }
}), "text");
async function handle(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return text("Method not allowed.\n", 405, { allow: "GET, HEAD" });
  }
  const url = new URL(request.url);
  if (url.pathname !== "/install.sh") {
    return text(
      `Not found.

Install the Runta CLI with:

  curl -fsSL ${url.origin}/install.sh | sh
`,
      404
    );
  }
  const requestedRef = url.searchParams.get("ref");
  if (requestedRef !== null && !SAFE_REF.test(requestedRef)) {
    return text("Invalid ref.\n", 400);
  }
  const ref = requestedRef ?? env.DEFAULT_REF;
  const authenticated = Boolean(env.GITHUB_TOKEN);
  const upstream = authenticated ? `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.SCRIPT_PATH}?ref=${encodeURIComponent(ref)}` : `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${ref}/${env.SCRIPT_PATH}`;
  let response;
  try {
    response = await fetch(upstream, {
      headers: {
        // `raw` on the contents API returns the file itself rather than base64 JSON.
        accept: authenticated ? "application/vnd.github.raw" : "text/plain",
        "user-agent": "runta-install-worker",
        ...env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}
      },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });
  } catch (cause) {
    return text(`Could not reach the installer source.
${String(cause)}
`, 502);
  }
  if (!response.ok) {
    const status = response.status === 404 ? 404 : 502;
    return text(`Installer source returned ${response.status} for ref '${ref}'.
`, status);
  }
  const script = await response.text();
  if (!script.startsWith("#!/bin/sh") && !script.startsWith("#!/usr/bin/env sh")) {
    return text("Installer source did not return a shell script.\n", 502);
  }
  return new Response(request.method === "HEAD" ? null : script, {
    status: 200,
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "content-length": String(new TextEncoder().encode(script).byteLength),
      // The script is meant to be read before it is run.
      "content-disposition": 'inline; filename="install.sh"',
      "x-runta-ref": ref,
      "x-content-type-options": "nosniff"
    }
  });
}
__name(handle, "handle");
var worker_default = {
  fetch: handle
};

// .wrangler/tmp/bundle-TpB9Dj/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// .wrangler/tmp/bundle-TpB9Dj/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name((type, init) => {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default,
  handle
};
//# sourceMappingURL=worker.js.map
