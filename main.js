import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const rand = (a, b) => a + Math.random() * (b - a);
// shape params are either a number or a [closed, open] pair
const at = (x, k) => (Array.isArray(x) ? lerp(x[0], x[1], k) : x);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- renderer / scene ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); // AO runs per pixel; 1.5 keeps it smooth on laptops
renderer.toneMapping = THREE.NeutralToneMapping; // keeps reds red, ACES drifts them to orange
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 80);
camera.position.set(2.4, 3.1, 8.8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, -0.85, 0);
Object.assign(controls, {
  enableDamping: true, enablePan: false, minDistance: 5, maxDistance: 16,
  minPolarAngle: 0.25, maxPolarAngle: 1.85, autoRotate: !reduceMotion, autoRotateSpeed: 0.3,
});

const key = new THREE.DirectionalLight(0xfff0dc, 3.4);
key.position.set(3.5, 6, 3);
key.target.position.set(0, -0.8, 0);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.01;
key.shadow.radius = 3;
const rim = new THREE.DirectionalLight(0xffc6d2, 2.4);
rim.position.set(-3, 2, -4);
scene.add(key, key.target, rim, new THREE.HemisphereLight(0xc4ccff, 0x1a0e10, 0.6));

// ---------- procedural textures ----------
function canvasTexture(w, h, draw) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// fine veins running from the petal claw to its edge (uv space; geometry fans them out)
const petalTex = canvasTexture(256, 512, (g, w, h) => {
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) {
    const x = Math.random() * w;
    g.strokeStyle = `rgba(80,30,40,${rand(0.01, 0.035)})`;
    g.lineWidth = rand(0.5, 1.6);
    g.beginPath();
    g.moveTo(x, h);
    g.bezierCurveTo(x + rand(-6, 6), h * 0.66, x + rand(-8, 8), h * 0.33, x + rand(-10, 10), 0);
    g.stroke();
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.012})`;
    g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
  }
});

// pinnate leaf: light midrib plus lateral veins angled towards the tip
const leafTex = canvasTexture(256, 512, (g, w, h) => {
  g.fillStyle = '#b8b8b8';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,240,.55)';
  for (let y = h - 30; y > 20; y -= 34) {
    g.lineWidth = 1.6;
    for (const dir of [-1, 1]) {
      g.beginPath();
      g.moveTo(w / 2, y);
      g.quadraticCurveTo(w / 2 + dir * w * 0.25, y - 30, w / 2 + dir * w * 0.5, y - 70);
      g.stroke();
    }
  }
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(w / 2, h);
  g.lineTo(w / 2, 0);
  g.stroke();
});

// paper fibres, shared by the kraft and tissue wraps
const paperTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#e6e6e6';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI, l = rand(2, 9);
    g.strokeStyle = Math.random() < 0.5 ? `rgba(90,60,30,${rand(0.05, 0.16)})` : `rgba(255,255,255,${rand(0.05, 0.2)})`;
    g.lineWidth = rand(0.4, 1);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // crumple creases: a dark/light line pair reads as a fold in the bump map
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * w, y = Math.random() * h, a = Math.random() * Math.PI, l = rand(60, 260);
    const dx = Math.cos(a) * l, dy = Math.sin(a) * l;
    for (const [off, col] of [[0, 'rgba(60,40,20,.10)'], [1.5, 'rgba(255,255,255,.14)']]) {
      g.strokeStyle = col;
      g.lineWidth = rand(1, 2.2);
      g.beginPath();
      g.moveTo(x + off, y + off);
      g.lineTo(x + dx + off, y + dy + off);
      g.stroke();
    }
  }
});
paperTex.wrapS = paperTex.wrapT = THREE.RepeatWrapping;
paperTex.repeat.set(3, 2);

scene.background = canvasTexture(1024, 1024, (g, w, h) => {
  g.fillStyle = '#101216';
  g.fillRect(0, 0, w, h);
  const glow = g.createRadialGradient(w * 0.66, h * 0.42, 0, w * 0.66, h * 0.42, w * 0.6);
  glow.addColorStop(0, '#2c1b21');
  glow.addColorStop(1, 'rgba(16,18,22,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
});

const dotTex = canvasTexture(64, 64, (g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
});

// ---------- GPU-shaped surfaces (petals, sepals, leaves) ----------
// Each instance is a grid bent along a curved midrib (tilt + bend), cupped across its width (curl),
// with rolled-back upper edges, a ruffle and fine crinkles. Shaping on the GPU keeps ~500 animated
// petals smooth; the CPU only writes 8 floats per instance while the bouquet opens.
const SURFACE_GLSL = /* glsl */ `
attribute vec4 aP0; // length, half-width, tilt, bend
attribute vec4 aP1; // curl, edge roll, ruffle, seed
attribute vec4 aP2; // top rounding, notch, profile (0 petal, 1 sepal, 2 leaf), ring (0 heart .. 1 outer)
varying vec4 vPetal;
float surfaceWidth(float v) {
  if (aP2.z < 0.5) return 0.16 + 0.84 * pow(sin(1.5708 * min(1.0, v / 0.7)), 0.8);
  if (aP2.z < 1.5) return pow(max(sin(3.14159 * pow(v, 0.55)), 0.0), 0.9);
  return pow(max(sin(3.14159 * pow(v, 0.75)), 0.0), 0.75) * (1.0 + 0.08 * fract(v * 13.0));
}
vec3 surfacePoint(vec2 q) {
  float L = aP0.x, W = aP0.y, tilt = aP0.z, bend = aP0.w;
  float R = W / max(aP1.x, 1e-3);
  float s = q.x * 2.0 - 1.0, v = q.y, as = abs(s);
  float xf = s * W * surfaceWidth(v);
  float t = v * (1.0 - aP2.x * s * s) * (1.0 - aP2.y * exp(-30.0 * s * s) * pow(v, 8.0));
  float y = 0.0, z = 0.0;
  for (int j = 0; j < 12; j++) {
    float f = (float(j) + 0.5) / 12.0 * t;
    float a = tilt + bend * f * f;
    y += cos(a);
    z += sin(a);
  }
  y *= t * L / 12.0;
  z *= t * L / 12.0;
  float a = tilt + bend * t * t;
  float n = -(1.0 - cos(xf / R)) * R
    + aP1.y * W * smoothstep(0.45, 1.0, v) * pow(as, 2.5)
    + aP1.z * W * sin(s * 7.0 + v * 5.0 + aP1.w) * v * v * v * (0.25 + as)
    + 0.005 * W * sin(s * 19.0 + v * 6.0 + aP1.w) * sin(v * 13.7 - s * 4.0 + aP1.w * 1.3) * v;
  return vec3(sin(xf / R) * R, y - sin(a) * n, z + cos(a) * n);
}
`;
// meshes without the instance attributes read aP0 = 0 and keep their own vertices
// (lets the AO pass draw the whole scene with one patched override material)
const SURFACE_NORMAL = /* glsl */ `
vec3 surfacePos = position;
vec3 objectNormal = normal;
if (aP0.x > 0.0) {
  surfacePos = surfacePoint(uv);
  vec2 qn = clamp(uv, 0.01, 0.99);
  vec3 p0 = surfacePoint(qn);
  objectNormal = normalize(cross(surfacePoint(qn + vec2(0.005, 0.0)) - p0, surfacePoint(qn + vec2(0.0, 0.005)) - p0));
}
vPetal = vec4(uv.x * 2.0 - 1.0, uv.y, aP2.w, aP1.w);
`;

function deform(material, cacheKey, extra) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
      .replace('#include <beginnormal_vertex>', SURFACE_NORMAL)
      .replace('#include <begin_vertex>', 'vec3 transformed = surfacePos;');
    extra?.(shader);
  };
  // closures share one source string, so three needs an explicit key to keep the programs apart
  material.customProgramCacheKey = () => cacheKey;
  return material;
}

const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
depthMat.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SURFACE_GLSL}`)
    .replace('#include <begin_vertex>', 'vec3 transformed = surfacePoint(uv);');
};
depthMat.customProgramCacheKey = () => 'surface-depth';

// 'Rubor de Seda': dusty pink that pales towards the edges
const petalUniforms = {
  uBase: { value: new THREE.Color('#7a2238') }, uBody: { value: new THREE.Color('#d47088') },
  uEdge: { value: new THREE.Color('#f6d3da') }, uBurn: { value: 0.85 },
};
const petalMat = deform(new THREE.MeshPhysicalMaterial({
  map: petalTex, bumpMap: petalTex, bumpScale: 0.12,
  roughness: 0.68, sheen: 0.8, sheenColor: 0xffd9e0, sheenRoughness: 0.45, side: THREE.DoubleSide,
}), 'petal', (shader) => {
  Object.assign(shader.uniforms, petalUniforms);
  shader.fragmentShader = `uniform vec3 uBase, uBody, uEdge;\nuniform float uBurn;\nvarying vec4 vPetal;\n${shader.fragmentShader}`
    .replace('#include <color_fragment>', `#include <color_fragment>
    {
      float ax = abs(vPetal.x), pv = vPetal.y;
      vec3 col = mix(uBase, uBody, smoothstep(0.0, 0.45, pv));
      col = mix(col, uEdge, 0.7 * smoothstep(0.7, 1.0, max(pv, ax * 0.9)));
      col *= 0.86 + 0.28 * fract(sin(vPetal.w * 91.7) * 43758.5); // no two petals alike
      col *= mix(1.0, uBurn, smoothstep(0.93, 1.0, max(pv, ax)) * vPetal.z); // darker rims on guard petals
      if (gl_FrontFacing) col = mix(col, col * 1.35 + 0.015, 0.35); // outer face of a petal is paler
      col = mix(col * vec3(0.9, 0.68, 0.78), col, smoothstep(0.0, 0.85, vPetal.z)); // heart petals are deeper in colour
      col *= mix(0.3, 1.0, smoothstep(0.0, 0.6, pv)) * mix(0.45, 1.0, pow(vPetal.z, 0.6)); // baked occlusion
      diffuseColor.rgb *= col;
    }`)
    // thin petals: key/rim light hitting the far side scatters through to the viewer
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
    #if NUM_DIR_LIGHTS > 0
    for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
      float through = saturate( dot( -geometryNormal, directionalLights[ i ].direction ) );
      reflectedLight.directDiffuse += material.diffuseColor * directionalLights[ i ].color * through * 0.45;
    }
    #endif`);
});
const greenMat = deform(new THREE.MeshPhysicalMaterial({
  color: 0x27461b, map: leafTex, bumpMap: leafTex, bumpScale: 2,
  roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4, side: THREE.DoubleSide,
}), 'green');
const stemMat = new THREE.MeshPhysicalMaterial({ color: 0x22371a, roughness: 0.6, clearcoat: 0.15 });
const kraftMat = new THREE.MeshPhysicalMaterial({
  color: 0xb98b5c, map: paperTex, bumpMap: paperTex, bumpScale: 1.5, roughness: 0.88, side: THREE.DoubleSide,
});
const tissueMat = new THREE.MeshPhysicalMaterial({
  color: 0xd2b4ac, map: paperTex, bumpMap: paperTex, bumpScale: 0.8, roughness: 0.75,
  sheen: 0.4, sheenColor: 0xffffff, side: THREE.DoubleSide,
});
const ribbonMat = new THREE.MeshPhysicalMaterial({
  color: 0x5c0a16, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.2,
  sheen: 1, sheenColor: 0xff8a9a, sheenRoughness: 0.3, side: THREE.DoubleSide,
});
const gypMat = new THREE.MeshPhysicalMaterial({ color: 0xebe6dc, roughness: 0.8, sheen: 0.6, sheenColor: 0xffffff });

// ---------- bouquet layout ----------
const bouquet = new THREE.Group();
scene.add(bouquet);
const DOME_C = V(0, -1, 0), DOME_R = 1.55; // rose heads sit on a dome around this centre
const BIND = V(0, -2.4, 0); // where the stems are tied
const WRAP_Y = -2.7, WRAP_H = 2.3;

// matrix whose local +Y is `up` and local +Z leans towards `out`
function frame(pos, up, out, scale) {
  const y = up.clone().normalize();
  const x = new THREE.Vector3().crossVectors(y, out).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  return new THREE.Matrix4().makeBasis(x, y, z).scale(V(scale, scale, scale)).setPosition(pos);
}
// uniform-area direction on a spherical cap around +Y
function capDir(f, phi, maxTheta) {
  const th = Math.acos(1 - f * (1 - Math.cos(maxTheta)));
  return V(Math.sin(th) * Math.cos(phi), Math.cos(th), Math.sin(th) * Math.sin(phi));
}

const roses = [], petalItems = [], greenItems = [], hipMatrices = [];

function addRose(m, open, delay, count) {
  const rose = { m, open, delay, o: 0 };
  roses.push(rose);
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // 0 = heart of the bud, 1 = outermost petal
    const Lopen = lerp(0.42, 1.12, t ** 0.75) * rand(0.92, 1.08), Lclosed = lerp(0.5, 0.82, t);
    const phi = i * 2.39996 + rand(-0.12, 0.12); // golden angle, slightly irregular
    const r = lerp(0.03, 0.2, t);
    const local = new THREE.Matrix4().makeRotationY(phi).setPosition(Math.sin(phi) * r, lerp(0.06, 0, t), Math.cos(phi) * r);
    petalItems.push({
      rose, matrix: m.clone().multiply(local), start: (1 - t) * 0.45, span: 0.55,
      L: [Lclosed, Lopen], W: [Lclosed * lerp(0.42, 0.5, t), Lopen * lerp(0.42, 0.56, t)],
      tilt: [lerp(0.08, 0.5, t), lerp(0.1, 1.28, t ** 1.7) + rand(-0.06, 0.06)],
      bend: [lerp(-0.45, -0.7, t), lerp(-0.3, 0.85, t ** 1.3)],
      curl: [lerp(2.1, 1.6, t), lerp(2.0, 0.6, t ** 0.8)],
      roll: [0, lerp(0, 0.45, t ** 1.5)],
      ruffle: 0.06 * t, seed: rand(0, 100), round: 0.28, notch: 0.05, profile: 0, ring: t,
    });
  }
  for (let i = 0; i < 5; i++) {
    const phi = (i / 5) * Math.PI * 2 + rand(0, 1);
    const local = new THREE.Matrix4().makeRotationY(phi).setPosition(Math.sin(phi) * 0.2, -0.07, Math.cos(phi) * 0.2);
    greenItems.push({
      rose, matrix: m.clone().multiply(local), start: 0, span: 0.45,
      L: [0.78, 0.7], W: 0.1, tilt: [0.6, 1.75], bend: [-0.55, 0.9], curl: [1.2, 0.5], roll: 0,
      ruffle: 0.12, seed: rand(0, 100), round: 0, notch: 0, profile: 1, ring: 1,
    });
  }
  hipMatrices.push(m.clone().multiply(new THREE.Matrix4().makeScale(1, 1.1, 1).setPosition(0, -0.1, 0)));
}

function leafCluster(pos, up, out, scale, tilt) {
  up.normalize();
  for (const [yaw, sc] of [[0, 1], [0.6, 0.8], [-0.6, 0.8]]) {
    greenItems.push({
      rose: null, matrix: frame(pos, up, out.clone().applyAxisAngle(up, yaw), scale * sc),
      L: 0.62, W: 0.19, tilt: tilt + rand(-0.1, 0.1), bend: 0.35, curl: 0.55, roll: 0,
      ruffle: 0.04, seed: rand(0, 100), round: 0, notch: 0, profile: 2, ring: 1,
    });
  }
}

const ROSES = 12;
const roseDirs = [];
for (let i = 0; i < ROSES; i++) {
  const dir = capDir((i + 0.5) / ROSES, i * 2.39996, 0.9);
  dir.x += rand(-0.04, 0.04);
  dir.z += rand(-0.04, 0.04);
  dir.normalize();
  roseDirs.push(dir);
  const a = rand(0, Math.PI * 2);
  addRose(
    frame(DOME_C.clone().addScaledVector(dir, DOME_R), dir, V(Math.cos(a), 0, Math.sin(a)), rand(0.4, 0.45)),
    rand(0.9, 1),
    0.3 + Math.acos(dir.y) * 2.2 + rand(0, 0.5), // centre opens first, then the rings around it
    30 + Math.floor(rand(0, 8)),
  );
}

// greenery: a skirt of leaves around the rim plus a few peeking between the roses
for (let i = 0; i < 14; i++) {
  const phi = (i / 14) * Math.PI * 2 + rand(-0.15, 0.15);
  const dir = capDir(1, phi, rand(0.92, 1.05));
  leafCluster(DOME_C.clone().addScaledVector(dir, DOME_R - 0.3), V(dir.x * 0.3, 1, dir.z * 0.3), V(Math.cos(phi), 0, Math.sin(phi)), rand(0.95, 1.15), rand(0.6, 0.8));
}
for (let i = 0; i < 8; i++) {
  const phi = rand(0, Math.PI * 2);
  const dir = capDir(rand(0.3, 0.9), phi, 0.9);
  leafCluster(DOME_C.clone().addScaledVector(dir, DOME_R - 0.12), dir, V(Math.cos(phi), 0, Math.sin(phi)), 0.7, 0.7);
}

function instanced(geo, material, items) {
  const mesh = new THREE.InstancedMesh(geo, material, items.length);
  for (const name of ['aP0', 'aP1', 'aP2']) {
    geo.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4).setUsage(THREE.DynamicDrawUsage));
  }
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.matrix);
    geo.attributes.aP2.setXYZW(i, it.round, it.notch, it.profile, it.ring);
  });
  mesh.customDepthMaterial = depthMat;
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // vertices are placed in the shader
  bouquet.add(mesh);
  return { geo, items };
}
const surfaceGroups = [
  instanced(new THREE.PlaneGeometry(1, 1, 24, 32), petalMat, petalItems),
  instanced(new THREE.PlaneGeometry(1, 1, 10, 64), greenMat, greenItems),
];

function updateShapes() {
  for (const { geo, items } of surfaceGroups) {
    const a0 = geo.attributes.aP0, a1 = geo.attributes.aP1;
    items.forEach((it, i) => {
      const k = it.rose ? ease(clamp01((it.rose.o - it.start) / it.span)) : 1;
      a0.setXYZW(i, at(it.L, k), at(it.W, k), at(it.tilt, k), at(it.bend, k));
      a1.setXYZW(i, at(it.curl, k), at(it.roll, k), it.ruffle, it.seed);
    });
    a0.needsUpdate = a1.needsUpdate = true;
  }
}

const hips = new THREE.InstancedMesh(new THREE.SphereGeometry(0.15, 24, 16), stemMat, hipMatrices.length);
hipMatrices.forEach((m, i) => hips.setMatrixAt(i, m));
hips.castShadow = hips.receiveShadow = true;
bouquet.add(hips);

// stems run back from each head, gather at the tie, then fan slightly below it
const stems = new THREE.Mesh(mergeGeometries(roses.map(({ m }) => {
  const a = rand(0, Math.PI * 2);
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    V(0, -0.22, 0).applyMatrix4(m), V(0, -0.9, 0).applyMatrix4(m),
    BIND.clone().add(V(rand(-0.05, 0.05), 0, rand(-0.05, 0.05))), V(Math.cos(a) * 0.22, -3.9, Math.sin(a) * 0.22),
  ]), 64, 0.022, 8);
})), stemMat);
stems.castShadow = stems.receiveShadow = true;
bouquet.add(stems);

// baby's breath: sprays of tiny lumpy florets on fine branching twigs, filling the gaps between roses
const florets = [], twigs = [];
for (let c = 0, tries = 0; c < 45 && tries < 2000; tries++) {
  const dir = capDir(Math.random(), rand(0, Math.PI * 2), 1.0);
  if (roseDirs.some(d => d.angleTo(dir) < 0.2)) continue;
  c++;
  const centre = DOME_C.clone().addScaledVector(dir, DOME_R + 0.16);
  const base = DOME_C.clone().addScaledVector(dir, DOME_R - 0.15);
  const forks = [0, 1, 2, 3].map(() => centre.clone().addScaledVector(dir, -0.05).add(V(rand(-0.06, 0.06), rand(-0.03, 0.03), rand(-0.06, 0.06))));
  for (const fork of forks) twigs.push(base, fork);
  for (let f = 0; f < 22; f++) {
    const p = centre.clone().add(V(rand(-0.11, 0.11), rand(-0.05, 0.05), rand(-0.11, 0.11)));
    const s = rand(0.011, 0.018);
    twigs.push(forks[f % 4], p);
    florets.push(new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 3), rand(0, 3), 0)), V(s, s * 0.75, s)));
  }
}
const floretGeo = new THREE.IcosahedronGeometry(1, 2);
const fp = floretGeo.attributes.position;
for (let i = 0; i < fp.count; i++) { // ruffled puff; position-based so shared corners stay welded
  const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i), k = 1 + 0.28 * Math.sin(7 * x) * Math.sin(7 * y) * Math.sin(7 * z);
  fp.setXYZ(i, x * k, y * k, z * k);
}
floretGeo.computeVertexNormals();
const gyps = new THREE.InstancedMesh(floretGeo, gypMat, florets.length);
florets.forEach((m, i) => gyps.setMatrixAt(i, m));
gyps.castShadow = gyps.receiveShadow = true;
bouquet.add(gyps, new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(twigs), new THREE.LineBasicMaterial({ color: 0x6f7c4c })));

// florist wrap: overlapping sheets on a cone with soft pleats, crinkles and pointed tops. Pleats and
// crinkles follow the angle around the bouquet (not the sheet) so overlapping sheets nest cleanly.
function wrapSheet({ a0, span, rTop, height, crinkle, offset, tip, seed, inner }) {
  return new ParametricGeometry((u, v, out) => {
    const a = a0 + (u - 0.5) * span;
    // tissue only ruffles where it rises above the kraft; lower down it hugs a cone inside it
    const free = inner ? smooth(0.86, 0.97, v) : 1;
    const pleat = Math.abs(Math.sin(a * 5 + seed)) * 0.2 * v;
    // sheet edges lift away and the top folds outward; tissue less so, so it never hangs over the kraft
    const flare = smooth(0.8, 1, Math.abs(u * 2 - 1)) * (inner ? 0.1 : 0.25) * v;
    const lip = smooth(0.82, 1, v) * (inner ? 0.08 : 0.3);
    const noise = crinkle * (Math.sin(a * 13 + seed) * Math.sin(v * 23 + seed * 2) + 0.5 * Math.sin(a * 25 + v * 53 + seed)) * v;
    const tie = 1 - 0.35 * Math.exp(-(((v - (BIND.y - WRAP_Y) / height) / 0.06) ** 2)); // paper cinched by the ribbon
    const r = (lerp(0.16, rTop, v ** 1.25) + offset + free * (pleat + flare + lip + noise)) * tie;
    const top = tip * (1 - Math.abs(u * 2 - 1)) ** 1.5 * v ** 3; // sheet corner points up
    out.set(Math.cos(a) * r, WRAP_Y + v * height + top + Math.sin(u * Math.PI * 3 + a0) * 0.06 * v ** 4, Math.sin(a) * r);
  }, 112, 64);
}
for (let i = 0; i < 3; i++) {
  for (const [mat, geo] of [
    [tissueMat, wrapSheet({ a0: i * 2.1 + 1.05, span: 2.6, rTop: 1.3, height: WRAP_H + 0.18, crinkle: 0.03, offset: i * 0.015, tip: 0.2, seed: 1, inner: true })],
    [kraftMat, wrapSheet({ a0: i * 2.1, span: 2.8, rTop: 1.45, height: WRAP_H, crinkle: 0.015, offset: 0.06 + i * 0.02, tip: 0.45, seed: 0, inner: false })],
  ]) {
    const sheet = new THREE.Mesh(geo, mat);
    sheet.castShadow = sheet.receiveShadow = true;
    bouquet.add(sheet);
  }
}

// satin ribbon at the tie, with a bow at the front
const ribbon = new THREE.Group();
ribbon.position.copy(BIND);
ribbon.add(new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.28, 0.14, 64, 1, true), ribbonMat));
const bow = new THREE.Group();
bow.position.z = 0.31;
const strip = fn => new THREE.Mesh(new ParametricGeometry(fn, 48, 4), ribbonMat);
for (const side of [-1, 1]) {
  bow.add(strip((u, v, out) => { // loop
    const a = u * Math.PI * 2;
    out.set(side * 0.21 * (1 - Math.cos(a)), 0.05 * (1 - Math.cos(a)) + (v - 0.5) * 0.11, 0.06 * Math.sin(a) * side);
  }));
  bow.add(strip((u, v, out) => { // tail
    out.set(side * (0.03 + 0.13 * u) + (v - 0.5) * 0.1, -0.5 * u, 0.03 * Math.sin(u * 5) + 0.05 * u);
  }));
}
const knot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), ribbonMat);
knot.scale.set(0.06, 0.07, 0.045);
bow.add(knot);
ribbon.add(bow);
ribbon.traverse(o => { o.castShadow = o.receiveShadow = true; });
bouquet.add(ribbon);

// ---------- dust motes in the light ----------
const dustPos = new Float32Array(160 * 3).map((_, i) => (i % 3 === 1 ? rand(-3.5, 2.5) : rand(-4, 4)));
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
  size: 0.035, map: dotTex, color: 0xffd8c4, transparent: true, opacity: 0.5,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
scene.add(dust);

// ---------- bloom ----------
const ROSE_BLOOM = 7; // seconds per rose; delays stagger them across ~10 s
let bloomStart = performance.now() + 600;
let lastSum = -1;
document.getElementById('replay').addEventListener('click', () => { if (!reduceMotion) bloomStart = performance.now(); });
const bloomEl = document.getElementById('bloom');
document.getElementById('rose-count').textContent = roses.length;
document.getElementById('petal-count').textContent = petalItems.length;

// ambient occlusion darkens the creases between petals and roses; its normal/depth pass gets the
// same vertex shaping, otherwise it would see the petals as flat quads
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
const gtao = new GTAOPass(scene, camera, 1, 1);
deform(gtao.normalMaterial, 'surface-normal').side = THREE.DoubleSide;
gtao.updateGtaoMaterial({ radius: 0.28, distanceExponent: 1, thickness: 1, scale: 1.0, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(gtao);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight, aspect = w / h;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = aspect;
  camera.zoom = Math.min(1, aspect * 1.25);
  // wide: bouquet sits right of the headline; narrow: below it
  if (aspect > 1.1) camera.setViewOffset(w, h, -w * 0.17, 0, w, h);
  else camera.setViewOffset(w, h, 0, -h * 0.14, w, h);
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
updateShapes();
console.assert(surfaceGroups.every(({ geo }) => geo.attributes.aP0.array.every(Number.isFinite)), 'surface params have NaN');

renderer.setAnimationLoop((now) => {
  const elapsed = reduceMotion ? Infinity : (now - bloomStart) / 1000;
  let sum = 0;
  for (const r of roses) {
    const p = ease(clamp01((elapsed - r.delay) / ROSE_BLOOM));
    r.o = r.open * p;
    sum += p;
  }
  if (sum !== lastSum) {
    lastSum = sum;
    updateShapes();
    bloomEl.textContent = `${Math.round((sum / roses.length) * 100)}%`;
  }
  const t = now / 1000;
  bouquet.rotation.z = Math.sin(t * 0.7) * 0.01;
  bouquet.rotation.x = Math.sin(t * 0.5 + 1) * 0.008;
  dust.rotation.y = t * 0.015;
  dust.position.y = Math.sin(t * 0.2) * 0.08;
  controls.update();
  composer.render();
});
