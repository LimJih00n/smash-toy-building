// Toy versions of the weapon models (?style=toy): chunky shapes, candy colours, matte plastic.
// Each builder matches the layout its realistic counterpart in weapons.js relies on
// (axes, pivot, named children, fuse tip), so the weapon code runs unchanged.
import * as THREE from 'three';

const plastic = (color, roughness = 0.4) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
const RED = 0xff4d5e, YELLOW = 0xffd166, BLUE = 0x4dabf7, ORANGE = 0xffa94d, PINK = 0xf783ac, WHITE = 0xf8f9fa, GREY = 0x868e96, NAVY = 0x3b4a6b;
const shadows = (g, skip) => { g.traverse((m) => { if (m.isMesh && !skip?.includes(m)) m.castShadow = true; }); return g; };

/** squeaky toy hammer: red bellows head along z, yellow caps, blue handle down -y */
export function hammer() {
  const g = new THREE.Group();
  const L = 4.6, N = 7, pts = [];
  for (let i = 0; i <= 84; i++) {
    const t = i / 84, tri = 1 - Math.abs(2 * ((t * N) % 1) - 1);
    pts.push(new THREE.Vector2(1.45 + 0.28 * tri, -L / 2 + L * t));
  }
  const head = new THREE.Mesh(new THREE.LatheGeometry(pts, 32).rotateX(Math.PI / 2), plastic(RED, 0.35));
  const capG = new THREE.CylinderGeometry(1.85, 1.85, 0.6, 32).rotateX(Math.PI / 2);
  const capM = plastic(YELLOW);
  const c1 = new THREE.Mesh(capG, capM); c1.position.z = L / 2 + 0.2;
  const c2 = new THREE.Mesh(capG, capM); c2.position.z = -L / 2 - 0.2;
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 10.4, 16), plastic(BLUE)); handle.position.y = -6.6;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.85, 20, 14), plastic(RED, 0.35)); knob.position.y = -11.9;
  g.add(head, c1, c2, handle, knob);
  return shadows(g);
}

/** cartoon bomb in navy plastic; fuse tip at the same spot as the realistic one */
export function bomb() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 20), plastic(NAVY, 0.28));
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.58, 0.5, 20), plastic(YELLOW)); cap.position.y = 1.25;
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.4, 0), new THREE.Vector3(0.2, 1.9, 0), new THREE.Vector3(0.6, 2.2, 0.1), new THREE.Vector3(0.9, 2.1, 0.2)]);
  const fuse = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.12, 8), plastic(0xf1e3c4, 0.8));
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.12, 8, 40).rotateX(Math.PI / 2), plastic(RED));
  g.add(body, cap, fuse, band);
  g.userData.tip = [0.9, 2.1, 0.2];
  return shadows(g);
}

/** toy satellite: white drum, yellow ring, pink lens pointing down, segmented blue panels */
export function satellite() {
  const g = new THREE.Group();
  const white = plastic(WHITE, 0.35);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 8, 24), white);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.9, 10, 32).rotateX(Math.PI / 2), plastic(YELLOW)); ring.position.y = -4;
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(3.0, 4.0, 2.4, 24), plastic(PINK, 0.3)); lens.position.y = -5.6;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 40, 10).rotateZ(Math.PI / 2), plastic(0xced4da));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 5, 8), white); mast.position.y = 6.5;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12), plastic(RED, 0.35)); ball.position.y = 9.4;
  g.add(body, ring, lens, arm, mast, ball);
  const panelG = new THREE.BoxGeometry(6.4, 0.5, 7), panelM = plastic(0x4c6ef5, 0.3);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(panelG, panelM); p.position.x = s * (9 + i * 7.1 + 3.2); g.add(p);
  }
  return g;
}

/** low-poly faceted rock (the shared meteor material still paints the glowing cracks) */
export function meteorGeo() {
  const g = new THREE.IcosahedronGeometry(1, 1); // non-indexed: computeVertexNormals gives flat facets
  const p = g.attributes.position, v = new THREE.Vector3(), r = new Map();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const key = v.x.toFixed(3) + ',' + v.y.toFixed(3) + ',' + v.z.toFixed(3); // shared corners move together
    if (!r.has(key)) r.set(key, 0.84 + Math.random() * 0.3);
    v.multiplyScalar(r.get(key)); v.x *= 1.1; v.z *= 0.92;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** toy rocket along +z: white body, red nose and fins, porthole, cartoon flame named 'flame' */
export function missile() {
  const g = new THREE.Group();
  const red = plastic(RED, 0.35);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 4.0, 24).rotateX(Math.PI / 2), plastic(WHITE, 0.35));
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(0.62 * Math.pow(1 - t * t, 0.6), 1.9 * t)); }
  const nose = new THREE.Mesh(new THREE.LatheGeometry(pts, 24).rotateX(Math.PI / 2), red); nose.position.z = 2.0;
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), plastic(BLUE, 0.2)); port.scale.set(1, 0.45, 1); port.position.set(0, 0.6, 0.8);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 6, 20).rotateX(Math.PI / 2), plastic(YELLOW)); rim.position.set(0, 0.62, 0.8);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.64, 0.64, 0.35, 24).rotateX(Math.PI / 2), plastic(YELLOW)); band.position.z = -1.2;
  const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.5, 20).rotateX(Math.PI / 2), plastic(GREY, 0.5)); noz.position.z = -2.25;
  g.add(body, nose, port, rim, band, noz);
  const s = new THREE.Shape();
  s.moveTo(0.4, 0.5); s.lineTo(-0.9, 1.5); s.quadraticCurveTo(-1.6, 1.85, -1.95, 1.45); s.lineTo(-1.95, 0.5); s.lineTo(0.4, 0.5);
  const finG = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 6 }).translate(0, 0, -0.08).rotateY(-Math.PI / 2);
  for (let i = 0; i < 4; i++) { const pv = new THREE.Group(); pv.add(new THREE.Mesh(finG, red)); pv.rotation.z = i * Math.PI / 2 + Math.PI / 4; g.add(pv); }
  const flame = new THREE.Group(); flame.name = 'flame';
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.6, 16).rotateX(-Math.PI / 2).translate(0, 0, -3.8),
    new THREE.MeshBasicMaterial({ color: 0xff8c42, transparent: true, opacity: 0.85, depthWrite: false }));
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 12).rotateX(-Math.PI / 2).translate(0, 0, -3.3), new THREE.MeshBasicMaterial({ color: 0xffe066 }));
  flame.add(inner, outer); g.add(flame);
  return shadows(g, [outer, inner]);
}

// yellow band with black trefoils, wrapped round the toy nuke
function trefoilTexture() {
  const W = 1024, H = 146, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#ffd43b'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#212529'; x.fillRect(0, 0, W, 12); x.fillRect(0, H - 12, W, 12);
  for (let k = 0; k < 4; k++) {
    const cx = 128 + k * 256, cy = H / 2, R = 50;
    x.beginPath(); x.arc(cx, cy, R * 0.2, 0, Math.PI * 2); x.fill();
    for (let b = 0; b < 3; b++) {
      const a = Math.PI / 2 + b * Math.PI * 2 / 3;
      x.beginPath(); x.arc(cx, cy, R, a - Math.PI / 6, a + Math.PI / 6); x.arc(cx, cy, R * 0.32, a + Math.PI / 6, a - Math.PI / 6, true); x.closePath(); x.fill();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** chubby cartoon nuke falling nose (-y) first: yellow capsule, trefoil band, red tail fins */
export function nuke() {
  const g = new THREE.Group();
  const red = plastic(RED, 0.35), dark = plastic(0x343a40, 0.45);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.65, 3.4, 10, 32), plastic(0xffd43b));
  const band = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.68, 1.5, 48, 1, true), new THREE.MeshStandardMaterial({ map: trefoilTexture(), roughness: 0.4, metalness: 0 }));
  band.position.y = -0.3;
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.68, 1.68, 0.3, 48, 1, true), dark); stripe.position.y = 1.3;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.35, 1.8, 24), dark); tail.position.y = 4.0;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.2, 8, 32).rotateX(Math.PI / 2), red); ring.position.y = 5.9;
  g.add(body, band, stripe, tail, ring);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.0, 1.6), red);
    fin.position.set(0, 5.0, 1.3); const pv = new THREE.Group(); pv.add(fin); pv.rotation.y = i * Math.PI / 2; g.add(pv);
  }
  return shadows(g);
}

/** toy sword: blade along +y from the guard at the origin (tip at y = 7.6), grip and pommel below */
export function sword() {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.45, 0.2); s.lineTo(0.45, 0.2); s.lineTo(0.45, 6.6); s.lineTo(0, 7.6); s.lineTo(-0.45, 6.6); s.lineTo(-0.45, 0.2);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2 }).translate(0, 0, -0.08), plastic(0xe9eef5, 0.3));
  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.14, 5.6, 0.36), plastic(0xb8c6d8, 0.35)); fuller.position.y = 3.5;
  const guard = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.42, 0.55), plastic(YELLOW));
  const knobG = new THREE.SphereGeometry(0.34, 16, 12), knobM = plastic(YELLOW);
  const k1 = new THREE.Mesh(knobG, knobM); k1.position.x = 1.25;
  const k2 = new THREE.Mesh(knobG, knobM); k2.position.x = -1.25;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.9, 16), plastic(BLUE)); grip.position.y = -1.15;
  const ringG = new THREE.TorusGeometry(0.25, 0.06, 6, 20).rotateX(Math.PI / 2), ringM = plastic(RED, 0.35);
  for (const y of [-0.6, -1.15, -1.7]) { const r = new THREE.Mesh(ringG, ringM); r.position.y = y; g.add(r); }
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.4, 18, 12), plastic(RED, 0.35)); pommel.position.y = -2.3;
  g.add(blade, fuller, guard, k1, k2, grip, pommel);
  return g;
}

/** toy blaster colours for the machine-gun rig (same parts, plastic instead of gunmetal) */
export function gunMats() {
  return { dark: plastic(RED, 0.35), steel: plastic(ORANGE, 0.35), olive: plastic(BLUE, 0.4), brass: plastic(YELLOW, 0.4) };
}
