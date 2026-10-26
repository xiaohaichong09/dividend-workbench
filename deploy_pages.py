# -*- coding: utf-8 -*-
"""
将攒股收息工作台部署到 Cloudflare Pages(直传文件,含 Functions 目录)。
流程:绑定 KV + 同步密钥 → 上传部署(blake3 哈希清单)→ 等待生效 → 输出网址。
Token: ../Index 2/tools/cf_token.txt(模板"编辑 Cloudflare Workers")。用法: py deploy_pages.py
"""
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(os.path.dirname(BASE), "Index 2", "tools", "cf_token.txt")
ACCOUNT = "5cb2e64101b467bd1637c7e6a1ad859d"
PROJECT = "dividend"
KV_ID = "b3cc120068144f2bad955f594feda484"  # dividend-workbench

SITE_FILES = [
    "index.html",
    "css/style.css",
    "js/app.js",
    "manifest.webmanifest",
    "sw.js",
    "icons/icon-180.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "functions/api/sync.js",
]

try:
    import blake3
    def file_hash(b):
        return blake3.blake3(b).hexdigest()
except ImportError:
    sys.exit("需要 blake3: py -m pip install blake3")


def api(method, path, token, data=None, headers=None, raw=None):
    url = "https://api.cloudflare.com/client/v4" + path
    hdrs = {"Authorization": "Bearer " + token, **(headers or {})}
    body = None
    if raw is not None:
        body = raw
    elif data is not None:
        body = json.dumps(data).encode()
        hdrs["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return json.load(e)
        except Exception:
            return {"success": False, "errors": [{"message": f"HTTP {e.code}"}]}


def read_sync_key():
    key_file = os.path.join(BASE, "同步密钥.txt")
    for line in open(key_file, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#"):
            return line
    sys.exit("未找到同步密钥,先运行 deploy_sync.py 或检查 同步密钥.txt")


def multipart(parts):
    boundary = "----divpages" + os.urandom(8).hex()
    body = b""
    for name, value, ctype, filename in parts:
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\""
                 + (f"; filename=\"{filename}\"" if filename else "")
                 + f"\r\nContent-Type: {ctype}\r\n\r\n").encode() + value + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def main():
    token = open(TOKEN_FILE, encoding="utf-8").read().strip()
    sync_key = read_sync_key()

    print("1) 绑定 KV 与同步密钥 ...")
    r = api("PATCH", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}", token,
            data={"deployment_configs": {"production": {"bindings": {
                "KV": {"type": "kv_namespace", "namespace_id": KV_ID},
                "SYNC_KEY": {"type": "secret_text", "value": sync_key},
            }}}})
    if not r.get("success"):
        print("   绑定失败:", json.dumps(r.get("errors"), ensure_ascii=False))
        return

    print("2) 构建部署清单 ...")
    contents = {}
    manifest = {}
    for f in SITE_FILES:
        b = open(os.path.join(BASE, f), "rb").read()
        h = file_hash(b)
        manifest[f] = {"hash": h}
        contents[h] = b
    print(f"   {len(manifest)} 个文件, {len(contents)} 个唯一内容块")

    parts = [("manifest", json.dumps(manifest).encode(), "application/json", None)]
    for h, b in contents.items():
        parts.append((h, b, "application/octet-stream", h))
    body, ctype = multipart(parts)

    print("3) 上传部署 ...")
    r = api("POST", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}/deployments", token,
            raw=body, headers={"Content-Type": ctype})
    if not r.get("success"):
        print("   部署失败:", json.dumps(r.get("errors"), ensure_ascii=False))
        return
    dep_id = r["result"]["id"]

    print("4) 等待生效 ...")
    for i in range(30):
        time.sleep(4)
        d = api("GET", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}/deployments", token)
        dep = next((x for x in d.get("result", []) if x["id"] == dep_id), None)
        stage = (dep or {}).get("latest_stage", {})
        if stage.get("name") == "deploy" and stage.get("status") == "success":
            print("   部署成功")
            break
        if dep and dep.get("env_status") in ("canceled", "failure"):
            print("   部署失败:", dep.get("env_status"), stage)
            return
    else:
        print("   超时,请稍后到 Cloudflare 控制台查看")

    info = api("GET", f"/accounts/{ACCOUNT}/pages/projects/{PROJECT}", token)
    domains = (info.get("result") or {}).get("domains") or []
    url = "https://" + (domains[0] if domains else f"{PROJECT}.pages.dev")
    print()
    print("部署完成! 工作台地址(手机/电脑通用):", url)
    print("同步接口:", url + "/api/sync", " 密钥见 同步密钥.txt")


if __name__ == "__main__":
    main()
