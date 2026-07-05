"""Generate placeholder tray icons for the Coriven Tauri app."""
from PIL import Image, ImageDraw
import os
import struct
import zlib

icons_dir = os.path.join(os.path.dirname(__file__), 'src-tauri', 'icons')
os.makedirs(icons_dir, exist_ok=True)

sizes = [
    (32, '32x32.png'),
    (128, '128x128.png'),
    (256, '128x128@2x.png'),
    (512, 'icon.png'),
]

for size, name in sizes:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    margin = size // 8
    draw.ellipse([margin, margin, size - margin, size - margin], fill=(0, 150, 136, 255))
    center = size // 2
    r = size // 3
    line_w = max(2, size // 16)
    draw.arc([center - r, center - r, center + r, center + r], start=45, end=315, fill=(255, 255, 255, 230), width=line_w)
    path = os.path.join(icons_dir, name)
    img.save(path, 'PNG')
    print(f'Created {path}')


def make_ico(sizes_list, out_path):
    """Build a minimal ICO file from PIL images."""
    images = []
    for s in sizes_list:
        img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        margin = s // 8
        draw.ellipse([margin, margin, s - margin, s - margin], fill=(0, 150, 136, 255))
        center = s // 2
        r = s // 3
        lw = max(2, s // 16)
        draw.arc([center - r, center - r, center + r, center + r], start=45, end=315, fill=(255, 255, 255, 230), width=lw)
        images.append(img)
    images[0].save(out_path, format='ICO', sizes=[(s, s) for s in sizes_list], append_images=images[1:])
    print(f'Created {out_path}')


make_ico([16, 32, 48, 256], os.path.join(icons_dir, 'icon.ico'))
print('Done.')
