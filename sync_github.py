# -*- coding: utf-8 -*-
"""
同步工作台文件到 GitHub(经 Contents API,绕开被墙的 git https 通道)——同昨晚 etf 项目方式。
固定文件清单,只上传/更新清单内文件;删除远端清单外的多余文件。
用法: py sync_github.py [TOKEN]   (未传参时读环境变量 GH_SYNC_TOKEN)
"""
import base64
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

BASE = os.path.dirname(os.path.abspath(__file__))
REPO = "xiaohaichong09/dividend-workbench"
API = "https://api.github.com"
TOKEN = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("GH_SYNC_TOKEN", "")
H = {"Authorization": "token " + TOKEN, "Accept": "application/vnd.github+json",
     "Content-Type": "application/json", "User-Agent": "xiaohaichong09"}

FILES = [
    "index.html",
    "css/style.css",
    "js/app.js",
    "manifest.webmanifest",
    "sw.js",
    "icons/icon-180.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "functions/api/sync.js",
    "deploy_pages.py",
    "make_icons.py",
    "sync_github.py",
    "README.md",
]


def call(method, path, data=None, retry=3):
    for i in range(retry):
        try:
            req = urllib.request.Request(API + path,
                                         data=json.dumps(data).encode() if data else None,
                                         method=method, headers=H)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode()[:200]
            if e.code in (403, 422) or i == retry - 1:
                return {"_http": e.code, "_body": body}
        except Exception as e:
            if i == retry - 1:
                return {"_err": str(e)}
            time.sleep(3)


def git_blob_sha(path):
    raw = open(path, "rb").read()
    h = hashlib.sha1()
    h.update(f"blob {len(raw)}".encode() + b"\x00" + raw)
    return h.hexdigest()


def api_path(path):
    return "/".join(urllib.parse.quote(seg) for seg in path.split("/"))


def main():
    if not TOKEN:
        print("缺少 token: py sync_github.py <TOKEN>")
        return
    local = {}
    for f in FILES:
        p = os.path.join(BASE, f)
        if os.path.exists(p):
            local[f] = git_blob_sha(p)
        else:
            print("跳过(本地不存在):", f)

    tree = call("GET", f"/repos/{REPO}/git/trees/main?recursive=1")
    if isinstance(tree, dict) and "tree" in tree:
        remote = {t["path"]: t["sha"] for t in tree["tree"] if t["type"] == "blob"}
    else:
        remote = {}

    to_put = [f for f, sha in local.items() if remote.get(f) != sha]
    to_del = [f for f in remote if f not in local]
    print(f"本地 {len(local)} 个文件 | 远端 {len(remote)} | 需上传 {len(to_put)} | 需删除 {len(to_del)}")

    ok = fail = 0
    for f in sorted(to_put):
        b64 = base64.b64encode(open(os.path.join(BASE, f), "rb").read()).decode()
        body = {"message": f"更新 {f}", "content": b64}
        if f in remote:
            body["sha"] = remote[f]
        r = call("PUT", f"/repos/{REPO}/contents/{api_path(f)}", body)
        if r.get("content") or r.get("commit"):
            ok += 1
        else:
            fail += 1
            print(f"  失败 {f}: {r.get('_http')} {r.get('_body', '')[:80]}")
    for f in sorted(to_del):
        r = call("GET", f"/repos/{REPO}/contents/{api_path(f)}")
        sha = (r.get("sha") if isinstance(r, dict) else None)
        if sha:
            r2 = call("DELETE", f"/repos/{REPO}/contents/{api_path(f)}",
                      {"message": f"移除 {f}", "sha": sha})
            ok += 1 if r2.get("commit") else 0
    print(f"完成: 成功 {ok} / 失败 {fail}")
    print(f"仓库: https://github.com/{REPO}")


if __name__ == "__main__":
    main()
