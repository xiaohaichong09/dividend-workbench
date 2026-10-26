/* 攒股收息 · 独立同步 Worker（不是 Pages，可单独部署到 workers.dev）
 *
 * 部署：
 *   cd worker
 *   npx wrangler deploy
 *   npx wrangler secret put SYNC_KEY
 *
 * 绑定：
 *   KV → b3cc120068144f2bad955f594feda484（dividend-workbench）
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Key, X-Client-Version",
  "Access-Control-Max-Age": "86400",
};
const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
const MAX_BODY = 1024 * 1024;

function json(obj, status, extra) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: Object.assign(
      { "Content-Type": "application/json; charset=utf-8" },
      CORS,
      NO_STORE,
      extra || {}
    ),
  });
}

function safeEqual(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (!left || !right || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.stocks)) {
    throw new Error("invalid_state");
  }
  const data = Object.assign({}, raw);
  data.schema = 3;
  data.goal = Math.max(0, Number(data.goal) || 0);
  data.updatedAt = Number(data.updatedAt) || Date.now();
  data.settings = { syncUrl: "", syncKey: "", auto: true };
  return data;
}

async function handleSync(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: Object.assign({}, CORS, NO_STORE) });
  }
  if (!env.KV || !env.SYNC_KEY) {
    return json({ error: "not_configured", message: "KV 或 SYNC_KEY 未绑定" }, 503);
  }

  const key = request.headers.get("X-Auth-Key") || "";
  if (!safeEqual(key, env.SYNC_KEY)) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET" || request.method === "HEAD") {
    const value = await env.KV.get("state");
    if (value == null) return json({ error: "not_found" }, 404);
    return new Response(request.method === "HEAD" ? null : value, {
      status: 200,
      headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS, NO_STORE),
    });
  }

  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > MAX_BODY) return json({ error: "too_large" }, 413);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      return json({ error: "bad_json" }, 400);
    }
    let clean;
    try {
      clean = sanitizeState(parsed);
    } catch (e) {
      return json({ error: "bad_state" }, 400);
    }
    const text = JSON.stringify(clean);
    await env.KV.put("state", text);
    return json({ ok: true, size: text.length, updatedAt: clean.updatedAt }, 200);
  }

  return json({ error: "method_not_allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/api/sync") return await handleSync(request, env);
      if (path === "/api/health" || path === "/") {
        return json({
          ok: true,
          service: "dividend-sync",
          kv: !!env.KV,
          auth: !!env.SYNC_KEY,
          time: new Date().toISOString(),
        });
      }
      return json({ error: "not_found" }, 404);
    } catch (e) {
      return json({ error: "internal_error", message: String(e && e.message ? e.message : e) }, 500);
    }
  },
};
