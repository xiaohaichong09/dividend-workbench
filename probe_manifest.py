# -*- coding: utf-8 -*-
"""实测 Pages 直传清单格式:哪种 hash/结构能让 files>0"""
import base64
import json
import os
import sys
import urllib.request

import blake3

sys.stdout.reconfigure(encoding="utf-8")
TOKEN = open(r"D:\Agent\Index 2\tools\cf_token.txt", encoding="utf-8").read().strip()
ACCT = "5cb2e64101b467bd1637c7e6a1ad859d"
API = "https://api.cloudflare.com/client/v4"
content = b"<!doctype html><meta charset=utf-8><title>t</title>ok"


def api(method, path, raw=None, ctype=None):
    hdrs = {"Authorization": "Bearer " + TOKEN}
    body = None
    if raw is not None:
        body = raw
        hdrs["Content-Type"] = ctype
    req = urllib.request.Request(API + path, data=body, method=method, headers=hdrs)
    with urllib.request.urlopen(req, timeout=90) as r:
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


h_hex = blake3.blake3(content).hexdigest()
h_b64 = base64.b64encode(blake3.blake3(content).digest()).decode()
variants = [
    ("obj-hex", {"index.html": {"hash": h_hex}}, h_hex),
    ("str-hex", {"index.html": h_hex}, h_hex),
    ("obj-b64", {"index.html": {"hash": h_b64}}, h_b64),
    ("slash-obj-hex", {"/index.html": {"hash": h_hex}}, h_hex),
]
for name, manifest, h in variants:
    try:
        body, ct = multipart([
            ("manifest", json.dumps(manifest).encode(), "application/json", None),
            (h, content, "application/octet-stream", h),
        ])
        r = api("POST", f"/accounts/{ACCT}/pages/projects/dividend/deployments", raw=body, ctype=ct)
        dep = (r.get("result") or {})
        dep_id = dep.get("id")
        files_n = 0
        if dep_id:
            d2 = api("GET", f"/accounts/{ACCT}/pages/projects/dividend/deployments/{dep_id}")
            files_n = len((d2.get("result") or {}).get("files") or {})
        print(f"{name:16} success={r.get('success')} files={files_n} errors={str(r.get('errors'))[:120]}")
        if files_n:
            print(">>> 命中格式:", name, json.dumps(manifest)[:80])
            break
    except Exception as e:
        print(f"{name:16} 异常: {e}")
