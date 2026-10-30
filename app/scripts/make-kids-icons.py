#!/usr/bin/env python3
"""
The Fairhaven Kids home-screen icon set.

    python3 scripts/make-kids-icons.py        (needs Pillow; run by hand)

Run this again if public/kids-logo-white.png ever changes. The staff icons
have no generator and nobody now knows how they were made, which is the reason
this file exists.

THREE SETS, TWO MARKS.

  - The home-screen icons (180/192/512) carry the full wordmark. That is the
    thing the pastor asked for and it is legible at those sizes.
  - The browser favicons (32/48) carry the CROWN alone. "KIDS" at 16px is a
    row of grey smears — the same conclusion the staff icons reached with their
    single S. The crown is the most distinctive thing in the mark and it is the
    one piece that survives being 16 pixels wide.
  - The CHECK-IN KIOSK gets the crown too, at home-screen sizes. It is a
    different app on a different device and it must not be a coin toss against
    Fairhaven Kids on a home screen — so it gets the other silhouette, on the same
    gradient, with the manifest calling it "Fairhaven Kids Check-in".

CENTRED ON THE INK, NOT ON THE BOX.

The mark's bounding box includes the crown, which is small and light, while the
letters underneath carry nearly all the weight — so its centre of ink sits 62.6%
of the way down, not 50%. Centring the box therefore drops the whole thing
visibly low, which is exactly how it first shipped. Each icon is placed so the
measured centre of INK lands on the optical centre instead.

THE BACKGROUND IS NOT THE BRAND PASTELS.

White on the Fairhaven Kids cyan is 1.8:1 and on the pink 1.7:1 — the logo would not be
readable, it would be a texture. So the gradient uses saturated relatives of the
brand hues instead, and every pixel under a letterform is measured against white
at the end of this script. If that check fails the icons are not written.
"""
from PIL import Image, ImageDraw
from pathlib import Path
import math, sys

ROOT = Path(__file__).resolve().parent.parent
SRC  = ROOT / 'public' / 'kids-logo-white.png'
KIDS = ROOT / 'public' / 'kids-icons'
KIOSK = ROOT / 'public' / 'kiosk-icons'

# Diagonal, top-left to bottom-right. Deep enough to carry white type.
STOPS = [(0.00, (232,  24, 111)),   # magenta — the Fairhaven Kids pink, taken up to full strength
         (0.48, (123,  47, 247)),   # violet  — the bridge the printed material makes
         (1.00, ( 30,  58, 138))]   # deep blue — the navy the whole section sits on
# The crown's orange, as a corner glow only. It is 3:1 against white, so it is
# kept out of the middle band where the letters are.
GLOW = (255, 122, 24)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def gradient(size):
    im = Image.new('RGB', (size, size))
    px = im.load()
    for y in range(size):
        for x in range(size):
            # Position along the top-left → bottom-right diagonal.
            t = (x + y) / (2 * (size - 1))
            for i in range(len(STOPS) - 1):
                p0, c0 = STOPS[i]
                p1, c1 = STOPS[i + 1]
                if p0 <= t <= p1:
                    c = lerp(c0, c1, (t - p0) / (p1 - p0))
                    break
            else:
                c = STOPS[-1][1]
            # Corner glow, dying well before the centre.
            d = math.hypot(x, y) / size
            g = max(0.0, 1.0 - d / 0.42) ** 2
            px[x, y] = lerp(c, GLOW, g * 0.85)
    return im


def contrast(rgb):
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    l = 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2])
    return 1.05 / (l + 0.05)


# VERTICALLY the mark is centred on its ink; HORIZONTALLY on its box.
#
# Only the vertical axis has the problem. The crown is airy and the letters are
# solid, so the ink sits two-thirds of the way down and centring the box drops
# it. Across the width the ink centre is at 0.41 — "SE" is far heavier than
# "KIDS" — and centring on that would shove the whole wordmark bodily to the
# right. A line of type is read against its ends, so the box is right there.
#
# 0.48 rather than 0.50 because dead centre reads a shade low to the eye.
OPTICAL_Y = 0.48

# How far to move from centring the BOX towards centring the INK.
#
# Neither end is right. At 0 the letters sit visibly below the middle, which is
# how this first shipped and what the pastor picked up on. At 1 the crown is treated
# as weighing nothing, the letters are centred alone, and the whole lockup rides
# high with a hole beneath it. The crown does count — just not as much as its
# ink does. Half the correction puts the centre line through the letters, which
# is what the eye is looking for. Rendered all four and compared; this is not
# arithmetic, it is the one judgement in this file.
INK_PULL = 0.5


def ink_centre(mark):
    """Centre of mass of the alpha channel, as fractions of width and height.

    This is the whole reason the mark no longer sits low: for the Fairhaven Kids
    wordmark it comes out at (0.47, 0.63) — two-thirds of the way down the box,
    because the crown weighs almost nothing and the letters weigh everything.
    """
    a = mark.split()[3]
    px = a.load()
    tot = sx = sy = 0
    for y in range(mark.height):
        for x in range(mark.width):
            v = px[x, y]
            if v:
                tot += v; sx += v * x; sy += v * y
    return (sx / tot) / mark.width, (sy / tot) / mark.height


def place(mark, size, frac):
    """Gradient square with `mark` placed so its ink centre is optically centred."""
    bg = gradient(size)
    w = round(size * frac)
    h = round(w * mark.height / mark.width)
    m = mark.resize((w, h), Image.LANCZOS)
    _, cy = ink_centre(mark)
    box_y = (size - h) / 2
    ink_y = OPTICAL_Y * size - cy * h
    at = ((size - w) // 2, round(box_y + (ink_y - box_y) * INK_PULL))
    bg_rgba = bg.convert('RGBA')
    bg_rgba.alpha_composite(m, at)
    return bg_rgba.convert('RGB'), m, at


def worst_contrast(flat, mark, at):
    """The lowest white-on-background contrast anywhere a letter actually sits."""
    alpha = mark.split()[3]
    worst, where = 99.0, None
    for y in range(0, mark.height, 2):
        for x in range(0, mark.width, 2):
            if alpha.getpixel((x, y)) > 40:
                # What the background is *behind* this glyph pixel: sample the
                # gradient, not the composite, which is already white here.
                bx, by = at[0] + x, at[1] + y
                c = contrast(GRADIENT_CACHE[flat.width].getpixel((bx, by)))
                if c < worst:
                    worst, where = c, (bx, by)
    return worst, where


logo = Image.open(SRC).convert('RGBA')

# The crown alone — found, not guessed at.
#
# The crown floats above the E and the S rises to meet it, so there is no gap to
# cut in: the boundary is simply the first row where ink appears far to the LEFT
# of the crown, which is the shoulder of the S arriving. Cutting a few rows late
# leaves a white splinter floating beside the crown, which is exactly what the
# first kiosk icon shipped with.
a = logo.split()[3]


def _row(y):
    return [x for x in range(logo.width) if a.getpixel((x, y)) > 8]


_crown_left = min(_row(10))                       # the crown's own left edge
_cut = next(y for y in range(12, logo.height)     # where something else starts
            if _row(y) and min(_row(y)) < _crown_left - 8)
_xs = [x for y in range(_cut) for x in _row(y)]
crown = logo.crop((min(_xs), 0, max(_xs) + 1, _cut))
print(f'crown: rows 0..{_cut - 1}, x {min(_xs)}..{max(_xs)}  ({crown.width}x{crown.height})')

for d in (KIDS, KIOSK):
    d.mkdir(parents=True, exist_ok=True)
GRADIENT_CACHE = {}

JOBS = [
    # dir,  name,                   size, mark,  frac, maskable
    (KIDS,  'icon-512.png',          512, logo,  0.84, False),
    (KIDS,  'icon-192.png',          192, logo,  0.84, False),
    (KIDS,  'apple-touch-icon.png',  180, logo,  0.84, False),
    # Maskable: Android crops to a circle of 80% diameter. Smaller, so the mark
    # survives the crop on every launcher shape.
    (KIDS,  'icon-512-maskable.png', 512, logo,  0.62, True),
    (KIDS,  'favicon-48.png',         48, crown, 0.72, False),
    (KIDS,  'favicon-32.png',         32, crown, 0.72, False),
    (KIOSK, 'icon-512.png',          512, crown, 0.76, False),
    (KIOSK, 'icon-192.png',          192, crown, 0.76, False),
    (KIOSK, 'apple-touch-icon.png',  180, crown, 0.76, False),
    (KIOSK, 'icon-512-maskable.png', 512, crown, 0.58, True),
    (KIOSK, 'favicon-32.png',         32, crown, 0.72, False),
]

SAFE = 512 * 0.8 / 2


def farthest_ink(mark, size, frac):
    """Distance from the icon's centre to the farthest LIT pixel.

    Not the farthest corner of the bounding box — those corners are empty for
    the wordmark (the crown is centre-left, "KIDS" lower-right), so measuring
    them would shrink the icon to protect transparent pixels.
    """
    w = round(size * frac); h = round(w * mark.height / mark.width)
    m = mark.resize((w, h), Image.LANCZOS)
    _, cy = ink_centre(mark)
    box_y = (size - h) / 2
    ox = (size - w) // 2
    oy = round(box_y + (OPTICAL_Y * size - cy * h - box_y) * INK_PULL)
    a = m.split()[3].load()
    return max(math.hypot(ox + x - size / 2, oy + y - size / 2)
               for y in range(h) for x in range(w) if a[x, y] > 40)


results = []
for out, name, size, mark, frac, maskable in JOBS:
    if size not in GRADIENT_CACHE:
        GRADIENT_CACHE[size] = gradient(size)
    flat, placed, at = place(mark, size, frac)
    c, where = worst_contrast(flat, placed, at)
    note = ''
    if maskable:
        pct = farthest_ink(mark, size, frac) / (size * 0.4) * 100
        # Not "does it just fit" — leave real room. Launcher shapes vary, and a
        # mark clearing the circle by three pixels is one rounding from a
        # clipped D.
        if pct > 95:
            sys.exit(f'FAIL {out.name}/{name}: mark reaches {pct:.0f}% of the '
                     'maskable safe radius. Reduce its fraction.')
        note = f'   safe zone {pct:.0f}%'
    if c < 4.5:
        sys.exit(f'FAIL {out.name}/{name}: white on background is only {c:.2f}:1 at {where}. '
                 'Deepen the gradient rather than shipping an unreadable icon.')
    flat.save(out / name, optimize=True)
    results.append((out.name, name, size, round(c, 2), note))

print(f'wrote {len(results)} icons')
for d, name, size, c, note in results:
    print(f'  {d}/{name:<24} {size:>3}px   white {c}:1{note}')
