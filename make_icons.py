# -*- coding: utf-8 -*-
"""生成 App 图标(纯标准库写 PNG):与 ETF·BOLL 工作台同一家族——
深色渐变底 + 三根红/绿K线,右下角一枚金色分红币以示区分。"""
import os, struct, zlib

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")


def png(w, h, pixel_fn):
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            rows.extend(pixel_fn(x / w, y / h))
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


def make_icon(size):
    def px(u, v):
        # 背景垂直渐变 #10161f -> #1a2233(与 ETF 工作台图标一致)
        t = v
        r, g, b = 16 + t * 10, 22 + t * 12, 31 + t * 19
        # 三根蜡烛(靠左):绿(-)、红(+)、红(+)
        bw = 0.13
        bars = [  # (中心x, 顶y, 底y, 颜色)
            (0.24, 0.52, 0.80, (47, 191, 113)),
            (0.40, 0.34, 0.66, (240, 71, 90)),
            (0.56, 0.20, 0.50, (240, 71, 90)),
        ]
        for bx, ty, by, col in bars:
            if abs(u - bx) <= bw / 2 and ty <= v <= by:
                return col[0], col[1], col[2]
            # 影线
            if abs(u - bx) <= bw / 6 and (ty - 0.07) <= v <= (by + 0.07):
                return col[0], col[1], col[2]
        # 金色分红币(右下):外圈深金、内心亮金、中心一道横杠当"¥"的意象
        cx, cy, rad = 0.74, 0.70, 0.17
        d = ((u - cx) ** 2 + (v - cy) ** 2) ** 0.5
        if d <= rad:
            if d <= rad - 0.045:
                # 中心横杠(去掉中间一条)
                if abs(v - cy) <= 0.030 and abs(u - cx) <= rad - 0.09:
                    return 160, 108, 28
                return 240, 178, 74
            return 190, 132, 40
        return int(r), int(g), int(b)
    return png(size, size, px)


os.makedirs(OUT, exist_ok=True)
for s in (180, 192, 512):
    with open(os.path.join(OUT, f"icon-{s}.png"), "wb") as f:
        f.write(make_icon(s))
print("icons written to", OUT)
