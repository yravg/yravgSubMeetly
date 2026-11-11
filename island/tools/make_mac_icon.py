"""Draw the Mac app icon's iconset: our wordmark pill (navy tile, gold pill with its left notch).

Same tokens as installer/make_art.py (navy #212C5F, gold #FFC91B, paper #F5F4EF). macOS icons sit on
Apple's grid: the tile is 824 of the icon's 1024 px, centred. Each size is drawn on its own.

Run: python3 tools/make_mac_icon.py <out.iconset>   (needs Pillow), then on a Mac:
     iconutil -c icns <out.iconset> -o yravgSubMeetly.icns
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

NAVY, GOLD, PAPER = (33, 44, 95), (255, 201, 27), (245, 244, 239)
TILE = 824 / 1024
SS = 4
ICONSET = [("icon_16x16.png", 16), ("icon_16x16@2x.png", 32), ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
           ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256), ("icon_256x256.png", 256),
           ("icon_256x256@2x.png", 512), ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024)]


def icon(px: int) -> Image.Image:
    s = px * SS
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    t = s * TILE
    x0 = (s - t) / 2
    d.rounded_rectangle([x0, x0, x0 + t, x0 + t], radius=t * 0.225, fill=NAVY)
    # The pill, with its notch: a circle just outside the left edge, in the tile's colour.
    pw, ph = t * 0.62, t * 0.30
    px0, py0 = x0 + (t - pw) / 2, x0 + (t - ph) / 2
    d.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=ph / 2, fill=GOLD)
    r = ph * 0.36
    cx, cy = px0 - r * 0.4, py0 + ph / 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=NAVY)
    if px >= 64:  # a paper dot where the pill's text would be
        dr = ph * 0.17
        dx, dy = px0 + pw * 0.28, py0 + ph / 2
        d.ellipse([dx - dr, dy - dr, dx + dr, dy + dr], fill=PAPER)
    return im.resize((px, px), Image.LANCZOS)


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    for name, px in ICONSET:
        icon(px).save(out / name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
