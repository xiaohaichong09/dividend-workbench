# -*- coding: utf-8 -*-
"""用 probe 的代码路径上传真实 9 个文件,定位 deploy_pages.py 哪里不同"""
import json
import os
import sys
import urllib.request

import blake3

sys.stdout.reconfigure(encoding="utf-8")
TOKEN = open(r"D:\Agent\Index 2\tools\cf_token.txt", encoding="utf-8").read().strip()
ACCT = "5cb2e64101b467bd1637c7e6a1ad859d"
API = "https://api.cloudflare.com/client/v4"
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["index.html", "css/style.css", "js/app.js", "manifest.webmanifest", "sw.js",
         "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
         "functions/api/sync.js"]


def api(method, path, raw=None, ctype=None):
    hdrs = {"Authorization": "Bearer " + TOKEN}
    body = None
    if raw is not None:
        body = raw
        hdrs["Content-Type"] = ctype
    req = urllib.request.Request(API + path, data=body, method=method, headers=hdrs)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def multipart(parts):
    boundary = "----probe" + os.urandom(6).hex()
    body = b""
    for name, value, ct, fn in parts:
        body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\""
                 + (f"; filename=\"{fn}\"" if fn else "")
                 + f"\r\nContent-Type: {ct}\r\n\r\n").encode() + value + b"\r\n"
    body += f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


manifest, blob = {}, {}
for f in FILES:
    b = open(os.path.join(BASE, f), "rb").read()
    h = blake3.blake3(b).hexdigest()
    manifest[f] = {"hash": h}
    blob[h] = b
    print(f"{f:28} {len(b):7}B  {h[:16]}")

parts = [("manifest", json.dumps(manifest).encode(), "application/json", None)]
for h, b in blob.items():
    parts.append((h, b, "application/octet-stream", h))
body, ct = multipart(parts)
print("总上传:", len(body), "bytes")
r = api("POST", f"/accounts/{ACCT}/pages/projects/dividend/deployments", raw=body, ctype=ct)
dep = r.get("result") or {}
print("success:", r.get("success"), "| errors:", str(r.get("errors"))[:200])
if dep.get("id"):
    import time
    for i in range(15):
        time.sleep(4)
        d2 = api("GET", f"/accounts/{ACCT}/pages/projects/dividend/deployments/{dep['id']}")
        rr = d2.get("result") or {}
        st = rr.get("latest_stage", {})
        print("  stage:", st.get("name"), st.get("status"), "| files:", len(rr.get("files") or []),
              "| uses_functions:", rr.get("uses_functions"))
        if st.get("name") == "deploy" and st.get("status") in ("success", "failure"):
            break
