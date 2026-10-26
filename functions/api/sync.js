// 攒股收息 · 数据同步 Pages Function(同域 /api/sync,KV 存状态 JSON)
// GET 取 / PUT 存,请求头 X-Auth-Key 需与部署时设置的 SYNC_KEY 匹配。
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Auth-Key",
};

const j = (obj, status) => new Response(JSON.stringify(obj), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

function authed(request, env) {
  const key = request.headers.get("X-Auth-Key") || "";
  return !!(env.SYNC_KEY && key === env.SYNC_KEY);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ request, env }) {
  if (!authed(request, env)) return j({ error: "unauthorized" }, 401);
  const v = await env.KV.get("state");
  if (v == null) return j({ error: "not_found" }, 404);
  return new Response(v, { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
}

export async function onRequestPut({ request, env }) {
  if (!authed(request, env)) return j({ error: "unauthorized" }, 401);
  const body = await request.text();
  if (body.length > 512 * 1024) return j({ error: "too_large" }, 413);
  try { JSON.parse(body); } catch { return j({ error: "bad_json" }, 400); }
  await env.KV.put("state", body);
  return j({ ok: true, size: body.length }, 200);
}
