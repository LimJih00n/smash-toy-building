"""Top-down preview PNG of a zone map JSON: ground codes, buildings shaded by height, targets red.
usage: python -P -E tools/preview_zone.py data/maps/<id>.json out.png"""
import sys, json, re
from PIL import Image, ImageDraw
d = json.load(open(sys.argv[1], encoding='utf-8'))
S = 2  # px per metre
W = 640 * S
img = Image.new('RGB', (W, W), (205, 205, 200))
dr = ImageDraw.Draw(img)
col = {'r': (90, 94, 98), 'w': (86, 140, 170), 'g': (110, 150, 80), 'p': (150, 150, 160), 'i': (170, 165, 150), 't': (120, 100, 80)}
g = d.get('ground')
if g:
    for j, row in enumerate(g['rle'].split('/')):
        i = 0
        for m in re.finditer(r'(\D)(\d*)', row):
            n = int(m[2] or 1)
            if m[1] in col:
                x0 = (g['origin'] + i * g['cell'] + 320) * S; z0 = (g['origin'] + j * g['cell'] + 320) * S
                dr.rectangle([x0, z0, x0 + n * g['cell'] * S - 1, z0 + g['cell'] * S - 1], fill=col[m[1]])
            i += n
for b in sorted(d['buildings'], key=lambda b: b['h']):
    v = int(235 - min(1, b['h'] / 120) * 170)
    c = (220, 40, 30) if b.get('label') else (v, v, v + 10)
    for x0, z0, x1, z1 in b['rects']:
        dr.rectangle([(x0 + 320) * S, (z0 + 320) * S, (x1 + 320) * S - 1, (z1 + 320) * S - 1], fill=c)
h = d['half']
dr.rectangle([(320 - h) * S, (320 - h) * S, (320 + h) * S, (320 + h) * S], outline=(255, 200, 0), width=2)
img.save(sys.argv[2])
print('saved', sys.argv[2])
