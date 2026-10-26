# -*- coding: utf-8 -*-
"""生成 PWA 图标与 iOS 启动图。

用法：py scripts/make_icons.py
依赖：Pillow（py -m pip install pillow）
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "icons"
OUT.mkdir(parents=True, exist_ok=True)

ICON_SIZES = (96, 144, 152, 180, 192, 384, 512, 1024)
MASKABLE_SIZES = (192, 512)
SPLASH_SIZES = (
    (1290, 2796),
    (1179, 2556),
    (1284, 2778),
    (1170, 2532),
    (1125, 2436),
    (1242, 2688),
    (828, 1792),
    (750, 1334),
    (2048, 2732),
    (1668, 2388),
)

BOLD_FONTS = (
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\seguisb.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
)
REGULAR_FONTS = (
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
)


def font(size, bold=True):
    for path in BOLD_FONTS if bold else REGULAR_FONTS:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def vertical_gradient(w, h, top, bottom):
    img = Image.new("RGB", (1, h))
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        draw.point((0, y), fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img.resize((w, h), Image.Resampling.BILINEAR)


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_icon(size, maskable=False):
    scale = 2
    s = size * scale
    img = vertical_gradient(s, s, (15, 21, 31), (27, 36, 51))
    draw = ImageDraw.Draw(img, "RGBA")

    # 背景细网格，增加金融终端质感
    grid = max(1, s // 64)
    for x in range(grid, s, grid * 4):
        draw.line((x, 0, x, s), fill=(255, 255, 255, 5), width=1)
    for y in range(grid, s, grid * 4):
        draw.line((0, y, s, y), fill=(255, 255, 255, 5), width=1)

    # maskable 图标把内容收进中间 80% 安全区
    pad = s * (0.20 if maskable else 0.09)
    left = pad
    width = s - pad * 2

    def x(ratio):
        return left + width * ratio

    def y(ratio):
        return left + width * ratio

    # 三根 K 线：绿、红、红
    candles = (
        (0.20, 0.53, 0.84, (47, 191, 113)),
        (0.40, 0.33, 0.70, (240, 71, 90)),
        (0.60, 0.17, 0.54, (240, 71, 90)),
    )
    body_w = width * 0.115
    for cx, top, bottom, color in candles:
        px = x(cx)
        py1, py2 = y(top), y(bottom)
        # 影线
        draw.line((px, y(top) - width * 0.075, px, y(bottom) + width * 0.075),
                  fill=color, width=max(2, int(width * 0.018)))
        # 实体
        draw.rounded_rectangle(
            (px - body_w / 2, py1, px + body_w / 2, py2),
            radius=max(2, int(body_w * 0.18)),
            fill=color,
        )
        # 实体高光
        draw.rounded_rectangle(
            (px - body_w / 2 + body_w * 0.18, py1 + body_w * 0.10,
             px - body_w / 2 + body_w * 0.38, py2 - body_w * 0.10),
            radius=max(1, int(body_w * 0.08)),
            fill=(255, 255, 255, 40),
        )

    # 右下角分红金币
    coin_cx, coin_cy, coin_r = x(0.80), y(0.79), width * 0.155
    draw.ellipse(
        (coin_cx - coin_r, coin_cy - coin_r, coin_cx + coin_r, coin_cy + coin_r),
        fill=(190, 132, 40),
        outline=(120, 76, 18),
        width=max(2, int(width * 0.008)),
    )
    inner = coin_r * 0.80
    draw.ellipse(
        (coin_cx - inner, coin_cy - inner, coin_cx + inner, coin_cy + inner),
        fill=(240, 178, 74),
    )
    # 金币上的 ¥
    f = font(max(8, int(coin_r * 1.25)), bold=True)
    draw.text((coin_cx, coin_cy + coin_r * 0.02), "¥", font=f,
              fill=(94, 56, 8), anchor="mm")

    if not maskable:
        # 很淡的外边框，避免在浅色桌面上糊成一片
        draw.rounded_rectangle((1, 1, s - 2, s - 2), radius=s * 0.20,
                               outline=(255, 255, 255, 18), width=max(1, s // 512))

    return img.resize((size, size), Image.Resampling.LANCZOS)


def draw_splash(w, h):
    img = vertical_gradient(w, h, (13, 17, 23), (16, 24, 35)).convert("RGBA")

    # 顶部蓝色光晕
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    r = int(w * 0.62)
    cx, cy = w // 2, int(h * 0.33)
    gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(76, 141, 255, 28))
    glow = glow.filter(ImageFilter.GaussianBlur(int(w * 0.12)))
    img = Image.alpha_composite(img, glow)

    # 中间的 App 图标
    icon_size = int(w * 0.22)
    icon = draw_icon(icon_size).convert("RGBA")
    icon.putalpha(rounded_mask(icon_size, int(icon_size * 0.22)))
    ix = (w - icon_size) // 2
    iy = int(h * 0.335) - icon_size // 2
    img.alpha_composite(icon, (ix, iy))

    draw = ImageDraw.Draw(img)
    title_size = int(w * 0.075)
    sub_size = int(w * 0.032)
    foot_size = int(w * 0.023)

    title_y = iy + icon_size + int(h * 0.045)
    draw.text((w // 2, title_y), "攒股收息", font=font(title_size, True),
              fill=(230, 237, 243), anchor="mm")
    draw.text((w // 2, title_y + int(title_size * 1.25)), "退休计划", font=font(sub_size, False),
              fill=(139, 152, 165), anchor="mm")

    # 细线 + 底部提示
    line_w = int(w * 0.08)
    line_y = title_y + int(title_size * 2.2)
    draw.line((w // 2 - line_w, line_y, w // 2 + line_w, line_y),
              fill=(76, 141, 255, 110), width=max(2, int(w * 0.004)))

    draw.text((w // 2, int(h * 0.93)), "记录每一笔分红 · 攒出退休现金流",
              font=font(foot_size, False), fill=(77, 90, 104), anchor="mm")

    return img.convert("RGB")


def main():
    for size in ICON_SIZES:
        draw_icon(size).save(OUT / f"icon-{size}.png", optimize=True)
    for size in MASKABLE_SIZES:
        draw_icon(size, maskable=True).save(OUT / f"icon-maskable-{size}.png", optimize=True)
    for w, h in SPLASH_SIZES:
        draw_splash(w, h).save(OUT / f"splash-{w}x{h}.png", optimize=True)
    print("icons + splash written to", OUT)


if __name__ == "__main__":
    main()
