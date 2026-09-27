/**
 * Turntable harness for Steven's review stills. Not part of the game module.
 * Truck-only renderer.info is measured before the studio lights and ground
 * are added, and stashed on window.__arkStats.
 */
import * as THREE from 'three';
import { buildArk } from './truck/ark';

declare global {
  interface Window {
    __arkReady: boolean;
    __arkStats: {
      calls: number;
      triangles: number;
      geometries: number;
      textures: number;
      lights: number;
    };
  }
}

const params = new URLSearchParams(location.search);
const shot = params.get('shot') ?? 'front34';
const clean = params.get('clean') === '1';
const turntable = params.get('turntable') === '1';
const hull = params.has('hull') ? Number(params.get('hull')) : 1;
const steer = params.has('steer') ? Number(params.get('steer')) : 0;
const rpm = params.has('rpm') ? Number(params.get('rpm')) : 0;
const night = shot === 'night';

if (clean) document.body.classList.add('clean');

const canvas = document.getElementById('c');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = night ? 1.22 : 1.12;
renderer.shadowMap.enabled = false;
renderer.setClearColor(night ? 0x07080e : 0xf2efe8, 1);

const rig = buildArk();
rig.setDamageVisual(Number.isFinite(hull) ? hull : 1);
rig.setSteerVisual(Number.isFinite(steer) ? steer : 0);
rig.setSpeedVisual(Number.isFinite(rpm) ? rpm : 0, 0);
for (let i = 0; i < rig.headlights.length; i += 1) {
  const lamp = rig.headlights[i];
  if (lamp) lamp.intensity = night ? 90 : 5;
}

const measure = new THREE.Scene();
measure.add(rig.group);
const probe = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
probe.position.set(7, 3, 7);
probe.lookAt(0, 1.1, 0);
renderer.render(measure, probe);
window.__arkStats = {
  calls: renderer.info.render.calls,
  triangles: renderer.info.render.triangles,
  geometries: renderer.info.memory.geometries,
  textures: renderer.info.memory.textures,
  lights: 2,
};
measure.remove(rig.group);

const scene = new THREE.Scene();
scene.background = new THREE.Color(night ? 0x07080e : 0xf2efe8);
if (night) scene.fog = new THREE.FogExp2(0x07080e, 0.03);
scene.add(rig.group);

const hemi = new THREE.HemisphereLight(
  night ? 0x2a3a52 : 0xe8eef6,
  night ? 0x100e0c : 0x8a7866,
  night ? 0.38 : 0.92,
);
const key = new THREE.DirectionalLight(night ? 0xd5e2f8 : 0xfff5ea, 3.05);
key.castShadow = false;
if (shot === 'rear34' || shot === 'chase') key.position.set(-8, 11, 6.5);
else if (shot === 'rear') key.position.set(3, 12, 9);
else if (shot === 'top') key.position.set(3, 16, -4);
else if (night) {
  key.position.set(4, 8, -6);
  key.intensity = 0.7;
  hemi.intensity = 0.48;
} else key.position.set(6.2, 12, -6.5);
scene.add(hemi, key);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(night ? 48 : 18, 48),
  new THREE.MeshStandardMaterial({
    color: night ? 0x14120f : 0xd8d2c8,
    roughness: 1,
    metalness: 0,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.012;
ground.receiveShadow = false;
ground.castShadow = false;
scene.add(ground);

if (night) {
  const dashMat = new THREE.MeshStandardMaterial({ color: 0xc8c2b4, roughness: 0.6, metalness: 0.05 });
  for (let i = 0; i < 9; i += 1) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 1.4), dashMat);
    dash.position.set(0, 0.002, -4 - i * 4.2);
    scene.add(dash);
  }
}

const aspect = window.innerWidth / Math.max(1, window.innerHeight);
const look = new THREE.Vector3(0, 1.2, -0.05);

function ortho(halfH: number): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.05, 80);
  return cam;
}

function frame(): THREE.Camera {
  if (turntable) {
    const cam = new THREE.PerspectiveCamera(34, aspect, 0.1, 80);
    cam.position.set(7, 2.4, 6);
    cam.lookAt(look);
    return cam;
  }
  if (shot === 'front') {
    const cam = ortho(1.95);
    cam.position.set(0, 1.4, -8);
    cam.lookAt(0, 1.25, 0);
    return cam;
  }
  if (shot === 'side') {
    const cam = ortho(1.92);
    cam.position.set(14, 1.55, -0.02);
    cam.lookAt(0, 1.28, -0.02);
    return cam;
  }
  if (shot === 'rear') {
    const cam = ortho(1.95);
    cam.position.set(0, 1.4, 8.2);
    cam.lookAt(0, 1.25, 0);
    return cam;
  }
  if (shot === 'top') {
    const cam = ortho(1.85);
    cam.up.set(1, 0, 0);
    cam.position.set(0.15, 16, -0.05);
    cam.lookAt(0, 0, -0.05);
    return cam;
  }
  const cam = new THREE.PerspectiveCamera(shot === 'chase' ? 40 : shot === 'night' ? 36 : 32, aspect, 0.1, 90);
  if (shot === 'rear34') {
    cam.position.set(-5.4, 2.05, 5.1);
    cam.lookAt(0.15, 1.2, 0.1);
  } else if (shot === 'chase') {
    cam.position.set(3.6, 1.48, 7.4);
    cam.lookAt(0.1, 1.15, -0.35);
  } else if (shot === 'night') {
    cam.position.set(3.5, 1.7, -8.6);
    cam.lookAt(0.1, 0.9, -1.15);
  } else {
    cam.position.set(4.7, 1.9, -4.55);
    cam.lookAt(0, 1.12, 0.15);
  }
  return cam;
}

const camera = frame();
const hud = document.getElementById('hud');

function drawHud(): void {
  if (!hud || clean) return;
  const s = window.__arkStats;
  hud.textContent = [
    `shot ${shot}${turntable ? ' turntable' : ''}`,
    `truck calls ${s.calls}  tris ${s.triangles}`,
    `geometries ${s.geometries}  textures ${s.textures}  spots ${s.lights}`,
    `hull ${hull}  steer ${steer}  rpm ${rpm}`,
  ].join('\n');
}

renderer.render(scene, camera);
renderer.render(scene, camera);
drawHud();
window.__arkReady = true;

if (params.get('selftest') === '1') {
  rig.setSteerVisual(1);
  rig.bump(0.12);
  for (let i = 0; i < 18; i += 1) rig.setSpeedVisual(0.85, 1 / 60);
  const body = rig.group.getObjectByName('ark-body');
  const selftest = {
    roll: body?.rotation.z ?? 0,
    pitch: body?.rotation.x ?? 0,
    bodyY: body?.position.y ?? 0,
    steer: 1,
  };
  (window as unknown as { __arkSelf: typeof selftest }).__arkSelf = selftest;
}

if (turntable && camera instanceof THREE.PerspectiveCamera) {
  let t = 0;
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    const ang = t * 0.35;
    camera.position.set(Math.sin(ang) * 8.2, 2.15 + Math.sin(ang * 0.5) * 0.25, Math.cos(ang) * 8.2);
    camera.lookAt(look);
    rig.setSpeedVisual(0.35, dt);
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    camera.updateProjectionMatrix();
  }
  renderer.render(scene, camera);
});
