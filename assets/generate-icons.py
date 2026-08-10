"""Patent Strzelecki - icon generator, CELOWNIK ("crosshair") variant (C2a).

Theme: a crosshair - a ring + 4 thick bars crossing through the ring, a
graphite "bullseye" in the middle. Drawn at 4096 px, LANCZOS. Color and
alpha channels are scaled separately -> no fringing at the edges.

The artwork is original, not a copy of the course's own logo
(patentstrzelecki.eu). The only thing shared with the course is the color.

Run from the assets directory:
  uv run --with pillow python generate-icons.py            # preview only
  uv run --with pillow python generate-icons.py --write    # overwrites the icons
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

S = 4096
OUT = str(Path(__file__).resolve().parent)
SCRATCH = OUT

ORANGE = (247, 148, 29)   # #F7941D
WHITE = (255, 255, 255)
INK = (26, 30, 40)        # #1A1E28

# --- geometry (fractions of the canvas side, centre at 0.5/0.5) ------
RING_O = 0.285    # outer edge of the ring
STROKE = 0.072    # ring thickness
ARM_W = 0.072     # crosshair bar width
ARM_IN = 0.118     # bars start here (gap around the bullseye)
ARM_OUT = 0.410   # bar end
DOT_R = 0.070     # graphite bullseye
R_COIN = 0.440    # orange disc (splash)
FG_DIAM = 0.58    # Android: theme fills 58% of the canvas
SPLASH_K = 0.84

RING_I = RING_O - STROKE


def _disc(d, r, color, cx=0.5, cy=0.5):
    x, y, rr = cx * S, cy * S, r * S
    d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=color)


def _arms(d, k, color):
    h = ARM_W * k / 2
    ri, ro = ARM_IN * k, ARM_OUT * k
    for b in [(0.5 - h, 0.5 - ro, 0.5 + h, 0.5 - ri),
              (0.5 - h, 0.5 + ri, 0.5 + h, 0.5 + ro),
              (0.5 - ro, 0.5 - h, 0.5 - ri, 0.5 + h),
              (0.5 + ri, 0.5 - h, 0.5 + ro, 0.5 + h)]:
        d.rectangle([b[0] * S, b[1] * S, b[2] * S, b[3] * S], fill=color)


def _paint(d, k, inner_color, c_white=WHITE, c_ink=INK):
    """Ring + bars + bullseye. inner_color = the ring's interior."""
    _disc(d, RING_O * k, c_white)
    _disc(d, RING_I * k, inner_color)
    _arms(d, k, c_white)
    _disc(d, DOT_R * k, c_ink)


def _alpha_mask(k):
    """Silhouette of the theme: ring + bars + bullseye (interior transparent)."""
    a = Image.new("L", (S, S), 0)
    da = ImageDraw.Draw(a)
    _disc(da, RING_O * k, 255)
    _disc(da, RING_I * k, 0)
    _arms(da, k, 255)
    _disc(da, DOT_R * k, 255)
    return a


def master_full():
    """Full square, opaque (icon.png, favicon.png)."""
    img = Image.new("RGB", (S, S), ORANGE)
    _paint(ImageDraw.Draw(img), 1.0, ORANGE)
    return img, None


def master_fg():
    """Android foreground. Platform background = #F7941D, so the colour
    layer outside the silhouette is orange too -> no halo at the edges."""
    k = FG_DIAM / (2 * ARM_OUT)
    color = Image.new("RGB", (S, S), ORANGE)
    _paint(ImageDraw.Draw(color), k, ORANGE)
    return color, _alpha_mask(k)


def master_mono():
    """Android monochrome: everything white, interior transparent."""
    k = FG_DIAM / (2 * ARM_OUT)
    color = Image.new("RGB", (S, S), WHITE)
    a = Image.new("L", (S, S), 0)
    da = ImageDraw.Draw(a)
    _disc(da, RING_O * k, 255)
    _disc(da, RING_I * k, 0)
    _arms(da, k, 255)
    _disc(da, DOT_R * k, 255)
    return color, a


def master_splash():
    """Splash: transparent, orange disc + theme."""
    k = SPLASH_K
    color = Image.new("RGB", (S, S), ORANGE)
    _paint(ImageDraw.Draw(color), k, ORANGE)
    alpha = Image.new("L", (S, S), 0)
    _disc(ImageDraw.Draw(alpha), R_COIN, 255)
    return color, alpha


def render(master_fn, size):
    color, alpha = master_fn()
    c = color.resize((size, size), Image.LANCZOS)
    if alpha is None:
        return c
    out = c.convert("RGBA")
    out.putalpha(alpha.resize((size, size), Image.LANCZOS))
    return out


FILES = [
    ("icon.png", master_full, 1024),
    ("android-icon-foreground.png", master_fg, 1024),
    ("android-icon-monochrome.png", master_mono, 1024),
    ("splash-icon.png", master_splash, 1024),
    ("favicon.png", master_full, 196),
]


def write_assets():
    for name, fn, size in FILES:
        img = render(fn, size)
        img.save(f"{OUT}/{name}")
        print(f"{name:32} {size:>5}px  mode={img.mode}")


FONT_B = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
FONT_R = "/System/Library/Fonts/Supplemental/Arial.ttf"


def rounded(img, radius_frac=0.224):
    m = Image.new("L", (S, S), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, S - 1, S - 1], radius=int(radius_frac * S), fill=255)
    o = img.convert("RGBA")
    o.putalpha(m.resize(img.size, Image.LANCZOS))
    return o


def final_preview(path):
    sizes = [60, 120, 320, 512]
    gap, pad, cellpad, head = 30, 30, 22, 46
    cell_w = sum(sizes) + gap * (len(sizes) + 1)
    cell_h = max(sizes) + cellpad * 2
    rows = [
        ("icon.png (iOS maska)", lambda s: rounded(render(master_full, s)),
         [(24, 25, 30), (240, 241, 245)]),
        ("android foreground na #F7941D", lambda s: render(master_fg, s),
         [(247, 148, 29), (247, 148, 29)]),
        ("monochrome (tint)", lambda s: render(master_mono, s),
         [(58, 62, 74), (200, 205, 215)]),
        ("splash-icon.png", lambda s: render(master_splash, s),
         [(255, 255, 255), (24, 25, 30)]),
    ]
    W = cell_w + pad * 2
    H = head + len(rows) * (cell_h + head) + pad
    board = Image.new("RGB", (W, H), (110, 110, 118))
    bd = ImageDraw.Draw(board)
    lab = ImageFont.truetype(FONT_B, 24)
    small = ImageFont.truetype(FONT_R, 16)
    y = 10
    for title, mk, bgs in rows:
        bd.text((pad, y), title, font=lab, fill=(255, 255, 255))
        y += 34
        half = cell_w // 2
        bd.rectangle([pad, y, pad + half, y + cell_h], fill=bgs[0])
        bd.rectangle([pad + half, y, pad + cell_w, y + cell_h], fill=bgs[1])
        cx = pad + gap
        for s in sizes:
            ic = mk(s)
            board.paste(ic, (cx, y + cell_h // 2 - s // 2),
                        ic if ic.mode == "RGBA" else None)
            bd.text((cx, y + cell_h - 18), f"{s}px", font=small,
                    fill=(140, 140, 140))
            cx += s + gap
        y += cell_h + 12
    board.save(path)
    print("preview ->", path, board.size)


if __name__ == "__main__":
    import sys
    if "--write" in sys.argv:
        write_assets()
    final_preview(f"{SCRATCH}/ikona_celownik.png")
