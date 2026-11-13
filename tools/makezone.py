"""Build a zone map JSON (data/maps/<id>.json) in the format src/mapgen.js reads.

Sources (국토교통부 GIS건물통합정보, CC BY; key in .env as VWORLD_API_KEY / VWORLD_DOMAIN)
  - buildings: vworld 2D데이터 API layer LT_C_BLDGINFO (what the original maps were made from), plus
    footprints from the GIS건물통합정보 SHP download that the API lacks (config "shp", optional).
    SHP columns (EPSG:5186, EUC-KR): A8 용도코드  A13 사용승인일  A16 높이(m)  A24 건물명  A26 지상층수
    Both often hold a register record and a bare outline for the same building: de-duplicated.
  - targets: matched by building name (config "match"); missing height / floors can be given in the config
  - ground (roads / water / green ...): API layer LP_PA_CBND_BUBUN (연속지적도, 지목 = last char of 지번)

Frame: metres, +x east, +z south (as in world.js), origin = target footprint centre, rotated so the
target's long edge runs along x. Footprints become 2 m-grid rectangles; ground is a 4 m grid RLE.

usage: python -P -E tools/makezone.py tools/zones/<id>.json
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import shapefile
import shapely
from pyproj import Transformer
from shapely.geometry import Polygon, MultiPolygon, shape
from shapely.ops import unary_union

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TO_TM = Transformer.from_crs(4326, 5186, always_xy=True)
CELL = 2.0           # footprint raster (m)
MIN_AREA = 32.0      # smaller footprints are sheds / kiosks: dropped (same floor as the existing maps)
G_CELL, G_N, G_ORIGIN = 4, 160, -320  # ground raster: 160 x 160 cells of 4 m, -320..320 m

# 지목 (last character of the parcel's 지번 label) -> ground code (legend below)
JIMOK = {'도': 'r', '천': 'w', '구': 'w', '공': 'g', '임': 'g', '전': 'g', '답': 'g', '잡': 'g',
         '차': 'p', '장': 'i', '창': 'i', '철': 't'}
LEGEND = {'r': '도로(도)', 'w': '하천·구거(천·구)', 'g': '녹지(공·임·전·답·잡)', 'p': '주차장(차)', 'i': '포장 마당(장·창·대)', 't': '철도(철)'}
LEVEL_H = {'house': 3.0, 'apartment': 2.9, 'shop': 3.8, 'office': 4.0, 'tower': 4.3, 'factory': 6.0, 'parking': 3.2}


def load_env():
    env = {}
    with open(os.path.join(ROOT, '.env'), encoding='utf-8') as f:
        for line in f:
            if '=' in line and not line.startswith('#'):
                k, v = line.strip().split('=', 1)
                env[k] = v
    return env


def api_features(env, layer, box_lonlat, size=1000):
    """All features of a vworld 2D data layer inside a lon/lat box (paged)."""
    x0, y0, x1, y1 = box_lonlat
    out, page = [], 1
    while True:
        p = dict(service='data', request='GetFeature', data=layer, key=env['VWORLD_API_KEY'], domain=env['VWORLD_DOMAIN'],
                 format='json', crs='EPSG:4326', geomFilter=f'BOX({x0},{y0},{x1},{y1})', size=size, page=page,
                 geometry='true', attribute='true')
        with urllib.request.urlopen('https://api.vworld.kr/req/data?' + urllib.parse.urlencode(p), timeout=60) as r:
            d = json.load(r)['response']
        if d.get('status') == 'NOT_FOUND':
            break
        if d.get('status') != 'OK':
            raise RuntimeError(f'{layer}: {d.get("status")} {d.get("error")}')
        out += d['result']['featureCollection']['features']
        if page >= int(d['page']['total']):
            break
        page += 1
        time.sleep(0.2)
    return out


def lonlat_box(lon, lat, r):
    """lon/lat box reaching r metres from the point in every direction"""
    dlon, dlat = r / (111320 * math.cos(math.radians(lat))), r / 110950
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def geom_tm(g):
    """GeoJSON geometry in lon/lat -> shapely geometry in EPSG:5186."""
    def ring(r):
        xs, ys = TO_TM.transform([p[0] for p in r], [p[1] for p in r])
        return list(zip(xs, ys))
    if g['type'] == 'Polygon':
        return Polygon(ring(g['coordinates'][0]), [ring(h) for h in g['coordinates'][1:]])
    return MultiPolygon([Polygon(ring(p[0]), [ring(h) for h in p[1:]]) for p in g['coordinates']])


class Frame:
    """TM (E, N) <-> zone frame (x east, z south) rotated by `deg` about the origin."""
    def __init__(self, E0, N0, deg):
        self.E0, self.N0, self.a = E0, N0, math.radians(deg)
        self.c, self.s = math.cos(self.a), math.sin(self.a)

    def fwd(self, E, N):
        x, z = E - self.E0, -(N - self.N0)
        return x * self.c + z * self.s, -x * self.s + z * self.c

    def inv(self, x, z):
        x0, z0 = x * self.c - z * self.s, x * self.s + z * self.c
        return x0 + self.E0, self.N0 - z0

    def geom(self, g):
        return shapely.transform(g, lambda a: np.column_stack(self.fwd(a[:, 0], a[:, 1])))


def long_edge_deg(g):
    """Angle (deg, in the x-east / z-south frame) that turns the footprint's long edge onto the x axis."""
    rect = g.minimum_rotated_rectangle
    pts = list(rect.exterior.coords)
    best = max(((pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(4)), key=lambda v: v[0] ** 2 + v[1] ** 2)
    dx, dz = best[0], -best[1]  # TM north-up -> z south
    a = math.degrees(math.atan2(dz, dx))
    while a > 45: a -= 90
    while a <= -45: a += 90
    return round(a, 1)


def rasterize(g):
    """Footprint (zone frame) -> list of [x0, z0, x1, z1] on the 2 m grid (row runs merged downwards)."""
    x0, z0, x1, z1 = g.bounds
    i0, i1 = math.floor(x0 / CELL), math.ceil(x1 / CELL)
    j0, j1 = math.floor(z0 / CELL), math.ceil(z1 / CELL)
    xs = (np.arange(i0, i1) + 0.5) * CELL
    zs = (np.arange(j0, j1) + 0.5) * CELL
    X, Z = np.meshgrid(xs, zs)
    inside = shapely.contains_xy(g, X, Z)
    rects, open_ = [], {}
    for jj in range(inside.shape[0]):
        row, runs, k = inside[jj], [], 0
        while k < len(row):
            if row[k]:
                s = k
                while k < len(row) and row[k]: k += 1
                runs.append((s, k))
            else:
                k += 1
        nxt = {}
        for run in runs:
            if run in open_:
                nxt[run] = open_.pop(run)
            else:
                nxt[run] = jj
        for (s, e), js in open_.items():
            rects.append([(i0 + s) * CELL, (j0 + js) * CELL, (i0 + e) * CELL, (j0 + jj) * CELL])
        open_ = nxt
    for (s, e), js in open_.items():
        rects.append([(i0 + s) * CELL, (j0 + js) * CELL, (i0 + e) * CELL, (j0 + inside.shape[0]) * CELL])
    return [[float(v) for v in r] for r in rects]


def style_of(use, h, floors):
    u = (use or '')[:2]
    if u == '01': return 'house'
    if u == '02': return 'apartment'
    if u in ('03', '04'): return 'shop' if floors <= 5 and h < 25 else ('tower' if h >= 45 else 'office')
    if u in ('17', '18'): return 'factory'
    if u == '20': return 'parking'
    return 'tower' if h >= 45 else 'office'


def main(cfg_path):
    cfg = json.load(open(cfg_path, encoding='utf-8'))
    env = load_env()
    lon, lat = cfg['center']
    half = cfg.get('half', 250)
    E, N = TO_TM.transform(lon, lat)
    R = half * 1.5 + 60  # gather radius (TM metres) before rotation / clipping

    # ---- buildings: the API layer (as the original maps: 'vworld LT_C_BLDGINFO'), plus SHP footprints the API lacks
    def num(v):
        try: return float(v or 0)
        except ValueError: return 0.0
    cands = []
    for f in api_features(env, 'LT_C_BLDGINFO', lonlat_box(lon, lat, R)):
        p = f['properties']
        try:
            g = geom_tm(f['geometry']).buffer(0)
        except Exception:
            continue
        floors, under, h = int(num(p.get('grnd_flr'))), int(num(p.get('ugrnd_flr'))), num(p.get('height'))
        if g.is_empty or g.area < MIN_AREA or (floors == 0 and h == 0 and under > 0):
            continue  # too small, or an underground-only structure (nothing above ground)
        cands.append({'g': g, 'h': h, 'floors': floors, 'use': p.get('usability') or '', 'name': (p.get('bld_nm') or '').strip(),  # a bare 동 name ('타워2동') says nothing on a tag
                      'dong': (p.get('dong_nm') or '').strip(), 'year': (p.get('useapr_day') or '')[:4], 'src': 'api'})
    print(f'API LT_C_BLDGINFO: {len(cands)} footprints')
    for base in cfg.get('shp', []):
        sf = shapefile.Reader(os.path.join(ROOT, base), encoding='euc-kr')
        bx0, by0, bx1, by1 = sf.bbox
        if bx1 < E - R or bx0 > E + R or by1 < N - R or by0 > N + R:
            continue
        hits = [(i, sh) for i, sh in enumerate(sf.iterShapes())
                if not (sh.bbox[2] < E - R or sh.bbox[0] > E + R or sh.bbox[3] < N - R or sh.bbox[1] > N + R)]
        n0 = len(cands)
        for i, sh in hits:
            try:
                g = shape(sh.__geo_interface__).buffer(0)
            except Exception:
                continue
            if g.is_empty or g.area < MIN_AREA:
                continue
            r = sf.record(i)
            cands.append({'g': g, 'h': float(r['A16'] or 0), 'floors': int(r['A26'] or 0), 'use': r['A8'] or '', 'name': (r['A24'] or '').strip(),
                          'dong': (r['A25'] or '').strip(), 'year': (r['A13'] or '')[:4], 'src': 'shp'})
        print(f'SHP {os.path.basename(base)}: +{len(cands) - n0} footprints')

    # ---- corrections from the config: register records that are plainly wrong (e.g. a 19-storey
    # apartment block filed as 지상 1층). {"name": ..., "dong_prefix": ..., "floors"/"h"/"use"}
    for o in cfg.get('overrides', []):
        n = 0
        for c in cands:
            if c['name'].replace(' ', '') != o['name'].replace(' ', '') or not c['dong'].startswith(o.get('dong_prefix', '')):
                continue
            for k in ('floors', 'h', 'use'):
                if k in o: c[k] = o[k]
            c['h_src'] = o.get('h_src', 'floors')
            n += 1
        print(f'override {o["name"]} {o.get("dong_prefix", "")}*: {n} footprints')

    # ---- targets: matched by name among the footprints
    targets = []
    for t in cfg['targets']:
        key = t['match'].replace(' ', '')
        hit = [c for c in cands if c['name'].replace(' ', '') == key]
        if not hit:
            raise SystemExit(f'target "{t["match"]}" not found near {cfg["center"]}')
        best = max(hit, key=lambda c: (c['h'] > 0) + (c['floors'] > 0) + bool(c['use']))
        g = unary_union([c['g'] for c in hit])
        t.setdefault('floors', max(c['floors'] for c in hit))
        if best['h'] > 0 and 'h' not in t: t['h'], t['h_src'] = best['h'], 'register'
        t.setdefault('use', best['use'] or '14000'); t.setdefault('year', best['year'])
        targets.append((t, g))
    tgt_union = unary_union([g for _, g in targets])
    # footprints on a target are replaced by it
    cands = [c for c in cands if c['g'].intersection(tgt_union).area < 0.3 * c['g'].area]

    # de-duplicate overlapping records (the API has a register record and a bare outline for many buildings)
    def info(c):
        return (c['h'] > 0) + (c['floors'] > 0) + bool(c['use']) + 0.5 * bool(c['name']) + 0.25 * (c['src'] == 'api')
    cands.sort(key=lambda c: (-info(c), -c['g'].area))
    ctree = shapely.STRtree([c['g'] for c in cands])
    kept, is_kept = [], np.zeros(len(cands), bool)
    for k, c in enumerate(cands):  # best-informed first; a later footprint mostly covered by a kept one is a duplicate
        g = c['g']
        if any(is_kept[o] and cands[o]['g'].intersection(g).area > 0.5 * g.area for o in ctree.query(g) if o != k):
            continue
        is_kept[k] = True
        kept.append(c)
    print(f'kept {len(kept)} of {len(cands)} after de-duplication')

    # ---- frame: origin at the (first) target's centre, its long edge along x
    t0 = targets[0][1]
    if t0 is None:
        raise SystemExit('first target needs a footprint')
    c0 = t0.centroid
    deg = cfg.get('rotate_deg', long_edge_deg(t0))
    fr = Frame(c0.x, c0.y, deg)
    clip = shapely.box(-half, -half, half, half)

    buildings = []
    # targets
    for t, g in targets:
        gz = fr.geom(g)
        floors = int(t.get('floors') or 0)
        h = float(t.get('h') or floors * LEVEL_H['tower'])
        b = {'tower': None, 'facade': t.get('facade'), 'antenna': None, 'tint': t.get('tint'), 'label': t['label'],
             'h': round(h, 1), 'h_src': t.get('h_src', 'floors'), 'floors': floors, 'style': t.get('style', style_of(t.get('use', '14000'), h, floors)),
             'use_cd': t.get('use', '14000'), 'year': str(t.get('year', '')), 'area': round(g.area), 'rects': rasterize(gz),
             'name': t['label'], 'tag': 'name'}
        for k in ('fine', 'cores', 'hold'):
            if k in t: b[k] = t[k]
        buildings.append(b)
    # context
    for c in kept:
        gz = fr.geom(c['g'])
        ct = gz.centroid
        if abs(ct.x) > half or abs(ct.y) > half:
            continue
        gz = gz.intersection(clip)
        if gz.is_empty or gz.area < MIN_AREA:
            continue
        rects = rasterize(gz)
        if not rects:
            continue
        floors, h, use = c['floors'], c['h'], c['use']
        if h > 0:
            h_src = c.get('h_src', 'register')
        else:  # no registered height: storeys x a typical storey height for the use
            h = max(1, floors) * LEVEL_H[style_of(use, floors * 3.6, floors)]
            h_src = 'floors'
        st = style_of(use, h, floors)
        if floors == 0:
            floors = max(1, round(h / LEVEL_H[st]))
        name = c['name'] or None
        b = {'tower': None, 'facade': None, 'antenna': None, 'tint': None, 'label': None, 'h': round(max(3.0, h), 1), 'h_src': h_src,
             'floors': floors, 'style': st, 'use_cd': use, 'year': c['year'], 'area': round(c['g'].area), 'rects': rects}
        if name:
            b['name'] = name
            if floors >= 8 or c['g'].area >= 1500:
                b['tag'] = 'name'
        buildings.append(b)

    # ---- ground from 연속지적도 parcels
    print('fetching parcels (LP_PA_CBND_BUBUN) ...')
    lon0, lat0 = TO_TM.transform(c0.x, c0.y, direction='INVERSE')
    parcels = api_features(env, 'LP_PA_CBND_BUBUN', lonlat_box(lon0, lat0, 340 * 1.45))  # covers the rotated 640 m square
    print(f'{len(parcels)} parcels')
    pg, pc = [], []
    for f in parcels:
        jb = (f['properties'].get('jibun') or '').strip()
        code = JIMOK.get(jb[-1:], '.')
        try:
            g = geom_tm(f['geometry']).buffer(0)
        except Exception:
            continue
        pg.append(g)
        pc.append(code)
    tree = shapely.STRtree(pg)
    ii, jj = np.meshgrid(np.arange(G_N), np.arange(G_N))
    gx = G_ORIGIN + (ii + 0.5) * G_CELL
    gz = G_ORIGIN + (jj + 0.5) * G_CELL
    E_, N_ = fr.inv(gx.ravel(), gz.ravel())
    pts = shapely.points(E_, N_)
    q = tree.query(pts, predicate='within')
    grid = np.full(G_N * G_N, '.', dtype='<U1')
    pc_arr = np.array(pc)
    grid[q[0]] = pc_arr[q[1]]
    grid = grid.reshape(G_N, G_N)
    rows = []
    for j in range(G_N):
        row, out, k = grid[j], [], 0
        while k < G_N:
            s = k
            while k < G_N and row[k] == row[s]: k += 1
            n = k - s
            out.append(row[s] + (str(n) if n > 1 else ''))
        rows.append(''.join(out))
    ground = {'cell': G_CELL, 'n': G_N, 'origin': G_ORIGIN, 'rle': '/'.join(rows), 'legend': LEGEND}

    # ---- focus / document
    tg = fr.geom(t0)
    bx0, bz0, bx1, bz1 = tg.bounds
    th = buildings[0]['h']
    doc = {
        'version': 1, 'id': cfg['id'], 'title': cfg['title'],
        'source': 'vworld LT_C_BLDGINFO + GIS건물통합정보 SHP (국토교통부, CC BY) · 지목: LP_PA_CBND_BUBUN (연속지적도)',
        'origin': [round(lon0, 6), round(lat0, 6)], 'rotate_deg': deg, 'center': [round((bx0 + bx1) / 2, 1), round((bz0 + bz1) / 2, 1)],
        'half': half, 'hand': [], 'buildings': buildings,
        'focus': [round((bx0 + bx1) / 2, 1), th, round((bz0 + bz1) / 2, 1), round(max(bx1 - bx0, bz1 - bz0), 1)],
        'ground': ground,
    }
    for k in ('dense', 'tough_mul', 'view', 'backdrop'):
        if k in cfg: doc[k] = cfg[k]
    out = os.path.join(ROOT, 'data', 'maps', cfg['id'] + '.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
    codes = {c: int((grid == c).sum()) for c in set(grid.ravel())}
    named = sorted([b for b in buildings if b.get('name') and not b.get('label')], key=lambda b: -b['area'])
    print(f'wrote {out}: {len(buildings)} buildings, rotate {deg}°, ground {codes}')
    print('largest named neighbours:', [b['name'] for b in named[:12]])


if __name__ == '__main__':
    main(sys.argv[1])
