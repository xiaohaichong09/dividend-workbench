// 攒股收息 · Pages 直传函数(_worker.js 高级模式)
// /api/sync → KV 存取(需 X-Auth-Key 与部署时设置的 SYNC_KEY 匹配);其余请求回源静态资源。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Key",
};

const j = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

async function handleSync(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const key = request.headers.get("X-Auth-Key") || "";
  if (!env.SYNC_KEY || key !== env.SYNC_KEY) return j({ error: "unauthorized" }, 401);

  if (request.method === "GET") {
    const v = await env.KV.get("state");
    if (v == null) return j({ error: "not_found" }, 404);
    return new Response(v, { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (request.method === "PUT") {
    const body = await request.text();
    if (body.length > 512 * 1024) return j({ error: "too_large" }, 413);
    try { JSON.parse(body); } catch { return j({ error: "bad_json" }, 400); }
    await env.KV.put("state", body);
    return j({ ok: true, size: body.length }, 200);
  }
  return j({ error: "method_not_allowed" }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/sync") return handleSync(request, env);
    return env.ASSETS.fetch(request);
  },
};
