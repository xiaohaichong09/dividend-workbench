# -*- coding: utf-8 -*-
"""一键部署攒股收息工作台到 Cloudflare Pages（含同步 Worker）。

用法：
    py scripts/deploy_cloudflare.py
    py scripts/deploy_cloudflare.py --pages-only
    py scripts/deploy_cloudflare.py --worker-only

API Token 读取顺序：
    1. 环境变量 CLOUDFLARE_API_TOKEN
    2. scripts/cf_token.txt
    3. ../Index 2/tools/cf_token.txt

同步密钥读取顺序：
    1. 环境变量 SYNC_KEY
    2. 项目根目录 同步密钥.txt
    3. 自动生成并写入 同步密钥.txt

依赖：blake3（py -m pip install blake3）
"""
from __future__ import annotations

import base64
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

try:
    import blake3
except ImportError:
    sys.exit("需要 blake3：py -m pip install blake3")

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[1]
API = "https://api.cloudflare.com/client/v4"
DEFAULT_PROJECTS = "dividend-app,dividend"
PROJECTS = [
    p.strip()
    for p in os.environ.get("CF_PAGES_PROJECTS", DEFAULT_PROJECTS).split(",")
    if p.strip()
]
WORKER_NAME = os.environ.get("CF_WORKER_NAME", "dividend-sync")
KV_TITLE = os.environ.get("CF_KV_TITLE", "dividend-workbench")
COMPAT_DATE = os.environ.get("CF_COMPAT_DATE", "2026-10-26")

SITE_GLOBS = (
    ".nojekyll",
    "index.html",
    "404.html",
    "offline.html",
    "manifest.webmanifest",
    "sw.js",
    "css/**/*.css",
    "js/**/*.js",
    "icons/**/*.png",
)


# ---------------------------------------------------------------- 基础工具
def find_token() -> str:
    for key in ("CLOUDFLARE_API_TOKEN", "CF_API_TOKEN"):
        value = os.environ.get(key, "").strip()
        if value:
            return value
    for path in (
        ROOT / "scripts" / "cf_token.txt",
        ROOT.parent / "Index 2" / "tools" / "cf_token.txt",
    ):
        if path.exists():
            value = path.read_text(encoding="utf-8").strip()
            if value:
                return value
    sys.exit(
        "未找到 Cloudflare API Token。\n"
        "请设置环境变量 CLOUDFLARE_API_TOKEN，或把 Token 放到 scripts/cf_token.txt。"
    )


TOKEN = find_token()


def api(
    method: str,
    path: str,
    data=None,
    raw: bytes | None = None,
    headers: dict | None = None,
    token: str | None = None,
    jwt: str | None = None,
):
    hdrs = {"Authorization": "Bearer " + (jwt or token or TOKEN)}
    body = raw
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    hdrs.update(headers or {})
    req = urllib.request.Request(API + path, data=body, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw_text = res.read().decode("utf-8", "replace")
            try:
                return json.loads(raw_text)
            except json.JSONDecodeError:
                return {"success": True, "result": raw_text}
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {"success": False, "errors": [{"message": f"HTTP {e.code}: {text[:300]}"}]}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "errors": [{"message": str(e)}]}


def fail(message: str) -> None:
    print("✗ " + message)
    raise SystemExit(1)


def ok(message: str) -> None:
    print("✓ " + message)


def error_text(result) -> str:
    errors = result.get("errors") or []
    return "; ".join(str(e.get("message", e)) for e in errors)[:500] or "未知错误"


def get_account_id() -> str:
    configured = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "").strip()
    if configured:
        return configured
    result = api("GET", "/accounts")
    accounts = result.get("result") or []
    if not accounts:
        fail("API Token 下没有可用账号")
    return accounts[0]["id"]


def read_sync_key() -> str:
    env = os.environ.get("SYNC_KEY", "").strip()
    if env:
        return env
    key_file = ROOT / "同步密钥.txt"
    if key_file.exists():
        for line in key_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                return line
    key = secrets.token_hex(8)
    key_file.write_text(
        "# 攒股收息 · Cloudflare 同步密钥（勿上传 / 勿外传）\n"
        + key
        + "\n\n# 页面「设置 → 数据同步」里填写这个密钥\n",
        encoding="utf-8",
    )
    return key


# ---------------------------------------------------------------- 文件与哈希
def content_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".txt": "text/plain; charset=utf-8",
    }.get(ext, "application/octet-stream")


def collect_files() -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    for pattern in SITE_GLOBS:
        for path in sorted(ROOT.glob(pattern)):
            if path.is_file():
                files[path.relative_to(ROOT).as_posix()] = path.read_bytes()
    required = {"index.html", "manifest.webmanifest", "sw.js", "js/app.js", "css/style.css"}
    missing = required - set(files)
    if missing:
        fail("缺少文件：" + ", ".join(sorted(missing)))
    return files


def page_hash(data: bytes, path: str) -> str:
    ext = Path(path).suffix.lstrip(".").lower()
    return blake3.blake3(base64.b64encode(data) + ext.encode("utf-8")).hexdigest()[:32]


def multipart(parts) -> tuple[bytes, str]:
    boundary = "----dividend" + secrets.token_hex(12)
    body = bytearray()
    for name, value, ctype, filename in parts:
        body += (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{name}"'
            + (f'; filename="{filename}"' if filename else "")
            + f"\r\nContent-Type: {ctype}\r\n\r\n"
        ).encode("utf-8")
        body += value
        body += b"\r\n"
    body += f"--{boundary}--\r\n".encode("utf-8")
    return bytes(body), f"multipart/form-data; boundary={boundary}"


# ---------------------------------------------------------------- Cloudflare 资源
def ensure_kv(account_id: str) -> str:
    configured = os.environ.get("CF_KV_NAMESPACE_ID", "").strip()
    if configured:
        return configured
    result = api("GET", f"/accounts/{account_id}/storage/kv/namespaces?per_page=100")
    for item in result.get("result") or []:
        if item.get("title") == KV_TITLE:
            ok(f"KV 命名空间：{KV_TITLE} ({item['id']})")
            return item["id"]
    created = api("POST", f"/accounts/{account_id}/storage/kv/namespaces", {"title": KV_TITLE})
    if not created.get("success"):
        fail("创建 KV 失败：" + error_text(created))
    namespace_id = created["result"]["id"]
    ok(f"已创建 KV 命名空间：{KV_TITLE} ({namespace_id})")
    return namespace_id


def ensure_project(account_id: str, project: str) -> dict:
    result = api("GET", f"/accounts/{account_id}/pages/projects/{project}")
    if result.get("success"):
        data = result["result"]
        ok(f"Pages 项目：{project} ({data.get('subdomain') or project + '.pages.dev'})")
        return data
    created = api(
        "POST",
        f"/accounts/{account_id}/pages/projects",
        {"name": project, "production_branch": "main"},
    )
    if not created.get("success"):
        fail(f"创建 Pages 项目 {project} 失败：" + error_text(created))
    ok(f"已创建 Pages 项目：{project}")
    return created["result"]


def bind_project(account_id: str, project: str, kv_id: str, sync_key: str) -> None:
    payload = {
        "deployment_configs": {
            "production": {
                "kv_namespaces": {"KV": {"namespace_id": kv_id}},
                "env_vars": {"SYNC_KEY": {"type": "secret_text", "value": sync_key}},
            }
        }
    }
    result = api("PATCH", f"/accounts/{account_id}/pages/projects/{project}", payload)
    if not result.get("success"):
        fail(f"绑定 KV / SYNC_KEY 失败：{error_text(result)}")
    ok("已绑定 KV 与 SYNC_KEY（Secret）")


# ---------------------------------------------------------------- 上传与部署
def upload_assets(account_id: str, project: str, files: dict[str, bytes]) -> dict[str, str]:
    token_result = api("GET", f"/accounts/{account_id}/pages/projects/{project}/upload-token")
    if not token_result.get("success"):
        fail("获取上传 Token 失败：" + error_text(token_result))
    jwt = token_result["result"]["jwt"]

    manifest = {"/" + path: page_hash(data, path) for path, data in files.items()}
    hashes = list(manifest.values())

    missing_result = api("POST", "/pages/assets/check-missing", {"hashes": hashes}, jwt=jwt)
    if not missing_result.get("success"):
        fail("检查缺失文件失败：" + error_text(missing_result))
    missing = set(missing_result.get("result") or [])
    if not missing:
        ok("静态资源已存在，无需重复上传")
        return manifest

    payload = []
    for path, data in files.items():
        h = manifest["/" + path]
        if h not in missing:
            continue
        payload.append(
            {
                "key": h,
                "value": base64.b64encode(data).decode("ascii"),
                "metadata": {"contentType": content_type(path)},
                "base64": True,
            }
        )

    upload_result = api("POST", "/pages/assets/upload", payload, jwt=jwt)
    if not upload_result.get("success"):
        fail("上传静态资源失败：" + error_text(upload_result))

    upsert_result = api("POST", "/pages/assets/upsert-hashes", {"hashes": hashes}, jwt=jwt)
    if not upsert_result.get("success"):
        fail("登记资源哈希失败：" + error_text(upsert_result))

    ok(f"已上传 {len(payload)} 个静态资源（共 {len(files)} 个）")
    return manifest


def git_info() -> tuple[str, str]:
    try:
        message = subprocess.check_output(
            ["git", "log", "-1", "--pretty=%s"], cwd=ROOT, text=True, encoding="utf-8", errors="replace"
        ).strip()
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, encoding="utf-8", errors="replace"
        ).strip()
        return message or "deploy", commit
    except Exception:  # noqa: BLE001
        return "deploy " + time.strftime("%Y-%m-%d %H:%M:%S"), ""


def deploy_pages(account_id: str, project: str, manifest: dict[str, str]) -> dict:
    message, commit = git_info()
    headers_file = (
        "/*\n"
        "  X-Content-Type-Options: nosniff\n"
        "  X-Frame-Options: DENY\n"
        "  Referrer-Policy: strict-origin-when-cross-origin\n"
        "  Permissions-Policy: geolocation=(), microphone=(), camera=()\n"
        "\n"
        "/sw.js\n"
        "  Cache-Control: no-cache\n"
        "\n"
        "/api/*\n"
        "  Cache-Control: no-store\n"
    )

    parts = [
        ("manifest", json.dumps(manifest).encode("utf-8"), "application/json", None),
        ("branch", b"main", "text/plain", None),
        ("commit_message", message.encode("utf-8"), "text/plain", None),
        ("commit_dirty", b"false", "text/plain", None),
        ("_headers", headers_file.encode("utf-8"), "text/plain", "_headers"),
        (
            "_worker.js",
            (ROOT / "_worker.js").read_bytes(),
            "application/javascript+module",
            "_worker.js",
        ),
    ]
    if commit:
        parts.append(("commit_hash", commit.encode(), "text/plain", None))

    body, ctype = multipart(parts)
    result = api(
        "POST",
        f"/accounts/{account_id}/pages/projects/{project}/deployments",
        raw=body,
        headers={"Content-Type": ctype},
    )
    if not result.get("success"):
        fail(f"创建部署失败：{error_text(result)}")

    deployment = result["result"]
    dep_id = deployment["id"]
    print(f"  部署 ID：{dep_id[:8]}，等待生效…")

    deadline = time.time() + 150
    while time.time() < deadline:
        detail = api(
            "GET", f"/accounts/{account_id}/pages/projects/{project}/deployments/{dep_id}"
        )
        if not detail.get("success"):
            fail("查询部署状态失败：" + error_text(detail))
        data = detail["result"]
        stage = data.get("latest_stage") or {}
        if stage.get("name") == "deploy" and stage.get("status") == "success":
            file_count = len(data.get("files") or {})
            if file_count == 0:
                fail("部署成功但文件数为 0，请检查清单格式")
            if not data.get("uses_functions"):
                fail("部署未启用 Functions，_worker.js 可能没有被识别")
            ok(f"部署成功：{file_count} 个文件，Functions 已启用")
            deployment.update(data)
            return deployment
        if stage.get("status") in ("failure", "canceled"):
            fail(f"部署失败：{stage.get('status')}")
        time.sleep(4)

    fail("部署等待超时，请到 Cloudflare 控制台查看")


def project_url(project_info: dict, project: str) -> str:
    subdomain = project_info.get("subdomain") or f"{project}.pages.dev"
    if not subdomain.endswith(".pages.dev"):
        subdomain += ".pages.dev"
    return "https://" + subdomain


BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36"


def http_get(url: str, headers: dict | None = None, timeout: int = 20):
    hdrs = {"User-Agent": BROWSER_UA, "Accept": "*/*"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


def verify_pages(url: str, sync_key: str) -> bool:
    print("  等待页面生效…")
    home_ok = False
    health_ok = False
    for attempt in range(10):
        time.sleep(4)
        status, body = http_get(url + "/")
        if status == 200 and "攒股收息" in body:
            home_ok = True
        status, body = http_get(url + "/api/health")
        if status == 200:
            try:
                health = json.loads(body)
                health_ok = bool(health.get("ok") and health.get("kv") and health.get("auth"))
            except json.JSONDecodeError:
                health_ok = False
        if home_ok and health_ok:
            break

    if home_ok:
        ok("页面可访问")
    else:
        print("  ! 页面暂时未返回正常内容（可能是 CDN 生效延迟）")
    if health_ok:
        ok("同步接口正常（KV + 密钥均已绑定）")
    else:
        print("  ! 同步接口健康检查未通过，请检查 KV / SYNC_KEY 绑定")

    status, body = http_get(url + "/api/sync", {"X-Auth-Key": sync_key})
    if status in (200, 404):
        ok("同步鉴权正常" + ("（云端暂无数据）" if status == 404 else "（云端已有数据）"))
    elif status == 401:
        print("  ! 同步密钥校验失败")
    else:
        print(f"  ! 同步接口返回 HTTP {status}: {body[:120]}")
    return home_ok and health_ok


# ---------------------------------------------------------------- Worker
def deploy_worker(account_id: str, kv_id: str, sync_key: str) -> str | None:
    worker_file = ROOT / "worker" / "dividend-sync.js"
    if not worker_file.exists():
        print("  跳过：worker/dividend-sync.js 不存在")
        return None

    metadata = {
        "main_module": "dividend-sync.js",
        "compatibility_date": COMPAT_DATE,
        "bindings": [
            {"type": "kv_namespace", "name": "KV", "namespace_id": kv_id},
            {"type": "secret_text", "name": "SYNC_KEY", "text": sync_key},
        ],
    }
    body, ctype = multipart(
        [
            ("metadata", json.dumps(metadata).encode(), "application/json", None),
            (
                "dividend-sync.js",
                worker_file.read_bytes(),
                "application/javascript+module",
                "dividend-sync.js",
            ),
        ]
    )
    result = api(
        "PUT",
        f"/accounts/{account_id}/workers/scripts/{WORKER_NAME}",
        raw=body,
        headers={"Content-Type": ctype},
    )
    if not result.get("success"):
        print("  ! Worker 部署失败：" + error_text(result))
        return None
    ok("已部署独立同步 Worker")

    enabled = api(
        "PUT",
        f"/accounts/{account_id}/workers/scripts/{WORKER_NAME}/subdomain",
        {"enabled": True},
    )
    if not enabled.get("success"):
        print("  ! 当前 API Token 无权启用 workers.dev 子域（可在 Cloudflare 控制台手动开启）")

    sub = api("GET", f"/accounts/{account_id}/workers/subdomain")
    subdomain = ((sub.get("result") or {}).get("subdomain") or "").strip()
    if not subdomain:
        print("  ! 账号还没有 workers.dev 子域，请到控制台启用")
        return None
    url = f"https://{WORKER_NAME}.{subdomain}.workers.dev/api/sync"
    status, _ = http_get(url.replace("/api/sync", "/api/health"))
    if status == 200:
        ok("同步 Worker 地址：" + url)
        return url
    print("  ! Worker 已上传，但 workers.dev 子域暂不可用；页面同域 /api/sync 不受影响")
    return None


# ---------------------------------------------------------------- 主流程
def main() -> None:
    pages_only = "--pages-only" in sys.argv
    worker_only = "--worker-only" in sys.argv

    print("攒股收息 · Cloudflare 部署")
    account_id = get_account_id()
    print("账号 ID：" + account_id)

    sync_key = read_sync_key()
    print("同步密钥：" + sync_key[:4] + "…" + sync_key[-4:] + "（已隐藏）")
    kv_id = ensure_kv(account_id)

    primary_url = ""
    if not worker_only:
        files = collect_files()
        print(f"待部署文件：{len(files)} 个")
        for project in PROJECTS:
            print(f"\n=== Pages 项目：{project} ===")
            info = ensure_project(account_id, project)
            bind_project(account_id, project, kv_id, sync_key)
            manifest = upload_assets(account_id, project, files)
            deploy_pages(account_id, project, manifest)
            url = project_url(info, project)
            if not primary_url:
                primary_url = url
            print("  地址：" + url)
            verify_pages(url, sync_key)

    worker_url = None
    if not pages_only:
        print("\n=== 独立同步 Worker ===")
        worker_url = deploy_worker(account_id, kv_id, sync_key)

    print("\n" + "=" * 56)
    print("部署完成")
    if primary_url:
        print("手机 / 电脑主地址：" + primary_url)
    if worker_url:
        print("备用同步地址：" + worker_url)
    print("同步密钥：见项目根目录 同步密钥.txt（不会上传到 GitHub / 云端）")
    print("手机安装：用浏览器打开主地址 → 添加到主屏幕 / 安装应用")
    print("=" * 56)


if __name__ == "__main__":
    main()
