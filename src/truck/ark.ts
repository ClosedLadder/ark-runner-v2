/**
 * ARK — procedural matte-black 6×6 expedition truck.
 *
 * Visual contract: ARK_REFERENCE_DOSSIER.md §2 (canonical feature map — LAW).
 * Every depiction choice below cites the dossier row it implements.
 *
 * Axes (CONTRACTS §2): forward = −Z, up = +Y, right = +X.
 * Truck anchor at the origin, tires kiss y = 0.
 *
 * Budgets (PERF-PLAYBOOK §7, truck row — tighter than the WS2 draft):
 *   ≤ 25_000 rendered tris, ≤ 25 draw calls, 2 SpotLights, one 256² atlas,
 *   static body merged into ≤ 3 material groups (paint / glass / trim).
 *
 * steer01 > 0 steers right (wheels yaw toward +X) and rolls the body left.
 * hull01 is remaining hull, 1 = fresh, 0 = wrecked.
 *
 * Imports: three only. No external assets. Texture is a boot-time canvas.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface ArkRig {
  group: THREE.Group;
  setSpeedVisual(rpm01: number, dt: number): void;
  setSteerVisual(steer01: number): void;
  setDamageVisual(hull01: number): void;
  bump(strengthM: number): void;
  headlights: THREE.SpotLight[];
}

// ---------------------------------------------------------------------------
// Measured stance. Tweak here, not in the part builders.
// ---------------------------------------------------------------------------

const AXLE_Y = 0.55;
const AXLE_Z = [-2.06, 0.82, 2.0] as const;
const TRACK_X = 1.05;
const NOSE_Z = -3.05;
const TAIL_Z = 3.0;

// Dossier §2.2: two-volume profile. Box roof 2.9, cab roof 2.28 — clear step-up.
const BOX = { z0: -0.66, z1: 2.76, y0: 1.12, y1: 2.9, halfW: 1.16 };
const CAB = { z0: -1.9, z1: -0.9, y0: 1.06, y1: 2.28, halfW: 1.1 };

/** Matte black per dossier §2.15 — never glossy grey. */
const PAINT = 0x1b1d20;
const PAINT_PANEL = 0x141518;
const PAINT_DEEP = 0x0a0b0d;
const PAINT_GAP = 0x050607;
const PAINT_EDGE = 0x23262b;
const ROCK_A = 0xc8c1af;
const ROCK_B = 0xaea698;
const ROCK_C = 0xddd6c6;
const ROCK_D = 0x9a927f;
const STEEL = 0xd5d8dc;
const STEEL_DARK = 0x8e949c;
const ORANGE = 0xe25a16;

const MAX_STEER = (25 * Math.PI) / 180;
const MAX_TRIS = 25000;
const MAX_DRAWS = 25;

// Scratch. Tick paths must not allocate.
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3(1, 1, 1);
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _color = new THREE.Color();

interface WheelSpec {
  x: number;
  y: number;
  z: number;
  axle: 0 | 1 | 2;
}

// Dossier §2.9: ONE isolated front axle + close-coupled rear tandem. §2.13:
// NO spare wheel on the rear wall (verified on the finished truck).
const WHEELS: readonly WheelSpec[] = [
  { x: -TRACK_X, y: AXLE_Y, z: AXLE_Z[0], axle: 0 },
  { x: TRACK_X, y: AXLE_Y, z: AXLE_Z[0], axle: 0 },
  { x: -TRACK_X, y: AXLE_Y, z: AXLE_Z[1], axle: 1 },
  { x: TRACK_X, y: AXLE_Y, z: AXLE_Z[2], axle: 2 },
  { x: -TRACK_X, y: AXLE_Y, z: AXLE_Z[2], axle: 2 },
  { x: TRACK_X, y: AXLE_Y, z: AXLE_Z[1], axle: 1 },
];

interface Kit {
  paint: THREE.BufferGeometry[];
  glass: THREE.BufferGeometry[];
  trim: THREE.BufferGeometry[];
  white: THREE.BufferGeometry[];
  flicker: THREE.BufferGeometry[];
  red: THREE.BufferGeometry[];
  amber: THREE.BufferGeometry[];
  glow: THREE.BufferGeometry[];
  glowFlicker: THREE.BufferGeometry[];
}

type UvMode = 'auto' | 'grunge' | 'clean';

function hash01(i: number): number {
  let x = i | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry {
  if (rx !== 0) geo.rotateX(rx);
  if (ry !== 0) geo.rotateY(ry);
  if (rz !== 0) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

/** Vertex color + roughness-atlas UV. Clean panels sample the flat texel (roughness 0.60). */
function colorize(geo: THREE.BufferGeometry, hex: number, uv: UvMode, shade: boolean): void {
  const pos = geo.getAttribute('position');
  const nrm = geo.getAttribute('normal');
  const uvAttr = geo.getAttribute('uv') as THREE.BufferAttribute;
  const n = pos.count;
  const colors = new Float32Array(n * 3);
  _color.set(hex);
  for (let i = 0; i < n; i += 1) {
    const ny = nrm.getY(i);
    let ao = 1;
    if (shade) {
      ao = ny >= 0 ? 0.88 + 0.12 * ny : 0.68 + 0.2 * (ny + 1);
    }
    colors[i * 3] = _color.r * ao;
    colors[i * 3 + 1] = _color.g * ao;
    colors[i * 3 + 2] = _color.b * ao;
    const y = pos.getY(i);
    let u = 0.75;
    let v = 0.25;
    if (uv === 'grunge' || (uv === 'auto' && y < 1.02)) {
      u = fract(pos.getX(i) * 0.37 + pos.getZ(i) * 0.19);
      const t = Math.min(1, Math.max(0, y / 1.02));
      v = 0.54 + t * 0.44;
    }
    uvAttr.setXY(i, u, v);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  uvAttr.needsUpdate = true;
}

function paintBox(
  kit: Kit,
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  hex: number,
  rx = 0,
  ry = 0,
  rz = 0,
  uv: UvMode = 'auto',
  shade = true,
): void {
  const geo = place(new THREE.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz);
  colorize(geo, hex, uv, shade);
  kit.paint.push(geo);
}

function plainBox(
  bucket: THREE.BufferGeometry[],
  sx: number,
  sy: number,
  sz: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  bucket.push(place(new THREE.BoxGeometry(sx, sy, sz), x, y, z, rx, ry, rz));
}

function paintCyl(
  kit: Kit,
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: number,
  rx = 0,
  ry = 0,
  rz = 0,
  shade = true,
): void {
  const geo = place(new THREE.CylinderGeometry(rTop, rBot, h, seg), x, y, z, rx, ry, rz);
  colorize(geo, hex, 'auto', shade);
  kit.paint.push(geo);
}

function trimCyl(
  kit: Kit,
  rTop: number,
  rBot: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: number,
  rx = 0,
  ry = 0,
  rz = 0,
): void {
  const geo = place(new THREE.CylinderGeometry(rTop, rBot, h, seg), x, y, z, rx, ry, rz);
  colorize(geo, hex, 'clean', false);
  kit.trim.push(geo);
}

function mergeBucket(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat: THREE.BufferGeometry[] = [];
  for (let i = 0; i < geos.length; i += 1) {
    const src = geos[i];
    if (!src) continue;
    const ni = src.index ? src.toNonIndexed() : src;
    if (ni !== src) src.dispose();
    flat.push(ni);
  }
  const merged = mergeGeometries(flat, false);
  for (let i = 0; i < flat.length; i += 1) flat[i]?.dispose();
  if (!merged) throw new Error('ark: mergeGeometries failed');
  return merged;
}

function meshOf(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// Atlas — one 256² canvas. Top half: roughness grunge. Bottom-left: blob
// shadow. Bottom-right: clean roughness texel (0.60). flipY is on, so
// canvas y=0 maps to v=1.
// ---------------------------------------------------------------------------

interface Atlas {
  texture: THREE.CanvasTexture;
  image: ImageData;
  base: Uint8ClampedArray;
  ctx: CanvasRenderingContext2D;
}

function makeAtlas(): Atlas {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('ark: 2d canvas unavailable');
  const data = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y += 1) {
    for (let x = 0; x < 256; x += 1) {
      const p = (y * 256 + x) * 4;
      if (y < 128) {
        const n = hash01(x * 13 + y * 257 + 3);
        const n2 = hash01(x * 91 + y * 17 + 9);
        const speck = n > 0.8 ? 36 : 0;
        const v = Math.min(255, 168 + Math.floor(n2 * 52) + speck);
        data[p] = v;
        data[p + 1] = v;
        data[p + 2] = v;
        data[p + 3] = 255;
      } else if (x < 128) {
        const dx = x + 0.5 - 64;
        const dy = y + 0.5 - 192;
        const dist = Math.hypot(dx, dy) / 62;
        let a = 0;
        if (dist < 1) {
          const e = 1 - dist;
          const s = e * e * (3 - 2 * e);
          a = s * s;
        }
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = Math.max(0, Math.min(255, Math.round(a * 230)));
      } else {
        const n = hash01(x + y * 97);
        const v = 148 + Math.floor(n * 12);
        data[p] = v;
        data[p + 1] = v;
        data[p + 2] = v;
        data[p + 3] = 255;
      }
    }
  }
  const image = new ImageData(data, 256, 256);
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, image, base: new Uint8ClampedArray(data), ctx };
}

function applyWear(atlas: Atlas, hull: number): void {
  const d = atlas.image.data;
  const base = atlas.base;
  const wear = 1 - hull;
  const limit = 128 * 256 * 4;
  for (let p = 0; p < limit; p += 4) {
    const v = base[p] ?? 0;
    const boosted = v + (255 - v) * wear * 0.85;
    const b = boosted > 255 ? 255 : boosted;
    d[p] = b;
    d[p + 1] = b;
    d[p + 2] = b;
  }
  atlas.ctx.putImageData(atlas.image, 0, 0);
  atlas.texture.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------

function mid(a: number, b: number): number {
  return (a + b) * 0.5;
}

function addWindowX(kit: Kit, x: number, y: number, z: number, h: number, dz: number, sign: number): void {
  paintBox(kit, 0.012, h + 0.045, dz + 0.045, x + sign * 0.006, y, z, PAINT_EDGE, 0, 0, 0, 'clean', false);
  plainBox(kit.glass, 0.02, h, dz, x + sign * 0.045, y, z);
}

/** Dossier §2.11 — large twin-pane mirrors on A-pillar arms, both sides. */
function addMirror(kit: Kit, sign: number): void {
  const zA = -1.78;
  // Arm out from the A-pillar.
  paintCyl(kit, 0.02, 0.02, 0.48, 6, sign * 1.29, 2.02, zA, PAINT, 0, 0, Math.PI / 2, false);
  // Tall housing with two stacked panes facing rearward (toward the driver).
  paintBox(kit, 0.24, 0.58, 0.06, sign * 1.52, 1.88, zA, PAINT, 0, 0, 0, 'clean');
  plainBox(kit.glass, 0.18, 0.24, 0.014, sign * 1.52, 2.02, zA + 0.036);
  plainBox(kit.glass, 0.18, 0.24, 0.014, sign * 1.52, 1.74, zA + 0.036);
  paintBox(kit, 0.24, 0.03, 0.065, sign * 1.52, 1.88, zA, PAINT_DEEP, 0, 0, 0, 'clean', false);
  // Diagonal lower brace back to the door.
  paintCyl(kit, 0.014, 0.014, 0.52, 5, sign * 1.3, 1.47, zA + 0.05, PAINT_DEEP, 0, 0, sign * 2.08, false);
}

function addFender(kit: Kit, sign: number): void {
  const x = sign * TRACK_X;
  const z = AXLE_Z[0];
  paintBox(kit, 0.5, 0.07, 1.15, x, 1.2, z - 0.02, PAINT);
  paintBox(kit, 0.06, 0.32, 1.05, x + sign * 0.24, 1.02, z, PAINT);
  paintBox(kit, 0.46, 0.05, 0.32, x, 1.08, z - 0.62, PAINT, 0.42, 0, 0);
  paintBox(kit, 0.46, 0.05, 0.28, x, 1.08, z + 0.58, PAINT, -0.35, 0, 0);
}

/**
 * Dossier §2.3–2.4 — climbing-hold panel: RIGHT wall, immediately AFT of the
 * entry door, bounded to TWO panel bays over the rear bogie. Tan/grey resin
 * holds, organic non-grid scatter, bolt heads, unused T-nut holes between.
 * Nowhere else.
 */
function addHolds(kit: Kit): void {
  let seed = 0x51a7c0de;
  const rnd = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // Door aft edge is z=0.56; two 0.78 bays follow; bogie wheels at 0.82 / 2.0.
  const zMin = 0.68;
  const zMax = 2.16;
  const yMin = 1.45;
  const yMax = 2.55;
  const placed: { y: number; z: number; r: number }[] = [];
  const cols = [ROCK_A, ROCK_B, ROCK_C, ROCK_D];
  let guard = 0;
  while (placed.length < 36 && guard < 900) {
    guard += 1;
    const z = zMin + rnd() * (zMax - zMin);
    const y = yMin + rnd() * (yMax - yMin);
    // Keep clear of the rear stacked louver vents.
    if (Math.abs(z - 2.5) < 0.36 && Math.abs(y - 2.44) < 0.26) continue;
    if (Math.abs(z - 2.28) < 0.36 && Math.abs(y - 1.7) < 0.26) continue;
    const r = 0.06 + rnd() * 0.055;
    let ok = true;
    for (let i = 0; i < placed.length; i += 1) {
      const p = placed[i];
      if (!p) continue;
      const dz = p.z - z;
      const dy = p.y - y;
      const m = (p.r + r) * 0.62;
      if (dz * dz + dy * dy < m * m) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    placed.push({ y, z, r });
    // Organic resin blob: jittered icosahedron, squashed against the wall.
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const salt = (placed.length * 101) | 0;
    for (let i = 0; i < pos.count; i += 1) {
      const n = 1 + (hash01((i * 31 + salt) | 0) - 0.5) * 0.55;
      pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n, pos.getZ(i) * n);
    }
    geo.scale(r * 0.72, r, r * 0.92);
    geo.rotateY(rnd() * Math.PI * 2);
    geo.translate(BOX.halfW - 0.015, y, z);
    const flat = geo.toNonIndexed();
    geo.dispose();
    flat.computeVertexNormals();
    colorize(flat, cols[placed.length % cols.length] ?? ROCK_A, 'grunge', false);
    kit.paint.push(flat);
    // Bolt head on the hold's outer face.
    const bolt = place(new THREE.CylinderGeometry(0.017, 0.017, 0.03, 6), 0, 0, 0, 0, 0, Math.PI / 2);
    bolt.translate(BOX.halfW - 0.015 + r * 0.66, y, z);
    const bf = bolt.toNonIndexed();
    bolt.dispose();
    colorize(bf, 0x2c2f34, 'clean', false);
    kit.paint.push(bf);
  }
  // Unused T-nut holes scattered between holds.
  let tn = 0;
  guard = 0;
  while (tn < 16 && guard < 400) {
    guard += 1;
    const z = zMin + rnd() * (zMax - zMin);
    const y = yMin + rnd() * (yMax - yMin);
    let ok = true;
    for (let i = 0; i < placed.length; i += 1) {
      const p = placed[i];
      if (!p) continue;
      const dz = p.z - z;
      const dy = p.y - y;
      const m = p.r + 0.09;
      if (dz * dz + dy * dy < m * m) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    tn += 1;
    const hole = place(new THREE.CylinderGeometry(0.013, 0.013, 0.012, 8), 0, 0, 0, 0, 0, Math.PI / 2);
    hole.translate(BOX.halfW + 0.002, y, z);
    const hf = hole.toNonIndexed();
    hole.dispose();
    colorize(hf, PAINT_GAP, 'clean', false);
    kit.paint.push(hf);
  }
  // Panel-bay seams bounding the field.
  const seamY = mid(yMin, yMax);
  for (const sz of [0.64, 1.42, 2.2]) {
    paintBox(kit, 0.012, yMax - yMin, 0.025, BOX.halfW + 0.004, seamY, sz, PAINT_GAP, 0, 0, 0, 'clean', false);
  }
}

/** Rounded-rect panel in the YZ plane, extruded along +X after the transform. */
function roundedRectYZ(w: number, h: number, r: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const x0 = -w / 2;
  const y0 = -h / 2;
  s.moveTo(x0 + r, y0);
  s.lineTo(x0 + w - r, y0);
  s.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
  s.lineTo(x0 + w, y0 + h - r);
  s.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
  s.lineTo(x0 + r, y0 + h);
  s.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 6 });
  geo.rotateY(-Math.PI / 2); // (u,v,w) -> (-w, v, u): shape-x becomes world z
  return geo;
}

/**
 * Dossier §2.7 — tall rounded-corner entry door on the RIGHT wall,
 * hinge on the FORWARD edge. Aft of it begins the hold field (§2.3).
 */
function addEntryDoor(kit: Kit): void {
  const doorZ = 0.15;
  const doorY = 1.95;
  const frame = roundedRectYZ(0.92, 1.65, 0.1, 0.02);
  frame.translate(BOX.halfW + 0.02, doorY, doorZ);
  colorize(frame, PAINT_EDGE, 'clean', false);
  kit.paint.push(frame);
  const door = roundedRectYZ(0.84, 1.57, 0.09, 0.03);
  door.translate(BOX.halfW + 0.038, doorY, doorZ);
  colorize(door, 0x23262b, 'clean', false);
  kit.paint.push(door);
  // Hinges on the forward (-Z) edge.
  const hingeZ = doorZ - 0.41;
  paintCyl(kit, 0.022, 0.022, 0.09, 6, BOX.halfW + 0.045, 1.5, hingeZ, PAINT_EDGE, 0, 0, 0, false);
  paintCyl(kit, 0.022, 0.022, 0.09, 6, BOX.halfW + 0.045, 2.4, hingeZ, PAINT_EDGE, 0, 0, 0, false);
  // Handle near the aft edge: vertical bar on standoff pads.
  paintBox(kit, 0.035, 0.22, 0.045, BOX.halfW + 0.055, 1.82, doorZ + 0.28, PAINT_EDGE, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.02, 0.05, 0.04, BOX.halfW + 0.045, 1.72, doorZ + 0.28, PAINT_DEEP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.02, 0.05, 0.04, BOX.halfW + 0.045, 1.92, doorZ + 0.28, PAINT_DEEP, 0, 0, 0, 'clean', false);
  // Step below the door.
  paintBox(kit, 0.44, 0.05, 0.5, BOX.halfW + 0.16, 1.08, doorZ, PAINT_DEEP, 0, 0, 0, 'grunge', false);
}

function addLouverVent(kit: Kit, x: number, y: number, z: number, w: number, h: number, sign: number): void {
  paintBox(kit, 0.02, h + 0.05, w + 0.05, x + sign * 0.004, y, z, PAINT_GAP, 0, 0, 0, 'clean', false);
  for (let i = 0; i < 4; i += 1) {
    const yy = y - h / 2 + 0.05 + (i * (h - 0.1)) / 3;
    paintBox(kit, 0.025, 0.028, w, x + sign * 0.012, yy, z, PAINT_EDGE, 0, 0, 0, 'clean', false);
  }
}

/** Dossier §2.8 — chimney: ORANGE collar + black cap, RIGHT edge of box roof. */
function addChimney(kit: Kit): void {
  const x = 1.0;
  const z = 0.3;
  const base = BOX.y1;
  paintCyl(kit, 0.05, 0.05, 0.22, 10, x, base + 0.11, z, PAINT_DEEP, 0, 0, 0, false);
  paintCyl(kit, 0.095, 0.058, 0.07, 10, x, base + 0.25, z, ORANGE, 0, 0, 0, false);
  paintCyl(kit, 0.02, 0.02, 0.05, 6, x, base + 0.27, z, PAINT_DEEP, 0, 0, 0, false);
  paintCyl(kit, 0.105, 0.105, 0.03, 10, x, base + 0.31, z, PAINT_DEEP, 0, 0, 0, false);
}

/** Dossier §2.2 — box as an extruded side profile: chamfered rear top corners,
 *  chamfered front top corners, chamfered rear-bottom (departure angle). */
function boxProfileGeo(): THREE.BufferGeometry {
  const z0 = BOX.z0;
  const z1 = BOX.z1;
  const y0 = BOX.y0;
  const y1 = BOX.y1;
  const s = new THREE.Shape();
  s.moveTo(z0, y0);
  s.lineTo(z0, y1 - 0.22);
  s.lineTo(z0 + 0.22, y1);
  s.lineTo(z1 - 0.28, y1);
  s.lineTo(z1, y1 - 0.28);
  s.lineTo(z1, y0 + 0.34);
  s.lineTo(z1 - 0.4, y0);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: BOX.halfW * 2, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2); // (u,v,w) -> (-w, v, u)
  geo.translate(BOX.halfW, 0, 0);
  return geo;
}

function addRearDoor(kit: Kit): void {
  const z = BOX.z1;
  const y = 2.06;
  const h = 1.12;
  const w = BOX.halfW * 2 - 0.44;
  paintBox(kit, w, h, 0.03, 0.06, y, z + 0.012, PAINT_PANEL, 0, 0, 0, 'clean');
  const insetX = w * 0.5 - 0.08;
  const insetY = h * 0.5 - 0.08;
  const rivet = (x: number, yy: number): void => {
    paintCyl(kit, 0.016, 0.016, 0.012, 5, x, yy, z + 0.032, 0xa8aeb6, Math.PI / 2, 0, 0, false);
  };
  const nx = 11;
  const ny = 6;
  for (let i = 0; i < nx; i += 1) {
    const x = -insetX + (i / (nx - 1)) * insetX * 2 + 0.06;
    rivet(x, y + insetY);
    rivet(x, y - insetY);
  }
  for (let i = 1; i < ny - 1; i += 1) {
    const yy = y - insetY + (i / (ny - 1)) * insetY * 2;
    rivet(0.06 - insetX, yy);
    rivet(0.06 + insetX, yy);
  }
  // Departure-angle chamfer panel below the hatch.
  paintBox(kit, w, 0.56, 0.04, 0.06, 1.29, 2.56, PAINT, 0.866, 0, 0, 'auto', true);
}

function buildBody(kit: Kit): void {
  // ---- habitat box: extruded profile with chamfered corners (§2.2) ----
  const boxGeo = boxProfileGeo();
  colorize(boxGeo, PAINT, 'auto', true);
  kit.paint.push(boxGeo);

  // Roof lip — thin perimeter line. Rear lip omitted: the top-rear chamfer.
  const lip = 0.045;
  const lipZ0 = BOX.z0;
  const lipZ1 = BOX.z1 - 0.28;
  const lipZ = mid(lipZ0, lipZ1);
  paintBox(kit, lip, 0.055, lipZ1 - lipZ0, BOX.halfW - lip * 0.3, BOX.y1 + 0.02, lipZ, PAINT);
  paintBox(kit, lip, 0.055, lipZ1 - lipZ0, -BOX.halfW + lip * 0.3, BOX.y1 + 0.02, lipZ, PAINT);
  paintBox(kit, BOX.halfW * 2, 0.055, lip, 0, BOX.y1 + 0.02, BOX.z0 + 0.01, PAINT);

  // Belt line and lower rub rail.
  const boxZ = mid(BOX.z0, BOX.z1);
  paintBox(kit, 0.03, 0.045, 3.2, BOX.halfW + 0.012, 2.42, boxZ, PAINT_EDGE, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.03, 0.045, 3.2, -BOX.halfW - 0.012, 2.42, boxZ, PAINT_EDGE, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.028, 0.04, 3.2, BOX.halfW + 0.01, BOX.y0 + 0.08, boxZ, PAINT_DEEP, 0, 0, 0, 'grunge', false);
  paintBox(kit, 0.028, 0.04, 3.2, -BOX.halfW - 0.01, BOX.y0 + 0.08, boxZ, PAINT_DEEP, 0, 0, 0, 'grunge', false);

  // ---- RIGHT wall (§2.5): window HIGH between cab and door, door, hold
  // field, stacked louvered vents near the rear. ----
  addWindowX(kit, BOX.halfW, 2.44, -0.44, 0.34, 0.42, 1);
  addEntryDoor(kit);
  addHolds(kit);
  addLouverVent(kit, BOX.halfW, 2.44, 2.5, 0.5, 0.26, 1);
  addLouverVent(kit, BOX.halfW, 1.7, 2.28, 0.5, 0.26, 1);

  // ---- LEFT wall (§2.6): small high forward window, long blank mid wall,
  // two stacked horizontal windows near the rear (upper aft, lower forward).
  // NO door, NO holds on this side. ----
  addWindowX(kit, -BOX.halfW, 2.42, -0.4, 0.34, 0.5, -1);
  addWindowX(kit, -BOX.halfW, 2.38, 1.95, 0.3, 0.72, -1);
  addWindowX(kit, -BOX.halfW, 1.78, 1.4, 0.3, 0.72, -1);
  // Black louvered vertical intake panel at the box front-left corner.
  paintBox(kit, 0.03, 1.15, 0.42, -BOX.halfW - 0.005, 1.85, -0.42, PAINT_GAP, 0, 0, 0, 'clean', false);
  for (let i = 0; i < 6; i += 1) {
    paintBox(kit, 0.02, 0.035, 0.38, -BOX.halfW - 0.012, 1.42 + i * 0.17, -0.42, PAINT_EDGE, 0, 0, 0, 'clean', false);
  }

  addRearDoor(kit);

  // Roof furniture (§2.8): chimney + vent posts. No roof rack — the full
  // roof-deck layout is UNKNOWN (dossier §5 rule 3: omit, don't invent).
  addChimney(kit);
  paintCyl(kit, 0.03, 0.03, 0.12, 6, 0.78, BOX.y1 + 0.06, -0.42, PAINT_DEEP, 0, 0, 0, false);
  paintCyl(kit, 0.03, 0.03, 0.1, 6, 0.6, BOX.y1 + 0.05, -0.22, PAINT_DEEP, 0, 0, 0, false);
  // Box-roof front corner marker lamps.
  plainBox(kit.amber, 0.07, 0.04, 0.05, 1.02, BOX.y1 + 0.03, -0.52);
  plainBox(kit.amber, 0.07, 0.04, 0.05, -1.02, BOX.y1 + 0.03, -0.52);

  // ---- cab ----
  const cabH = CAB.y1 - CAB.y0;
  const cabD = CAB.z1 - CAB.z0;
  const cabZ = mid(CAB.z0, CAB.z1);
  const cabY = mid(CAB.y0, CAB.y1);
  paintBox(kit, CAB.halfW * 2, cabH, cabD, 0, cabY, cabZ, PAINT);

  // Lower nose under the hood.
  paintBox(kit, 1.9, 0.5, 0.72, 0, 1.0, -2.2, PAINT);
  // Short stubby "anteater" hood (§2.1): slopes down-forward to the grille.
  paintBox(kit, 1.88, 0.07, 0.78, 0, 1.41, -2.28, PAINT, -0.644, 0, 0);
  // Slatted center grille. NEVER any emblem or badge (§2.12).
  paintBox(kit, 0.8, 0.3, 0.06, 0, 1.06, -2.56, PAINT_GAP, 0, 0, 0, 'clean', false);
  for (let i = 0; i < 5; i += 1) {
    paintBox(kit, 0.74, 0.026, 0.025, 0, 0.94 + i * 0.055, -2.6, 0x3a3f45, 0, 0, 0, 'clean', false);
  }

  // Raked windshield.
  plainBox(kit.glass, 1.9, 0.8, 0.03, 0, 1.96, -1.86, 0.4, 0, 0);
  paintBox(kit, 0.09, 0.86, 0.07, 0.99, 1.96, -1.83, PAINT, 0.4, 0, 0);
  paintBox(kit, 0.09, 0.86, 0.07, -0.99, 1.96, -1.83, PAINT, 0.4, 0, 0);
  paintBox(kit, 2.0, 0.09, 0.12, 0, 2.32, -1.7, PAINT);

  // Cab roof + FIVE amber marker lamps across the leading edge (§2.8).
  // No white LED bar — the ambers are the canon roof lighting.
  paintBox(kit, 2.2, 0.07, 1.05, 0, 2.3, -1.38, PAINT);
  const ambers = [-0.62, -0.31, 0, 0.31, 0.62];
  for (let i = 0; i < ambers.length; i += 1) {
    plainBox(kit.amber, 0.08, 0.04, 0.05, ambers[i] ?? 0, 2.37, -1.83);
  }

  // Cab side glass.
  addWindowX(kit, CAB.halfW, 1.84, -1.38, 0.52, 0.58, 1);
  addWindowX(kit, -CAB.halfW, 1.84, -1.38, 0.52, 0.58, -1);
  // Door seams + handles.
  paintBox(kit, 0.012, 1.05, 0.018, CAB.halfW + 0.006, 1.6, -1.15, PAINT_GAP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.012, 1.05, 0.018, -CAB.halfW - 0.006, 1.6, -1.15, PAINT_GAP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.025, 0.04, 0.12, CAB.halfW + 0.02, 1.5, -1.55, PAINT_EDGE, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.025, 0.04, 0.12, -CAB.halfW - 0.02, 1.5, -1.55, PAINT_EDGE, 0, 0, 0, 'clean', false);

  addMirror(kit, 1);
  addMirror(kit, -1);
  addFender(kit, 1);
  addFender(kit, -1);

  // Snorkel, left A-pillar only (unverified feature — kept small, per WS2).
  paintCyl(kit, 0.042, 0.042, 0.95, 8, -1.16, 1.72, -1.84, PAINT, 0, 0, 0, false);
  paintCyl(kit, 0.038, 0.038, 0.22, 8, -1.16, 2.18, -1.96, PAINT, Math.PI / 2, 0, 0, false);
  paintCyl(kit, 0.05, 0.038, 0.09, 8, -1.16, 2.18, -2.1, PAINT_DEEP, Math.PI / 2, 0, 0, false);

  // Two antennas on the cab (§2.12).
  paintCyl(kit, 0.008, 0.005, 0.62, 5, -0.85, 2.62, -1.05, PAINT_DEEP, 0, 0, 0, false);
  paintCyl(kit, 0.008, 0.005, 0.55, 5, 0.85, 2.585, -1.12, PAINT_DEEP, 0, 0, 0, false);

  // ---- bumper, rectangular headlights, bull bar (§2.12) ----
  paintBox(kit, 2.15, 0.34, 0.18, 0, 0.72, -2.78, PAINT_DEEP, 0, 0, 0, 'grunge');
  // Rectangular headlight units set INTO the bumper. Right one flickers.
  const lampY = 0.88;
  for (const sx of [-1, 1]) {
    const x = sx * 0.62;
    paintBox(kit, 0.36, 0.2, 0.08, x, lampY, -2.84, PAINT_DEEP, 0, 0, 0, 'clean', false);
    const face = place(new THREE.BoxGeometry(0.3, 0.14, 0.02), x, lampY, -2.885);
    if (sx < 0) kit.white.push(face);
    else kit.flicker.push(face);
    paintBox(kit, 0.02, 0.14, 0.025, x - 0.08, lampY, -2.89, PAINT_DEEP, 0, 0, 0, 'clean', false);
    paintBox(kit, 0.02, 0.14, 0.025, x + 0.08, lampY, -2.89, PAINT_DEEP, 0, 0, 0, 'clean', false);
    const halo = place(new THREE.CircleGeometry(0.24, 16), x, lampY, -2.93, 0, Math.PI, 0);
    if (sx < 0) kit.glow.push(halo);
    else kit.glowFlicker.push(halo);
  }
  // Amber pods on the front fenders.
  plainBox(kit.amber, 0.08, 0.05, 0.04, 1.04, 1.02, -2.42);
  plainBox(kit.amber, 0.08, 0.05, 0.04, -1.04, 1.02, -2.42);

  // Bull bar — black, TWIN uprights, two rails. Sits proud of the lamps.
  const railZ = NOSE_Z + 0.05;
  paintCyl(kit, 0.038, 0.038, 2.0, 8, 0, 0.62, railZ, PAINT, 0, 0, Math.PI / 2, false);
  paintCyl(kit, 0.038, 0.038, 2.0, 8, 0, 1.08, railZ, PAINT, 0, 0, Math.PI / 2, false);
  paintCyl(kit, 0.036, 0.036, 0.85, 6, -0.62, 0.875, railZ, PAINT, 0, 0, 0, false);
  paintCyl(kit, 0.036, 0.036, 0.85, 6, 0.62, 0.875, railZ, PAINT, 0, 0, 0, false);
  paintCyl(kit, 0.028, 0.028, 0.25, 6, -0.95, 0.85, -2.93, PAINT, Math.PI / 2, 0, 0, false);
  paintCyl(kit, 0.028, 0.028, 0.25, 6, 0.95, 0.85, -2.93, PAINT, Math.PI / 2, 0, 0, false);

  // ---- rear bumper, lamps, mud flaps ----
  paintBox(kit, 2.05, 0.16, 0.1, 0, 0.78, TAIL_Z - 0.1, PAINT_DEEP, 0, 0, 0, 'grunge');
  const lampX = [0.72, -0.72];
  for (let s = 0; s < lampX.length; s += 1) {
    const x = lampX[s] ?? 0;
    const dir = x > 0 ? 1 : -1;
    plainBox(kit.white, 0.07, 0.07, 0.02, x + dir * 0.22, 0.78, 2.96);
    plainBox(kit.amber, 0.09, 0.06, 0.02, x + dir * 0.1, 0.78, 2.96);
    plainBox(kit.red, 0.1, 0.06, 0.02, x - dir * 0.02, 0.78, 2.96);
    plainBox(kit.red, 0.1, 0.06, 0.02, x - dir * 0.14, 0.78, 2.96);
  }
  // Marker lamps at the rear top corners (§2.13).
  plainBox(kit.amber, 0.06, 0.05, 0.04, 1.0, 2.68, 2.73);
  plainBox(kit.amber, 0.06, 0.05, 0.04, -1.0, 2.68, 2.73);
  // Side-facing red pips.
  plainBox(kit.red, 0.02, 0.05, 0.08, BOX.halfW + 0.01, 0.95, BOX.z1 - 0.02);
  plainBox(kit.red, 0.02, 0.05, 0.08, -BOX.halfW - 0.01, 0.95, BOX.z1 - 0.02);

  // Mud flaps behind the last axle + behind the front axle (§2.10).
  paintBox(kit, 0.02, 0.55, 0.2, 1.2, 0.62, 2.62, PAINT_GAP, -0.18, 0, 0, 'grunge', false);
  paintBox(kit, 0.02, 0.55, 0.2, -1.2, 0.62, 2.62, PAINT_GAP, -0.18, 0, 0, 'grunge', false);
  paintBox(kit, 0.016, 0.32, 0.16, 1.18, 0.55, AXLE_Z[0] + 0.7, PAINT_GAP, -0.25, 0, 0, 'grunge', false);
  paintBox(kit, 0.016, 0.32, 0.16, -1.18, 0.55, AXLE_Z[0] + 0.7, PAINT_GAP, -0.25, 0, 0, 'grunge', false);

  // Side steps.
  paintBox(kit, 0.22, 0.035, 0.7, 1.22, 0.64, -1.45, PAINT_DEEP, 0, 0, 0, 'grunge', false);
  paintBox(kit, 0.22, 0.035, 0.7, -1.22, 0.64, -1.45, PAINT_DEEP, 0, 0, 0, 'grunge', false);
  paintBox(kit, 0.04, 0.28, 0.04, 1.16, 0.82, -1.25, PAINT_DEEP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.04, 0.28, 0.04, -1.16, 0.82, -1.25, PAINT_DEEP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.04, 0.28, 0.04, 1.16, 0.82, -1.7, PAINT_DEEP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.04, 0.28, 0.04, -1.16, 0.82, -1.7, PAINT_DEEP, 0, 0, 0, 'clean', false);

  // Chassis rails, crossmembers, axles, walking beam, shocks, skid.
  paintBox(kit, 0.1, 0.14, 5.7, -0.42, 0.7, -0.15, PAINT_DEEP, 0, 0, 0, 'grunge');
  paintBox(kit, 0.1, 0.14, 5.7, 0.42, 0.7, -0.15, PAINT_DEEP, 0, 0, 0, 'grunge');
  const crosses = [-2.06, -1.1, 0.1, 1.4, 2.5];
  for (let i = 0; i < crosses.length; i += 1) {
    paintBox(kit, 0.9, 0.06, 0.08, 0, 0.7, crosses[i] ?? 0, PAINT_DEEP, 0, 0, 0, 'grunge', false);
  }
  for (let i = 0; i < AXLE_Z.length; i += 1) {
    const z = AXLE_Z[i] ?? 0;
    paintCyl(kit, 0.05, 0.05, 1.85, 8, 0, AXLE_Y, z, PAINT_DEEP, 0, 0, Math.PI / 2, false);
    paintCyl(kit, 0.11, 0.11, 0.22, 10, 0, AXLE_Y, z, PAINT_GAP, 0, 0, Math.PI / 2, false);
    paintCyl(kit, 0.025, 0.025, 0.38, 6, 0.62, 0.86, z, PAINT_DEEP, 0, 0, 0, false);
    paintCyl(kit, 0.025, 0.025, 0.38, 6, -0.62, 0.86, z, PAINT_DEEP, 0, 0, 0, false);
  }
  const beamZ = mid(AXLE_Z[1], AXLE_Z[2]);
  const beamLen = AXLE_Z[2] - AXLE_Z[1] - 0.15;
  paintBox(kit, 0.07, 0.09, beamLen, 0.78, 0.46, beamZ, PAINT_DEEP, 0, 0, 0, 'grunge', false);
  paintBox(kit, 0.07, 0.09, beamLen, -0.78, 0.46, beamZ, PAINT_DEEP, 0, 0, 0, 'grunge', false);
  paintBox(kit, 0.7, 0.035, 0.7, 0, 0.58, -2.45, PAINT_GAP, 0, 0, 0, 'grunge', false);

  // Polished aluminum fuel tank, low on the RIGHT flank between axles (§2.14).
  trimCyl(kit, 0.18, 0.18, 1.15, 20, 1.02, 0.8, -0.95, STEEL, Math.PI / 2, 0, 0);
  paintBox(kit, 0.42, 0.42, 0.045, 1.02, 0.8, -1.28, PAINT_GAP, 0, 0, 0, 'clean', false);
  paintBox(kit, 0.42, 0.42, 0.045, 1.02, 0.8, -0.62, PAINT_GAP, 0, 0, 0, 'clean', false);
  trimCyl(kit, 0.035, 0.035, 0.08, 8, 1.02, 1.0, -0.85, STEEL_DARK);

  // Left-side toolbox, darker, so the silver tank stays the right-side read.
  const tool = place(new THREE.BoxGeometry(0.28, 0.32, 0.7), -0.98, 0.78, -0.7);
  colorize(tool, STEEL_DARK, 'clean', false);
  kit.trim.push(tool);

  // Exhaust stack, left of the cab, silver tip.
  paintCyl(kit, 0.04, 0.045, 0.85, 8, -1.02, 1.15, -0.72, PAINT_DEEP, 0, 0, 0, false);
  trimCyl(kit, 0.05, 0.04, 0.08, 8, -1.02, 1.6, -0.72, STEEL);
}

// ---------------------------------------------------------------------------
// Wheels. One tire geometry, one rim geometry, instanced × 6.
// Dossier §2.10: black steel rims with round hand-holes + exposed lug hubs,
// chunky square-block military tread.
// ---------------------------------------------------------------------------

function buildTireGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const torus = new THREE.TorusGeometry(0.385, 0.155, 8, 20);
  torus.rotateY(Math.PI / 2);
  parts.push(torus);
  const around = 16;
  const rows = [-0.11, 0.11];
  for (let i = 0; i < around; i += 1) {
    for (let r = 0; r < rows.length; r += 1) {
      const row = rows[r] ?? 0;
      const a = (i / around) * Math.PI * 2 + (r === 1 ? Math.PI / around : 0);
      const block = new THREE.BoxGeometry(0.12, 0.06, 0.115);
      block.rotateX(a);
      block.translate(row, Math.cos(a) * 0.51, Math.sin(a) * 0.51);
      parts.push(block);
    }
  }
  const merged = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i += 1) parts[i]?.dispose();
  if (!merged) throw new Error('ark: tire merge failed');
  return merged;
}

function paintAttr(geo: THREE.BufferGeometry, hex: number): void {
  const n = geo.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  _color.set(hex);
  for (let i = 0; i < n; i += 1) {
    colors[i * 3] = _color.r;
    colors[i * 3 + 1] = _color.g;
    colors[i * 3 + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function buildRimGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const put = (geo: THREE.BufferGeometry, hex: number): void => {
    paintAttr(geo, hex);
    parts.push(geo);
  };
  // Barrel.
  const barrel = new THREE.CylinderGeometry(0.26, 0.26, 0.18, 16, 1, true);
  barrel.rotateZ(Math.PI / 2);
  put(barrel, 0x101215);
  // Outer face disc.
  const face = new THREE.CylinderGeometry(0.26, 0.26, 0.03, 16);
  face.rotateZ(Math.PI / 2);
  face.translate(0.075, 0, 0);
  put(face, 0x16181c);
  // Eight round hand-holes: dark recessed discs reading as holes.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const hole = new THREE.CylinderGeometry(0.052, 0.052, 0.036, 10);
    hole.rotateZ(Math.PI / 2);
    hole.translate(0.074, Math.cos(a) * 0.155, Math.sin(a) * 0.155);
    put(hole, 0x050607);
  }
  // Exposed lug hub + 8 lug nuts.
  const hub = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12);
  hub.rotateZ(Math.PI / 2);
  hub.translate(0.08, 0, 0);
  put(hub, 0x1e2126);
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + 0.39;
    const lug = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6);
    lug.rotateZ(Math.PI / 2);
    lug.translate(0.095, Math.cos(a) * 0.115, Math.sin(a) * 0.115);
    put(lug, 0x3a3f45);
  }
  const merged = mergeGeometries(parts, false);
  for (let i = 0; i < parts.length; i += 1) parts[i]?.dispose();
  if (!merged) throw new Error('ark: rim merge failed');
  return merged;
}

function blobGeo(): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(3.15, 7.15);
  geo.rotateX(-Math.PI / 2);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  }
  uv.needsUpdate = true;
  return geo;
}

function makeSpot(x: number): THREE.SpotLight {
  const spot = new THREE.SpotLight(0xfff1d4, 36, 40, 0.5, 0.55, 2);
  spot.name = x < 0 ? 'ark-headlight-l' : 'ark-headlight-r';
  spot.position.set(x, 2.36, -1.92);
  spot.target.position.set(x * 0.12, 0.0, -8.5);
  spot.castShadow = false;
  spot.penumbra = 0.5;
  return spot;
}

function countBudget(group: THREE.Group): { tris: number; draws: number } {
  let tris = 0;
  let draws = 0;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    draws += 1;
    const geo = mesh.geometry;
    const base = geo.index ? geo.index.count / 3 : (geo.getAttribute('position')?.count ?? 0) / 3;
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    tris += base * inst;
  });
  return { tris, draws };
}

export function buildArk(): ArkRig {
  const atlas = makeAtlas();
  const kit: Kit = {
    paint: [],
    glass: [],
    trim: [],
    white: [],
    flicker: [],
    red: [],
    amber: [],
    glow: [],
    glowFlicker: [],
  };
  buildBody(kit);

  const paintGeo = mergeBucket(kit.paint);
  const glassGeo = mergeBucket(kit.glass);
  const trimGeo = mergeBucket(kit.trim);
  const whiteGeo = mergeBucket(kit.white);
  const flickerGeo = mergeBucket(kit.flicker);
  const redGeo = mergeBucket(kit.red);
  const amberGeo = mergeBucket(kit.amber);
  const glowGeo = mergeBucket(kit.glow);
  const glowFlickerGeo = mergeBucket(kit.glowFlicker);

  // roughness 1 × clean texel ~0.60 → the spec's 0.6 on upper panels.
  // The map pushes the lower third rougher (dust). metalness stays 0.35.
  const paintMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.35,
    roughness: 1,
    roughnessMap: atlas.texture,
  });
  // Spec glass is 0x0a0e14. That albedo is a hole under this light budget, so the
  // pane is the darkest blue-gray that still reads as the reference's tinted glass.
  // Metalness and roughness stay on the spec.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x5a6e80,
    metalness: 0.9,
    roughness: 0.15,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.6,
    roughness: 0.36,
  });
  const whiteMat = new THREE.MeshStandardMaterial({
    color: 0x141618,
    emissive: 0xfff4e0,
    emissiveIntensity: 2.6,
    roughness: 0.28,
    metalness: 0.05,
    toneMapped: false,
  });
  const flickerMat = whiteMat.clone();
  const redMat = new THREE.MeshStandardMaterial({
    color: 0x1a0808,
    emissive: 0xff2218,
    emissiveIntensity: 2.1,
    roughness: 0.32,
    metalness: 0.05,
    toneMapped: false,
  });
  const amberMat = new THREE.MeshStandardMaterial({
    color: 0x1a1004,
    emissive: 0xffaa22,
    emissiveIntensity: 2.1,
    roughness: 0.3,
    metalness: 0.05,
    toneMapped: false,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xfff0d0,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const flickerGlowMat = glowMat.clone();
  const rubberMat = new THREE.MeshStandardMaterial({
    color: 0x111111,
    metalness: 0,
    roughness: 0.95,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    metalness: 0.78,
    roughness: 0.34,
  });
  const shadowMat = new THREE.MeshBasicMaterial({
    map: atlas.texture,
    color: 0x000000,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });

  const body = new THREE.Group();
  body.name = 'ark-body';
  body.add(meshOf(paintGeo, paintMat, 'ark-paint'));
  body.add(meshOf(glassGeo, glassMat, 'ark-glass'));
  body.add(meshOf(trimGeo, trimMat, 'ark-trim'));
  body.add(meshOf(whiteGeo, whiteMat, 'ark-lamps'));
  body.add(meshOf(flickerGeo, flickerMat, 'ark-lamp-flicker'));
  body.add(meshOf(redGeo, redMat, 'ark-tails'));
  body.add(meshOf(amberGeo, amberMat, 'ark-amber'));
  const glowMesh = meshOf(glowGeo, glowMat, 'ark-glow');
  glowMesh.renderOrder = 2;
  const flickerGlowMesh = meshOf(glowFlickerGeo, flickerGlowMat, 'ark-glow-flicker');
  flickerGlowMesh.renderOrder = 2;
  body.add(glowMesh);
  body.add(flickerGlowMesh);

  const tireGeo = buildTireGeo();
  const rimGeo = buildRimGeo();
  const tires = new THREE.InstancedMesh(tireGeo, rubberMat, WHEELS.length);
  const rims = new THREE.InstancedMesh(rimGeo, rimMat, WHEELS.length);
  tires.name = 'ark-tires';
  rims.name = 'ark-rims';
  tires.castShadow = false;
  rims.castShadow = false;
  tires.receiveShadow = false;
  rims.receiveShadow = false;
  tires.frustumCulled = false;
  rims.frustumCulled = false;
  body.add(tires);
  body.add(rims);

  const spotL = makeSpot(-0.5);
  const spotR = makeSpot(0.5);
  body.add(spotL, spotL.target);
  body.add(spotR, spotR.target);

  const shadow = meshOf(blobGeo(), shadowMat, 'ark-blob');
  shadow.position.set(0, 0.025, -0.05);
  shadow.renderOrder = 1;

  const group = new THREE.Group();
  group.name = 'ark';
  group.add(body);
  group.add(shadow);

  // Damage buffers. Built once. setDamageVisual only writes into them.
  const posAttr = paintGeo.getAttribute('position') as THREE.BufferAttribute;
  const nrmAttr = paintGeo.getAttribute('normal') as THREE.BufferAttribute;
  const colAttr = paintGeo.getAttribute('color') as THREE.BufferAttribute;
  const basePos = new Float32Array(posAttr.array);
  const baseCol = new Float32Array(colAttr.array);
  const dentMask = new Float32Array(posAttr.count);
  const dustMask = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i += 1) {
    const x = basePos[i * 3] ?? 0;
    const y = basePos[i * 3 + 1] ?? 0;
    const z = basePos[i * 3 + 2] ?? 0;
    const ax = Math.abs(x);
    if (y < 0.85) dustMask[i] = 1;
    else if (y < 1.2) dustMask[i] = (1.2 - y) / 0.35;
    let region = false;
    if (z < -1.2 && z > -3.1 && y > 0.35 && y < 1.5 && ax > 0.5) region = true;
    if (z < -0.85 && z > -2.2 && y > 1.1 && y < 2.25 && ax > 0.85) region = true;
    if (z > -0.4 && z < 2.7 && y > 1.15 && y < 2.55 && ax > 0.9) region = true;
    if (region) {
      const nse = hash01(i * 13 + 29);
      dentMask[i] = nse > 0.62 ? (nse - 0.4) * (hash01(i * 3 + 1) > 0.5 ? 1 : -1) : 0;
    }
  }
  _color.set(0x6b5a45);
  const dustR = _color.r;
  const dustG = _color.g;
  const dustB = _color.b;

  const axleOff = [0, 0, 0];
  const axleVel = [0, 0, 0];
  let spin = 0;
  let steer = 0;
  let hull = 1;
  let appliedHull = -1;
  let clock = 0;
  let bobPhase = 0;
  let rpmVis = 0;
  let suspY = 0;
  let pitch = 0;
  let rearKick = 0;
  let rearKickIn = 0;

  function writeWheels(): void {
    for (let i = 0; i < WHEELS.length; i += 1) {
      const w = WHEELS[i];
      if (!w) continue;
      const off = axleOff[w.axle] ?? 0;
      _pos.set(w.x, AXLE_Y + off - suspY, w.z);
      // Left-side wheels get a π yaw flip so the rim face points outward.
      // The flip commutes with the spin axis, so rolling direction stays right.
      const yaw = (w.axle === 0 ? -steer * MAX_STEER : 0) + (w.x < 0 ? Math.PI : 0);
      _euler.set(spin, yaw, 0);
      _quat.setFromEuler(_euler);
      _mat.compose(_pos, _quat, _scale);
      tires.setMatrixAt(i, _mat);
      rims.setMatrixAt(i, _mat);
    }
    tires.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
  }

  function applyPose(): void {
    const bob = Math.sin(bobPhase) * (0.008 + rpmVis * 0.016);
    body.position.y = bob + suspY;
    body.position.x = steer * 0.035;
    body.rotation.z = steer * 0.055;
    body.rotation.x = pitch;
    body.rotation.y = 0;
    shadow.position.x = steer * 0.14;
    writeWheels();
  }

  function updateLamp(): void {
    let lamp = 1;
    if (hull < 0.68) {
      const sev = (0.68 - hull) / 0.68;
      const a = Math.sin(clock * (8 + sev * 28));
      const b = Math.sin(clock * 2.7 + 1.3);
      const gate = 0.25 - sev * 0.55;
      lamp = a * b > gate ? 1 : 0.06;
      if (hull < 0.32 && Math.sin(clock * 53) > 0.55) lamp = 0.04;
    }
    flickerMat.emissiveIntensity = 2.6 * lamp;
    flickerGlowMat.opacity = 0.3 * lamp;
  }

  function applyDamage(next: number): void {
    const dentAmp = (1 - next) * 0.038;
    const dustMix = (1 - next) * 0.7;
    for (let i = 0; i < posAttr.count; i += 1) {
      const d = (dentMask[i] ?? 0) * dentAmp;
      const nx = nrmAttr.getX(i);
      const ny = nrmAttr.getY(i);
      const nz = nrmAttr.getZ(i);
      posAttr.setXYZ(i, (basePos[i * 3] ?? 0) + nx * d, (basePos[i * 3 + 1] ?? 0) + ny * d, (basePos[i * 3 + 2] ?? 0) + nz * d);
      const t = Math.min(1, (dustMask[i] ?? 0) * (0.16 + dustMix));
      const br = baseCol[i * 3] ?? 0;
      const bg = baseCol[i * 3 + 1] ?? 0;
      const bb = baseCol[i * 3 + 2] ?? 0;
      colAttr.setXYZ(i, br * (1 - t) + dustR * t, bg * (1 - t) + dustG * t, bb * (1 - t) + dustB * t);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    applyWear(atlas, next);
    appliedHull = next;
  }

  applyDamage(1);
  applyPose();

  const budget = countBudget(group);
  if (budget.tris > MAX_TRIS || budget.draws > MAX_DRAWS) {
    throw new Error(`ark: budget exceeded tris=${budget.tris} draws=${budget.draws}`);
  }

  return {
    group,
    headlights: [spotL, spotR],
    setSpeedVisual(rpm01: number, dt: number): void {
      const rpm = clamp01(rpm01);
      rpmVis = rpm;
      const step = dt > 0.05 ? 0.05 : dt > 0 ? dt : 0;
      spin += rpm * 46 * step;
      if (spin > Math.PI * 200) spin -= Math.PI * 200;
      bobPhase += step * (1.5 + rpm * 7);
      clock += step;
      if (rearKickIn > 0) {
        rearKickIn -= step;
        if (rearKickIn <= 0) {
          axleVel[1] = (axleVel[1] ?? 0) - rearKick;
          axleVel[2] = (axleVel[2] ?? 0) - rearKick * 0.85;
          rearKick = 0;
        }
      }
      const k = 78;
      const c = 10.5;
      let sum = 0;
      for (let i = 0; i < 3; i += 1) {
        const off = axleOff[i] ?? 0;
        const vel = axleVel[i] ?? 0;
        const nextVel = vel + (-k * off - c * vel) * step;
        let next = off + nextVel * step;
        if (next < -0.13) next = -0.13;
        if (next > 0.07) next = 0.07;
        axleOff[i] = next;
        axleVel[i] = nextVel;
        sum += next;
      }
      suspY = (sum / 3) * 0.4;
      pitch = ((axleOff[0] ?? 0) - (axleOff[2] ?? 0)) * 0.055;
      updateLamp();
      applyPose();
    },
    setSteerVisual(steer01: number): void {
      steer = steer01 < -1 ? -1 : steer01 > 1 ? 1 : steer01;
      applyPose();
    },
    setDamageVisual(hull01: number): void {
      hull = clamp01(hull01);
      if (Math.abs(hull - appliedHull) >= 0.008) applyDamage(hull);
      updateLamp();
    },
    bump(strengthM: number): void {
      const s = strengthM < 0 ? 0 : strengthM > 0.22 ? 0.22 : strengthM;
      axleVel[0] = (axleVel[0] ?? 0) - s * 13;
      rearKick = s * 10;
      rearKickIn = 0.07;
    },
  };
}
