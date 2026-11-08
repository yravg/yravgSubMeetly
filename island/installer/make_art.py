#!/usr/bin/env python3
"""Draws the installer's own art into installer/art/: the setup icon and the wizard images.

Our wordmark only: "yraverage" plus the SubMeetly pill with its left notch (see
.brand-pill in src/sidepanel.css), in the Coretax paper tokens of src/tokens.css /
src/minutes.css (navy #212C5F, gold #FFC91B, paper #F5F4EF). Nothing here comes from
Oyenza Studio. Needs Pillow; the outputs are committed, run this only to change them.

    python installer/make_art.py
"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "art")
NAVY, GOLD, PAPER, INK, MUTED = (33, 44, 95), (255, 201, 27), (245, 244, 239), (19, 27, 68), (107, 114, 148)
FONTS = r"C:\Windows\Fonts"
SS = 4  # supersampling: everything is drawn 4x and scaled down


def font(name, px):
    return ImageFont.truetype(os.path.join(FONTS, name), int(px))


def notch(d, x, y, h, bg):
    """The pill's left notch: a circle centred just outside its left edge, in the background colour."""
    r, cx, cy = h * 0.36, x - h * 0.36 * 0.4, y + h / 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=bg)


def pill(d, x, y, h, fill, text, text_fill, f):
    """The SubMeetly pill: rounded capsule with a circular notch cut out of its left edge."""
    w = d.textlength(text, font=f) + h * 0.9
    d.rounded_rectangle([x, y, x + w, y + h], radius=h * 0.3, fill=fill)
    notch(d, x, y, h, PAPER)
    d.text((x + h * 0.55, y + h / 2), text, font=f, fill=text_fill, anchor="lm")
    return w


def save(img, name, size):
    img.resize(size, Image.LANCZOS).save(os.path.join(OUT, name))


def icon():
    n = 256 * SS
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, n - 1, n - 1], radius=n * 0.22, fill=NAVY)
    # the pill, alone: gold capsule with the notch, a navy "S" in it
    h, w = n * 0.5, n * 0.74
    x, y = n * 0.13, n * 0.25
    d.rounded_rectangle([x, y, x + w, y + h], radius=h * 0.3, fill=GOLD)
    notch(d, x, y, h, NAVY)
    d.text((x + w * 0.56, y + h / 2), "S", font=font("segoeuib.ttf", h * 0.78), fill=NAVY, anchor="mm")
    base = im.resize((256, 256), Image.LANCZOS)
    base.save(os.path.join(OUT, "yravgsubmeetly.ico"), sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    base.save(os.path.join(OUT, "yravgsubmeetly-256.png"))


def wizard(w, h, name):
    im = Image.new("RGB", (w * SS, h * SS), PAPER)
    d = ImageDraw.Draw(im)
    k = w * SS / 164
    d.rectangle([0, 0, w * SS, int(8 * k)], fill=NAVY)
    d.rectangle([0, int(8 * k), w * SS, int(12 * k)], fill=GOLD)
    f = font("segoeuib.ttf", 12.5 * k)
    d.text((14 * k, 70 * k), "yraverage", font=f, fill=INK, anchor="lm")
    pw = d.textlength("yraverage", font=f)
    ph = 19 * k
    pill(d, 14 * k + pw + 11 * k, 70 * k - ph / 2 + 1.5 * k, ph, NAVY, "SubMeetly", PAPER, font("segoeuib.ttf", 10 * k))
    d.text((14 * k, 112 * k), "Transkripsi dan notulen\nrapat, langsung di\ntepi layar Anda.", font=font("segoeui.ttf", 11 * k), fill=MUTED, anchor="la", spacing=6 * k)
    d.rectangle([14 * k, (314 - 44) * k, 40 * k, (314 - 42) * k], fill=GOLD)
    d.text((14 * k, (314 - 32) * k), "Berjalan di komputer Anda.\nTanpa akun, tanpa cloud.", font=font("segoeui.ttf", 9 * k), fill=MUTED, anchor="la", spacing=4 * k)
    save(im, name, (w, h))


def small(px, name):
    im = Image.new("RGB", (px * SS, px * SS), PAPER)
    d = ImageDraw.Draw(im)
    k = px * SS / 55
    h, w = 22 * k, 38 * k
    x, y = 9 * k, 16 * k
    d.rounded_rectangle([x, y, x + w, y + h], radius=h * 0.3, fill=NAVY)
    notch(d, x, y, h, PAPER)
    d.text((x + w * 0.58, y + h / 2), "S", font=font("segoeuib.ttf", h * 0.8), fill=GOLD, anchor="mm")
    save(im, name, (px, px))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    icon()
    for scale, tag in ((1, ""), (1.5, "-150"), (2, "-200")):
        wizard(round(164 * scale), round(314 * scale), f"wizard{tag}.png")
    for px in (55, 83, 110):
        small(px, f"wizard-small-{px}.png")
    print("art written to", OUT)
