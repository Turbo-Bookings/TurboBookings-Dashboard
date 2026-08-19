#!/usr/bin/env python3
"""
Generate the PWA / home-screen icons as PNGs.

Written in pure Python (zlib + struct, no Pillow, no SVG rasteriser) because
none of the usual image tooling is installed on this machine and the PWA work
should not be blocked on that. It draws a full-bleed brand-blue square with a
white "TB" monogram built from rectangles.

Full-bleed rather than a rounded card on purpose: Android maskable icons get
cropped to whatever shape the launcher uses, and iOS applies its own corner
radius. Baking in our own rounded corners would double up and look wrong on both.

This is a PLACEHOLDER good enough to ship an installable app. Drop real artwork
at the same paths and it is superseded — nothing else needs to change.

    python3 scripts/gen-pwa-icons.py
"""
import struct
import zlib
from pathlib import Path

BRAND = (0x25, 0x63, 0xEB)  # #2563eb — the dashboard's action colour
WHITE = (0xFF, 0xFF, 0xFF)

# Glyphs as unit-square rectangles (x0, y0, x1, y1), origin top-left.
T_RECTS = [
    (0.00, 0.00, 1.00, 0.20),  # crossbar
    (0.41, 0.20, 0.59, 1.00),  # stem
]
# Three horizontal bars joined by a left stem and two right-hand verticals. The
# verticals share the same x-range so the right edge is flush — an earlier
# version stepped them, which read as a rendering fault rather than a letter.
B_RECTS = [
    (0.00, 0.00, 0.22, 1.00),  # stem
    (0.22, 0.00, 0.82, 0.17),  # top bar
    (0.22, 0.42, 0.82, 0.58),  # middle bar
    (0.22, 0.83, 0.82, 1.00),  # bottom bar
    (0.82, 0.00, 1.00, 0.58),  # upper right vertical
    (0.82, 0.42, 1.00, 1.00),  # lower right vertical
]


def png(width: int, height: int, pixels: bytearray) -> bytes:
    """Minimal RGB PNG encoder."""
    raw = bytearray()
    stride = width * 3
    for y in range(height):
        raw.append(0)  # filter type 0 (None)
        raw.extend(pixels[y * stride : (y + 1) * stride])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def draw(size: int) -> bytes:
    px = bytearray()
    for _ in range(size * size):
        px.extend(BRAND)

    def fill(x0: int, y0: int, x1: int, y1: int) -> None:
        for y in range(max(0, y0), min(size, y1)):
            row = y * size * 3
            for x in range(max(0, x0), min(size, x1)):
                i = row + x * 3
                px[i : i + 3] = bytes(WHITE)

    # Monogram occupies the middle ~52% so it survives maskable cropping, which
    # can trim up to 10% on each edge.
    glyph_h = size * 0.34
    gap = size * 0.06
    t_w = glyph_h * 0.78
    b_w = glyph_h * 0.72
    total_w = t_w + gap + b_w
    x0 = (size - total_w) / 2
    y0 = (size - glyph_h) / 2

    for rects, ox, w in ((T_RECTS, x0, t_w), (B_RECTS, x0 + t_w + gap, b_w)):
        for rx0, ry0, rx1, ry1 in rects:
            fill(
                round(ox + rx0 * w),
                round(y0 + ry0 * glyph_h),
                round(ox + rx1 * w),
                round(y0 + ry1 * glyph_h),
            )

    return png(size, size, px)


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)
    # 192 + 512: the two sizes the web app manifest spec expects.
    # 180: what iOS uses for apple-touch-icon on the Home Screen.
    for size, name in ((192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")):
        path = out / name
        path.write_bytes(draw(size))
        print(f"  wrote {path.relative_to(path.parents[2])} ({size}x{size}, {path.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
