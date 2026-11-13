"""List buildings within R m of a lon/lat: 지번, 이름, 용도, 높이, 층수, 면적, 거리.
Columns (GIS건물통합정보): A4 주소, A5 지번, A9 용도명, A12 건축면적, A13 사용승인일, A14 연면적,
A16 높이, A24 건물명, A25 동명, A26 지상층수, A27 지하층수
usage: python -P -E tools/list_near.py <shp-base> <lon> <lat> <R> [jibun-filter]"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import shapefile
from pyproj import Transformer
base, lon, lat, R = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), float(sys.argv[4])
filt = sys.argv[5] if len(sys.argv) > 5 else None
cx, cy = Transformer.from_crs(4326, 5186, always_xy=True).transform(lon, lat)
sf = shapefile.Reader(base, encoding='euc-kr')
rows = []
for i, sh in enumerate(sf.iterShapes()):
    x0, y0, x1, y1 = sh.bbox
    d = (max(0, x0 - cx, cx - x1) ** 2 + max(0, y0 - cy, cy - y1) ** 2) ** 0.5
    if d <= R: rows.append((d, i, (x0 + x1) / 2 - cx, (y0 + y1) / 2 - cy, x1 - x0, y1 - y0))
for d, i, dx, dy, w, h in sorted(rows):
    r = sf.record(i)
    if filt and filt not in (r['A5'] or ''): continue
    print(f"{d:6.1f}m  ofs({dx:+6.0f},{dy:+6.0f}) bbox {w:4.0f}x{h:4.0f}  {r['A4'].split()[-1]} {r['A5']:<8} {r['A9'] or '':<14} h={r['A16']:<5} F={r['A26']}/B{r['A27']} area={r['A12']} {r['A24'] or ''} {r['A25'] or ''} ({r['A13'] or ''})")
