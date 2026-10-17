"""Key out the green screen in the owner's penguin sheet and cut each pose to a transparent PNG.

Usage: python penguin-cut.py <out-dir>
Reads ../source/reference-sheet.jpg. Needs Pillow.
"""
import os
import sys
from PIL import Image, ImageFilter

if len(sys.argv) < 2:
    sys.exit(__doc__)
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "source", "reference-sheet.jpg")
OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGB")
W, H = img.size  # 2816 x 1536

# Rough regions in original pixels (display coordinates x 1.408), generous so the bbox step trims them.
REGIONS = {
    "side": (150, 60, 760, 920),
    "front": (1010, 0, 1800, 760),
    "charge": (1930, 0, 2816, 790),
    "angry": (110, 860, 800, 1536),
    "jump": (960, 760, 1760, 1536),
    "beam": (1720, 800, 2816, 1536),
}


def key(rgb):
    r, g, b = rgb
    # Strong green: fully transparent. Edge green: partial alpha with despill.
    dom = g - max(r, b)
    if g > 90 and dom > 60:
        return (0, 0, 0, 0)
    if g > 70 and dom > 18:
        a = max(0, min(255, int(255 * (1 - (dom - 18) / 42))))
        g2 = max(r, b)  # despill: pull the green down to the other channels
        return (r, g2, b, a)
    return (r, g, b, 255)


for name, box in REGIONS.items():
    crop = img.crop(box)
    px = [key(p) for p in crop.getdata()]
    rgba = Image.new("RGBA", crop.size)
    rgba.putdata(px)
    # Remove isolated speckles by thresholding a slightly blurred alpha.
    alpha = rgba.getchannel("A").filter(ImageFilter.MedianFilter(3))
    rgba.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 40 else 0).getbbox()
    if bbox:
        pad = 8
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(rgba.width, bbox[2] + pad), min(rgba.height, bbox[3] + pad))
        rgba = rgba.crop(bbox)
    # Normalise to a 480 px tall master (2x for ~240 px display).
    scale = 480 / rgba.height
    out = rgba.resize((max(1, round(rgba.width * scale)), 480), Image.LANCZOS)
    path = os.path.join(OUT, f"{name}.png")
    out.save(path, optimize=True)
    print(name, out.size, os.path.getsize(path))
