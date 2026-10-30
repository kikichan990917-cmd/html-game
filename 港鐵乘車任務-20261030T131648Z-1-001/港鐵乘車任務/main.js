import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* =========================================================
   Data — Tsuen Wan Line (red line), in route order
   ========================================================= */
const STATIONS = [
  { zh: '荃灣', en: 'Tsuen Wan', color: '#bb2200', outdoor: true },
  { zh: '大窩口', en: 'Tai Wo Hau', color: '#a2b741', outdoor: false },
  { zh: '葵興', en: 'Kwai Hing', color: '#ffef00', ink: '#1a1a1a', outdoor: true },
  { zh: '葵芳', en: 'Kwai Fong', color: '#015437', outdoor: true },
  { zh: '荔景', en: 'Lai King', color: '#bb2200', outdoor: true, ic: '東涌綫', icEn: 'Tung Chung Line' },
  { zh: '美孚', en: 'Mei Foo', color: '#1e90ff', ic: '屯馬綫', icEn: 'Tuen Ma Line' },
  { zh: '荔枝角', en: 'Lai Chi Kok', color: '#e04300' },
  { zh: '長沙灣', en: 'Cheung Sha Wan', color: '#b5a265' },
  { zh: '深水埗', en: 'Sham Shui Po', color: '#016258' },
  { zh: '太子', en: 'Prince Edward', color: '#8674a1', ic: '觀塘綫', icEn: 'Kwun Tong Line' },
  { zh: '旺角', en: 'Mong Kok', color: '#be2700', ic: '觀塘綫', icEn: 'Kwun Tong Line' },
  { zh: '油麻地', en: 'Yau Ma Tei', color: '#cccccc', ink: '#1a1a1a', ic: '觀塘綫', icEn: 'Kwun Tong Line' },
  { zh: '佐敦', en: 'Jordan', color: '#69b72b' },
  { zh: '尖沙咀', en: 'Tsim Sha Tsui', color: '#111111', trim: '#f5d000', ic: '屯馬綫（尖東站）', icEn: 'Tuen Ma Line at East Tsim Sha Tsui' },
  { zh: '金鐘', en: 'Admiralty', color: '#3a86d4', ic: '港島綫、南港島綫及東鐵綫', icEn: 'Island Line, South Island Line and East Rail Line' },
  { zh: '中環', en: 'Central', color: '#aa0000', ic: '港島綫', icEn: 'Island Line' },
];
const START = 8; // 深水埗
const SPACING = 260;          // track distance between stations (m, game scale)
const HALF_PLAT = 80;         // platform half length
const CAR_PITCH = 22.6, CAR_HALF = 11, NCAR = 5; // cars at index -2..2
const DOOR_LOCAL = [-8.4, -4.2, 0, 4.2, 8.4];
const DOOR_HALF = 0.75;
const ALL_DOORS = [];
for (let k = -2; k <= 2; k++) for (const d of DOOR_LOCAL) ALL_DOORS.push(k * CAR_PITCH + d);
const PSD_Z = 1.74;
const VMAX = 24, ACC = 3.6;
const X = (i) => i * SPACING;
const COLS = []; // platform columns sit between door positions
for (let k = -3; k <= 3; k++) for (const o of [-6.3, 6.3]) { const x = k * CAR_PITCH + o; if (Math.abs(x) < HALF_PLAT - 6) COLS.push(x); }
const COL_Z = 7.3;

function isUnderground(T) {
  if (T > X(4) + 130) return true;
  if (Math.abs(T - X(1)) < 120) return true;
  return false;
}

/* =========================================================
   Renderer / scene
   ========================================================= */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 900);
camera.position.set(0, 1.7, -1);

const hemi = new THREE.HemisphereLight(0xffffff, 0x60656c, 1.15);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 0.35);
sun.position.set(-30, 60, 40);
scene.add(sun);
const fog = new THREE.Fog(0x050608, 30, 170);
scene.fog = fog;

const skyTex = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#6f9fd4'); gr.addColorStop(0.55, '#b9d3ea'); gr.addColorStop(1, '#e9eef2');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const darkColor = new THREE.Color(0x050608);
const skyFogColor = new THREE.Color(0xc9dbe9);

const world = new THREE.Group();  // track-fixed objects; world.position.x = -s
scene.add(world);
const train = new THREE.Group();  // the train is always at the origin
scene.add(train);

/* =========================================================
   Helpers: materials, textures, merging
   ========================================================= */
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05, ...o });
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function speckle(base, n, spread, size = 256) {
  return (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      const v = (Math.random() - 0.5) * spread;
      g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v)})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  };
}
function shade(hex, f) {
  const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + f, 0, 1)); return '#' + c.getHexString();
}
function mosaicTex(color, trim) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = shade(color, -0.12); g.fillRect(0, 0, w, h);
    const s = 16;
    for (let y = 0; y < h; y += s) for (let x = 0; x < w; x += s) {
      g.fillStyle = shade(color, (Math.random() - 0.5) * 0.08);
      g.fillRect(x + 1, y + 1, s - 2, s - 2);
    }
    if (trim) { g.fillStyle = trim; g.fillRect(0, h - 24, w, 12); }
  }, [1, 1]);
}

const T_FLOOR = canvasTex(256, 256, speckle('#7d838a', 2600, 0.35), [10, 1.4]);
const T_GRANITE = canvasTex(256, 256, speckle('#b9b6b0', 3000, 0.3), [40, 2]);
const T_CONCRETE = canvasTex(256, 256, speckle('#3a3b3d', 2200, 0.25), [4, 2]);
const T_BALLAST = canvasTex(128, 128, speckle('#2c2a28', 2400, 0.5), [6, 1]);

const MAT = {
  extBody: std(0xeff0ee, { roughness: 0.35, metalness: 0.15 }),
  extDoor: std(0xd5222a, { roughness: 0.4 }),
  extSkirt: std(0x544d49, { roughness: 0.7 }),
  roof: std(0x8f8781, { roughness: 0.6 }),
  stripe: std(0x3d3a3a),
  intWall: std(0xe4e7ea, { roughness: 0.55 }),
  intWall2: std(0xb8bec4, { roughness: 0.5, metalness: 0.4 }),
  intCeil: std(0xf3f4f5, { roughness: 0.7 }),
  floor: std(0xffffff, { map: T_FLOOR, roughness: 0.85 }),
  metal: std(0xd2d6db, { roughness: 0.22, metalness: 0.95 }),
  seat: std(0xc4cacf, { roughness: 0.28, metalness: 0.9 }),
  glass: new THREE.MeshStandardMaterial({ color: 0xa9c4cf, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.16, depthWrite: false }),
  glassPSD: new THREE.MeshStandardMaterial({ color: 0xbfd6dc, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
  light: new THREE.MeshBasicMaterial({ color: 0xffffff }),
  lightWarm: new THREE.MeshBasicMaterial({ color: 0xfff1d6 }),
  black: std(0x121417, { roughness: 0.8 }),
  rubber: std(0x1d1f22, { roughness: 0.9 }),
  doorInt: std(0xc3c8cd, { roughness: 0.35, metalness: 0.6 }),
  head: new THREE.MeshBasicMaterial({ color: 0xfff8e6 }),
  tail: new THREE.MeshBasicMaterial({ color: 0xff2a2a }),
  windshield: std(0x0b0d10, { roughness: 0.1, metalness: 0.6 }),
  granite: std(0xffffff, { map: T_GRANITE, roughness: 0.55 }),
  tactile: std(0xf2c200, { roughness: 0.7 }),
  concrete: std(0xffffff, { map: T_CONCRETE, roughness: 0.95 }),
  concreteDark: std(0x26272a, { roughness: 0.95 }),
  ballast: std(0xffffff, { map: T_BALLAST, roughness: 1 }),
  rail: std(0x9a9ea3, { roughness: 0.3, metalness: 0.9 }),
  sleeper: std(0x55524e, { roughness: 0.9 }),
  ceilStation: std(0xdcdddd, { roughness: 0.8 }),
  psdFrame: std(0xb5bbc1, { roughness: 0.3, metalness: 0.8 }),
  psdHead: std(0x2b2f34, { roughness: 0.5 }),
  tunnelLight: new THREE.MeshBasicMaterial({ color: 0xfff2c8 }),
  sign: std(0xf2f2ee),
  indicatorOff: new THREE.MeshBasicMaterial({ color: 0x3a1414 }),
  ledRed: new THREE.MeshBasicMaterial({ color: 0xff2b2b }),
  parapet: std(0xa4a39f, { roughness: 0.9 }),
};

// Merge every mesh inside a group into one mesh per material (huge draw-call saving)
function mergeByMaterial(src) {
  src.updateMatrixWorld(true);
  const buckets = new Map();
  src.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (geo.index) geo = geo.toNonIndexed();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(geo);
  });
  const out = new THREE.Group();
  for (const [m, geos] of buckets) out.add(new THREE.Mesh(mergeGeometries(geos), m));
  return out;
}
function box(g, w, h, d, x, y, z, m) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); g.add(mesh); return mesh;
}
function cyl(g, r, h, x, y, z, m, axis = 'y', seg = 10) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), m); mesh.position.set(x, y, z);
  if (axis === 'x') mesh.rotation.z = Math.PI / 2; if (axis === 'z') mesh.rotation.x = Math.PI / 2;
  g.add(mesh); return mesh;
}
function plane(g, w, h, x, y, z, m, ry = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); mesh.position.set(x, y, z); mesh.rotation.y = ry; g.add(mesh); return mesh;
}

/* =========================================================
   Signage textures
   ========================================================= */
function stationSignTex(st, w = 1024, h = 256) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = st.color; g.fillRect(0, 0, w, h);
    if (st.trim) { g.fillStyle = st.trim; g.fillRect(0, h - 22, w, 22); g.fillRect(0, 0, w, 10); }
    g.fillStyle = st.ink || '#ffffff';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${h * 0.5}px "Noto Serif TC", serif`;
    g.fillText(st.zh.split('').join(' '), w / 2, h * 0.4);
    g.font = `500 ${h * 0.17}px "Noto Sans TC", sans-serif`;
    g.fillText(st.en, w / 2, h * 0.8);
  });
}
function textTex(lines, w, h, bg, opts = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const draw = (ls) => {
    const g = c.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.textBaseline = 'middle';
    for (const l of ls) { g.fillStyle = l.color || '#fff'; g.font = l.font; g.textAlign = l.align || 'left'; g.fillText(l.text, l.x, l.y); }
    t.needsUpdate = true;
  };
  draw(lines); t.redraw = draw; return t;
}

/* Route map strip above the doors (MTR SmartMap style) */
const routeCanvas = document.createElement('canvas'); routeCanvas.width = 2048; routeCanvas.height = 256;
const routeTex = new THREE.CanvasTexture(routeCanvas); routeTex.colorSpace = THREE.SRGBColorSpace; routeTex.anisotropy = 8;
function drawRouteMap(blink) {
  const g = routeCanvas.getContext('2d'); const W = 2048, H = 256;
  g.fillStyle = '#f7f7f4'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#1b1d20'; g.fillRect(0, 0, W, 46);
  g.fillStyle = '#fff'; g.font = '700 28px "Noto Sans TC"'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const dest = state.dir > 0 ? STATIONS[15] : STATIONS[0];
  g.fillText(`荃灣綫 Tsuen Wan Line　往 ${dest.zh} ${dest.en}`, 24, 24);
  const x0 = 90, x1 = W - 90, y = 150;
  g.fillStyle = '#e3242b'; g.fillRect(x0, y - 8, x1 - x0, 16);
  const next = state.phase === 'running' ? state.at + state.dir : state.at;
  for (let i = 0; i < 16; i++) {
    const x = x1 - (x1 - x0) * (i / 15); // drawn so the map matches the real direction of travel seen from inside
    const passed = state.mode !== 'title' && (state.dir > 0 ? i < next : i > next) && state.boarded;
    const isNext = i === next;
    g.beginPath(); g.arc(x, y, isNext ? 20 : 14, 0, Math.PI * 2);
    g.fillStyle = isNext ? (blink ? '#30d158' : '#ffffff') : passed ? '#c7c7c7' : '#ffffff'; g.fill();
    g.lineWidth = 6; g.strokeStyle = passed ? '#9a9a9a' : '#e3242b'; g.stroke();
    if (state.target === i && state.mode === 'play' && state.missionShown) {
      g.fillStyle = '#f2b233'; g.beginPath(); g.moveTo(x, y - 34); g.lineTo(x - 12, y - 54); g.lineTo(x + 12, y - 54); g.fill();
    }
    g.fillStyle = passed ? '#9a9a9a' : '#1b1d20'; g.textAlign = 'center';
    g.font = `${isNext ? 900 : 700} 30px "Noto Serif TC"`; g.fillText(STATIONS[i].zh, x, y + 50);
    g.font = '500 15px "Noto Sans TC"'; g.fillText(STATIONS[i].en, x, y + 80);
  }
  // direction arrow
  g.fillStyle = '#1b1d20';
  const sd = -state.dir; const ax = sd > 0 ? W - 46 : 46;
  g.beginPath(); g.moveTo(ax + 18 * sd, y); g.lineTo(ax - 10 * sd, y - 20); g.lineTo(ax - 10 * sd, y + 20); g.fill();
  routeTex.needsUpdate = true;
}
const routeMat = new THREE.MeshBasicMaterial({ map: routeTex });

/* =========================================================
   Train construction
   ========================================================= */
const doorLeaves = []; // { mesh, closedX, sign }
const doorLights = [];
function wallIntervals() {
  const iv = []; let a = -CAR_HALF;
  for (const d of DOOR_LOCAL) { iv.push([a, d - DOOR_HALF]); a = d + DOOR_HALF; }
  iv.push([a, CAR_HALF]); return iv;
}
function buildLeafGeometry(sign, extMat, intMat, zOut) {
  // a door leaf with a window; ext layer outside, int layer inside
  const g = new THREE.Group();
  const w = 0.76;
  for (const [m, dz] of [[extMat, 0.012], [intMat, -0.012]]) {
    box(g, w, 1.02, 0.018, 0, 0.51, dz * zOut, m);
    box(g, w, 0.2, 0.018, 0, 1.88, dz * zOut, m);
    box(g, 0.13, 0.78, 0.018, sign * 0.315, 1.4, dz * zOut, m);
    box(g, 0.1, 0.78, 0.018, -sign * 0.33, 1.4, dz * zOut, m);
  }
  box(g, 0.55, 0.8, 0.008, -sign * 0.02, 1.4, 0, MAT.glass);
  box(g, 0.03, 1.98, 0.05, -sign * 0.365, 0.99, 0, MAT.rubber);
  return mergeByMaterial(g);
}
function buildCar(k) {
  const g = new THREE.Group();
  // floor, underframe, bogies
  box(g, 22, 0.12, 2.98, 0, -0.06, 0, MAT.floor);
  box(g, 21.6, 0.75, 2.86, 0, -0.5, 0, MAT.extSkirt);
  for (const bx of [-7.6, 7.6]) {
    box(g, 2.8, 0.45, 2.3, bx, -0.98, 0, MAT.black);
    for (const wx of [-0.8, 0.8]) for (const wz of [-0.72, 0.72]) cyl(g, 0.42, 0.12, bx + wx, -1.05, wz, MAT.rail, 'z', 14);
  }
  // ceiling + roof
  box(g, 22, 0.04, 2.94, 0, 2.31, 0, MAT.intCeil);
  box(g, 22, 0.22, 3.02, 0, 2.47, 0, MAT.roof);
  const roofCurve = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 22, 18, 1, false, -Math.PI / 2 + 0.35, Math.PI - 0.7), MAT.roof);
  roofCurve.rotation.z = Math.PI / 2; roofCurve.scale.set(1, 1, 1); roofCurve.position.set(0, 2.05, 0);
  roofCurve.scale.set(0.27, 1, 1); g.add(roofCurve);
  for (const z of [-0.58, 0.58]) box(g, 21, 0.03, 0.2, 0, 2.285, z, MAT.light);
  box(g, 21.8, 0.06, 0.5, 0, 2.29, 0, MAT.intWall);
  // side walls
  for (const side of [1, -1]) {
    for (const [a, b] of wallIntervals()) {
      const len = b - a, cx = (a + b) / 2;
      box(g, len, 0.95, 0.03, cx, 0.475, side * 1.465, MAT.intWall);
      box(g, len, 1.62, 0.03, cx, 0.14, side * 1.51, MAT.extBody);
      box(g, len, 0.46, 0.03, cx, 2.08, side * 1.465, MAT.intWall);
      box(g, len, 0.46, 0.03, cx, 2.08, side * 1.51, MAT.extBody);
      box(g, len, 0.08, 0.035, cx, 0.62, side * 1.53, MAT.stripe);
      const posts = [a + 0.08, b - 0.08]; if (len > 2) posts.push(cx);
      for (const px of posts) box(g, 0.16, 0.92, 0.075, px, 1.4, side * 1.49, MAT.extBody);
      box(g, len - 0.1, 0.92, 0.01, cx, 1.4, side * 1.49, MAT.glass);
    }
    for (const d of DOOR_LOCAL) {
      box(g, 1.5, 0.36, 0.03, d, 2.15, side * 1.465, MAT.intWall);
      box(g, 1.5, 0.36, 0.03, d, 2.15, side * 1.51, MAT.extBody);
      for (const e of [-1, 1]) box(g, 0.06, 1.98, 0.09, d + e * (DOOR_HALF + 0.02), 0.99, side * 1.49, MAT.metal);
      box(g, 1.56, 0.05, 0.09, d, 1.99, side * 1.49, MAT.metal);
      // door threshold
      box(g, 1.5, 0.02, 0.2, d, 0.01, side * 1.4, MAT.metal);
      if (side === -1) { // fixed closed doors on the non-platform side
        for (const sgn of [-1, 1]) {
          const leaf = buildLeafGeometry(sgn, MAT.extDoor, MAT.doorInt, -1);
          leaf.position.set(d + sgn * 0.38, 0, -1.545); g.add(leaf);
        }
      }
    }
    // seats
    const seatIv = [[-10.75, -9.25], [-7.55, -5.05], [-3.35, -0.85], [0.85, 3.35], [5.05, 7.55], [9.25, 10.75]];
    for (const [a, b] of seatIv) {
      const len = b - a, cx = (a + b) / 2;
      box(g, len, 0.06, 0.46, cx, 0.46, side * 1.2, MAT.seat);
      box(g, len, 0.5, 0.04, cx, 0.74, side * 1.43, MAT.seat);
      box(g, len, 0.42, 0.36, cx, 0.21, side * 1.27, MAT.intWall2);
      // seat dividers (dimples)
      for (let x = a + len / 5; x < b - 0.1; x += len / 5) box(g, 0.02, 0.02, 0.44, x, 0.49, side * 1.2, MAT.intWall2);
      // poles + glass draught screens next to doors
      for (const ex of [a, b]) {
        if (Math.abs(ex) > 10.5) continue;
        cyl(g, 0.022, 2.3, ex, 1.15, side * 0.98, MAT.metal);
        box(g, 0.02, 0.9, 0.5, ex, 0.95, side * 1.2, MAT.glass);
        cyl(g, 0.02, 0.5, ex, 1.4, side * 1.2, MAT.metal, 'z');
      }
    }
    // overhead grab rail + straps
    cyl(g, 0.02, 21, 0, 1.95, side * 0.8, MAT.metal, 'x');
    for (let x = -10.2; x <= 10.2; x += 0.85) {
      if (DOOR_LOCAL.some((d) => Math.abs(x - d) < 0.6)) continue;
      box(g, 0.025, 0.22, 0.012, x, 1.83, side * 0.8, MAT.rubber);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14), MAT.intWall); ring.position.set(x, 1.66, side * 0.8); g.add(ring);
    }
    for (const x of [-10.2, -5, 5, 10.2]) cyl(g, 0.02, 0.36, x, 2.12, side * 0.8, MAT.metal);
  }
  // end walls with gangway
  for (const ex of [-CAR_HALF, CAR_HALF]) {
    for (const sz of [-1, 1]) box(g, 0.06, 2.32, 0.88, ex, 1.16, sz * 1.04, MAT.intWall);
    box(g, 0.06, 0.32, 1.2, ex, 2.15, 0, MAT.intWall);
    const outer = (k === -2 && ex < 0) || (k === 2 && ex > 0);
    if (!outer) { // bellows
      const bx = ex + Math.sign(ex) * 0.15;
      for (const sz of [-1, 1]) box(g, 0.32, 2.05, 0.08, bx, 1.02, sz * 0.66, MAT.rubber);
      box(g, 0.32, 0.08, 1.4, bx, 2.05, 0, MAT.rubber);
      box(g, 0.32, 0.02, 1.2, bx, 0.0, 0, MAT.metal);
    } else { // cab front
      const f = Math.sign(ex);
      box(g, 0.06, 2.0, 1.2, ex, 1.0, 0, MAT.intWall);
      box(g, 1.3, 1.5, 3.0, ex + f * 0.65, 0.3, 0, MAT.extBody);
      box(g, 1.1, 0.95, 2.9, ex + f * 0.6, 1.5, 0, MAT.windshield);
      box(g, 1.3, 0.35, 3.0, ex + f * 0.65, 2.15, 0, MAT.extBody);
      box(g, 0.05, 0.25, 2.6, ex + f * 1.31, 0.1, 0, MAT.stripe);
      box(g, 0.04, 0.22, 1.4, ex + f * 1.31, 2.15, 0, MAT.black); // destination display
      box(g, 0.6, 0.5, 3.0, ex + f * 1.1, -0.5, 0, MAT.extSkirt);
      // MTR logo disc
      cyl(g, 0.14, 0.04, ex + f * 1.32, 0.8, 0, MAT.extDoor, 'x', 20);
    }
  }
  // route maps above doors (inside, platform side)
  const merged = mergeByMaterial(g);
  for (const d of DOOR_LOCAL) {
    const rm = plane(merged, 1.36, 0.17, d, 2.15, 1.445, routeMat, Math.PI);
    rm.position.z = 1.444;
  }
  // animated platform-side doors + door indicator lights
  for (const d of DOOR_LOCAL) {
    for (const sgn of [-1, 1]) {
      const leaf = buildLeafGeometry(sgn, MAT.extDoor, MAT.doorInt, 1);
      const cx = k * CAR_PITCH + d + sgn * 0.38;
      leaf.position.set(cx, 0, 1.545); train.add(leaf);
      doorLeaves.push({ mesh: leaf, closedX: cx, sign: sgn });
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.03), MAT.indicatorOff);
    lamp.position.set(k * CAR_PITCH + d, 2.01, 1.43); train.add(lamp); doorLights.push(lamp);
  }
  merged.position.x = k * CAR_PITCH;
  return merged;
}
const headlamps = [];
for (let k = -2; k <= 2; k++) {
  const car = buildCar(k);
  train.add(car);
}
// separate headlamp meshes (direction dependent)
for (const f of [-1, 1]) for (const lz of [-1.05, 1.05]) {
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.3), MAT.head);
  lamp.position.set(f * (2 * CAR_PITCH + CAR_HALF + 1.33), 0.45, lz); lamp.userData.f = f; train.add(lamp); headlamps.push(lamp);
}
const headBeam = new THREE.PointLight(0xfff4dd, 0, 60, 1.6);
train.add(headBeam);

/* Seated passengers for life */
function makePerson(seated, rnd) {
  const g = new THREE.Group();
  const top = std(new THREE.Color().setHSL(rnd(), 0.35, 0.35 + rnd() * 0.3));
  const bottom = std(new THREE.Color().setHSL(rnd(), 0.15, 0.15 + rnd() * 0.25));
  const skin = std(0xf0cdb5); const hair = std(0x1b1715);
  if (seated) {
    box(g, 0.34, 0.16, 0.42, 0, 0.55, 0.12, bottom);
    box(g, 0.32, 0.45, 0.14, 0, 0.3, 0.3, bottom);
    box(g, 0.38, 0.55, 0.24, 0, 0.82, -0.02, top);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin); h.position.set(0, 1.22, 0); g.add(h);
    const hr = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hr.position.set(0, 1.24, -0.01); g.add(hr);
    box(g, 0.08, 0.13, 0.015, 0.0, 0.85, 0.22, MAT.black); // phone
  } else {
    box(g, 0.3, 0.82, 0.22, 0, 0.41, 0, bottom);
    box(g, 0.4, 0.6, 0.26, 0, 1.12, 0, top);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), skin); h.position.set(0, 1.58, 0); g.add(h);
    const hr = new THREE.Mesh(new THREE.SphereGeometry(0.125, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hr.position.set(0, 1.6, -0.01); g.add(hr);
  }
  return mergeByMaterial(g);
}
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const [x, side] of [[-6.6, -1], [-2.0, -1], [2.6, 1], [6.1, -1], [-9.8, 1], [22.6 - 6, -1], [22.6 + 2, 1], [-22.6 + 1.5, -1], [-22.6 - 6, 1], [45.2 - 2, -1], [-45.2 + 6, 1]]) {
  const p = makePerson(true, rnd); p.position.set(x, 0, side * 1.15); p.rotation.y = side > 0 ? Math.PI : 0; train.add(p);
}

/* =========================================================
   Tunnel / viaduct tiles (repeat around the train)
   ========================================================= */
const TILE = 20, NTILE = 26;
function buildTile() {
  const t = new THREE.Group();
  const track = new THREE.Group();
  box(track, TILE, 0.4, 4.8, TILE / 2, -1.45, 0, MAT.ballast);
  for (const z of [-0.72, 0.72]) box(track, TILE, 0.14, 0.08, TILE / 2, -1.15, z, MAT.rail);
  for (let x = 0.5; x < TILE; x += 1.25) box(track, 0.25, 0.1, 2.3, x, -1.25, 0, MAT.sleeper);
  const tunnel = new THREE.Group();
  for (const sz of [1, -1]) {
    box(tunnel, TILE, 5.6, 0.3, TILE / 2, 1.0, sz * 2.75, MAT.concrete);
    for (const rx of [0.1, 10.1]) box(tunnel, 0.5, 5.6, 0.12, rx, 1.0, sz * 2.56, MAT.concreteDark);
    box(tunnel, TILE, 0.07, 0.07, TILE / 2, 1.7, sz * 2.56, MAT.black);
    box(tunnel, TILE, 0.07, 0.07, TILE / 2, 1.82, sz * 2.56, MAT.black);
    box(tunnel, TILE, 0.05, 0.05, TILE / 2, 0.6, sz * 2.56, MAT.rail);
    for (const lx of [5, 15]) box(tunnel, 0.7, 0.12, 0.08, lx, 2.45, sz * 2.56, MAT.tunnelLight);
    box(tunnel, 0.35, 0.22, 0.03, 10, 1.05, sz * 2.585, MAT.sign);
  }
  box(tunnel, TILE, 0.3, 5.8, TILE / 2, 3.85, 0, MAT.concrete);
  const outdoor = new THREE.Group();
  for (const sz of [1, -1]) {
    box(outdoor, TILE, 1.0, 0.25, TILE / 2, -0.6, sz * 2.75, MAT.parapet);
    box(outdoor, TILE, 0.12, 0.35, TILE / 2, -0.05, sz * 2.75, MAT.parapet);
  }
  box(outdoor, TILE, 1.2, 6, TILE / 2, -2.25, 0, MAT.parapet);
  cyl(outdoor, 0.12, 6.5, 2, 1.8, -3.0, MAT.psdFrame);
  box(outdoor, 0.08, 0.08, 3.4, 2, 4.6, -1.4, MAT.psdFrame);
  box(outdoor, TILE, 0.02, 0.02, TILE / 2, 4.3, 0, MAT.black);
  const tm = mergeByMaterial(tunnel), om = mergeByMaterial(outdoor), trm = mergeByMaterial(track);
  t.add(tm, om, trm);
  t.userData = { tunnel: tm, outdoor: om };
  return t;
}
const tiles = [];
for (let i = 0; i < NTILE; i++) { const t = buildTile(); world.add(t); tiles.push(t); }

/* Outdoor scenery (Kwai Tsing / Tsuen Wan stretch) */
const scenery = new THREE.Group(); world.add(scenery);
{
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2200, 900), std(0x7d8a72, { roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(X(4) / 2, -9, 0); scenery.add(ground);
  const road = new THREE.Mesh(new THREE.PlaneGeometry(2200, 18), std(0x55585c, { roughness: 1 }));
  road.rotation.x = -Math.PI / 2; road.position.set(X(4) / 2, -8.95, 14); scenery.add(road);
  const bgeo = new THREE.BoxGeometry(1, 1, 1); bgeo.translate(0, 0.5, 0);
  const n = 260;
  const bm = new THREE.InstancedMesh(bgeo, std(0xffffff, { roughness: 0.8 }), n);
  const m4 = new THREE.Matrix4(); const col = new THREE.Color();
  const palette = ['#e9e1d3', '#d7dde2', '#c9b9a6', '#f1efe8', '#b7c4cc', '#e2cfc0', '#a9b0b5'];
  let r = 11;
  const rr = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const x = -320 + rr() * (X(4) + 520);
    const z = side * (26 + rr() * 140);
    const w = 14 + rr() * 18, d = 14 + rr() * 18, h = 20 + rr() * 90;
    m4.compose(new THREE.Vector3(x, -9, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
    bm.setMatrixAt(i, m4); bm.setColorAt(i, col.set(palette[i % palette.length]));
  }
  scenery.add(bm);
  // distant hills (Tai Mo Shan direction)
  for (let i = 0; i < 9; i++) {
    const hill = new THREE.Mesh(new THREE.ConeGeometry(160 + i * 13, 120 + (i % 3) * 50, 7), std(0x5f7a5a, { roughness: 1, flatShading: true }));
    hill.position.set(-300 + i * 180, -9 + 50, (i % 2 ? 1 : -1) * 380); scenery.add(hill);
  }
}

/* =========================================================
   Stations
   ========================================================= */
const stationCache = new Map();
function buildPSD(g, outdoor) {
  const H = outdoor ? 1.5 : 2.35;
  const leaves = [], lamps = [];
  const fixed = new THREE.Group();
  let a = -HALF_PLAT + 2;
  const opens = ALL_DOORS.map((d) => [d - 0.8, d + 0.8]);
  const segs = [];
  for (const [o0, o1] of opens) { segs.push([a, o0]); a = o1; }
  segs.push([a, HALF_PLAT - 2]);
  for (const [s0, s1] of segs) {
    if (s1 - s0 < 0.2) continue;
    const n = Math.max(1, Math.round((s1 - s0) / 1.6));
    for (let i = 0; i <= n; i++) box(fixed, 0.08, H, 0.12, s0 + (s1 - s0) * (i / n), H / 2, PSD_Z, MAT.psdFrame);
    box(fixed, s1 - s0, H - 0.1, 0.02, (s0 + s1) / 2, H / 2, PSD_Z, MAT.glassPSD);
    box(fixed, s1 - s0, 0.1, 0.12, (s0 + s1) / 2, 0.05, PSD_Z, MAT.psdFrame);
    box(fixed, s1 - s0, 0.08, 0.12, (s0 + s1) / 2, H, PSD_Z, MAT.psdFrame);
  }
  if (!outdoor) box(fixed, HALF_PLAT * 2 - 4, 0.5, 0.3, 0, H + 0.3, PSD_Z, MAT.psdHead);
  for (const d of ALL_DOORS) {
    box(fixed, 0.1, H, 0.16, d - 0.84, H / 2, PSD_Z, MAT.psdFrame);
    box(fixed, 0.1, H, 0.16, d + 0.84, H / 2, PSD_Z, MAT.psdFrame);
  }
  g.add(mergeByMaterial(fixed));
  for (const d of ALL_DOORS) {
    for (const sgn of [-1, 1]) {
      const lg = new THREE.Group();
      box(lg, 0.8, 0.06, 0.06, 0, 0.05, 0, MAT.psdFrame);
      box(lg, 0.8, 0.06, 0.06, 0, H - 0.08, 0, MAT.psdFrame);
      box(lg, 0.06, H - 0.1, 0.06, sgn * 0.37, H / 2, 0, MAT.psdFrame);
      box(lg, 0.06, H - 0.1, 0.06, -sgn * 0.37, H / 2, 0, MAT.rubber);
      box(lg, 0.72, H - 0.18, 0.015, 0, H / 2, 0, MAT.glassPSD);
      if (outdoor) box(lg, 0.5, 0.08, 0.02, 0, 1.05, 0.02, MAT.ledRed);
      const leaf = mergeByMaterial(lg);
      const cx = d + sgn * 0.4;
      leaf.position.set(cx, 0, PSD_Z - 0.09);
      g.add(leaf); leaves.push({ mesh: leaf, closedX: cx, sign: sgn });
    }
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.04), MAT.indicatorOff.clone());
    lamp.position.set(d, outdoor ? H + 0.08 : H + 0.08, PSD_Z + 0.18); g.add(lamp); lamps.push(lamp);
  }
  return { leaves, lamps };
}
function buildStation(i) {
  if (stationCache.has(i)) return stationCache.get(i);
  const st = STATIONS[i];
  const outdoor = !!st.outdoor;
  const g = new THREE.Group(); g.position.x = X(i);
  const stat = new THREE.Group();
  const L = HALF_PLAT * 2;
  // platform slab
  box(stat, L, 1.35, 7.4, 0, -0.675, 1.62 + 3.7, MAT.granite);
  box(stat, L, 0.012, 0.32, 0, 0.006, PSD_Z + 0.42, MAT.tactile);
  box(stat, L, 0.012, 0.06, 0, 0.007, PSD_Z + 0.2, MAT.tactile);
  const mos = new THREE.MeshStandardMaterial({ map: mosaicTex(st.color, st.trim), roughness: 0.45, metalness: 0.05 });
  mos.map.repeat.set(40, 1.2);
  const mosCol = new THREE.MeshStandardMaterial({ map: mosaicTex(st.color, null), roughness: 0.45 }); mosCol.map.repeat.set(1, 3);
  const signMat = new THREE.MeshBasicMaterial({ map: stationSignTex(st) });
  signMat.color.setScalar(0.92);
  if (!outdoor) {
    box(stat, L, 4.3, 0.2, 0, 1.9, 9.12, mos);
    box(stat, L, 5.6, 0.2, 0, 1.4, -2.85, mos);
    box(stat, L, 0.12, 12.2, 0, 3.98, 3.2, MAT.ceilStation);
    for (const z of [3.6, 6.8]) box(stat, L - 6, 0.04, 0.22, 0, 3.9, z, MAT.light);
    for (const z of [-1.4, 0.8]) box(stat, L - 6, 0.04, 0.16, 0, 3.9, z, MAT.lightWarm);
    for (const x of COLS) box(stat, 0.7, 3.95, 0.7, x, 1.98, COL_Z, mosCol);
    for (const ex of [-HALF_PLAT, HALF_PLAT]) {
      box(stat, 0.4, 4.3, 7.5, ex, 1.9, 5.36, MAT.concreteDark);
      box(stat, 0.4, 1.4, 4.6, ex, 3.3, -0.55, MAT.concreteDark);
    }
    // benches against back wall
    for (let x = -HALF_PLAT + 14; x < HALF_PLAT - 8; x += 25.6) {
      box(stat, 2.4, 0.06, 0.45, x, 0.46, 8.7, MAT.seat); box(stat, 2.4, 0.45, 0.05, x, 0.72, 8.95, MAT.seat);
      for (const lx of [-1, 1]) box(stat, 0.06, 0.45, 0.4, x + lx * 1.1, 0.22, 8.7, MAT.metal);
    }
  } else {
    // open-air platform with canopy
    box(stat, L, 0.18, 10.4, 0, 4.45, 3.6, std(0xb3b8bc, { roughness: 0.6, metalness: 0.4 }));
    box(stat, L, 0.5, 0.25, 0, 4.2, -1.5, std(0x8c9297, { roughness: 0.5, metalness: 0.5 }));
    for (const z of [3.2, 6.6]) box(stat, L - 6, 0.04, 0.22, 0, 4.33, z, MAT.light);
    for (const x of COLS) {
      cyl(stat, 0.16, 4.4, x, 2.2, COL_Z, MAT.psdFrame, 'y', 14);
      box(stat, 0.42, 1.6, 0.42, x, 0.8, COL_Z, mosCol);
    }
    box(stat, L, 1.2, 0.2, 0, 0.6, 9.12, mos);
    box(stat, L, 0.06, 0.06, 0, 1.25, 9.12, MAT.metal);
    for (let x = -HALF_PLAT + 14; x < HALF_PLAT - 8; x += 25.6) {
      box(stat, 2.4, 0.06, 0.45, x, 0.46, 8.6, MAT.seat);
      for (const lx of [-1, 1]) box(stat, 0.06, 0.45, 0.4, x + lx * 1.1, 0.22, 8.6, MAT.metal);
    }
  }
  const merged = mergeByMaterial(stat); g.add(merged);
  // station name signs (back wall + track wall)
  for (let x = -HALF_PLAT + 12; x <= HALF_PLAT - 10; x += 22) {
    if (!outdoor) {
      plane(g, 5.2, 1.3, x + 6, 2.2, 9.0, signMat, Math.PI);
      plane(g, 6.4, 1.6, x, 1.9, -2.74, signMat, 0);
    } else {
      plane(g, 4.6, 1.15, x + 6, 2.4, 9.02, signMat, Math.PI);
      box(g, 0.08, 1.8, 0.08, x + 3.6, 2.2, 9.06, MAT.metal); box(g, 0.08, 1.8, 0.08, x + 8.4, 2.2, 9.06, MAT.metal);
    }
  }
  // signs on columns
  for (const x of COLS) plane(g, 0.66, 0.34, x, 2.2, COL_Z - (outdoor ? 0.22 : 0.36), signMat, Math.PI);
  // PSD / APG
  const psd = buildPSD(g, outdoor);
  if (!outdoor) {
    for (let x = -HALF_PLAT + 10; x < HALF_PLAT; x += 20) plane(g, 2.2, 0.38, x, 2.65, PSD_Z + 0.16, signMat, 0);
  }
  // passenger information displays
  const pis = [];
  for (const x of [-26, 14, 46]) {
    const tex = textTex([], 512, 96, '#06080a');
    const m = new THREE.MeshBasicMaterial({ map: tex });
    const holder = new THREE.Group(); holder.position.set(x, outdoor ? 3.6 : 3.25, 4.4);
    box(holder, 2.5, 0.55, 0.14, 0, 0, 0, MAT.psdHead);
    plane(holder, 2.36, 0.44, 0, 0, -0.075, m, Math.PI);
    plane(holder, 2.36, 0.44, 0, 0, 0.075, m, 0);
    for (const sx of [-1, 1]) cyl(holder, 0.02, outdoor ? 0.8 : 0.7, sx, 0.6, 0, MAT.metal);
    g.add(holder); pis.push(tex);
  }
  // direction sign
  const dirTex = textTex([], 1024, 160, '#f4f4f0');
  const dirSign = new THREE.Group(); dirSign.position.set(-6, outdoor ? 3.65 : 3.35, 3.0);
  box(dirSign, 4.2, 0.66, 0.1, 0, 0, 0, MAT.psdHead);
  plane(dirSign, 4.1, 0.6, 0, 0, 0.06, new THREE.MeshBasicMaterial({ map: dirTex }), 0);
  for (const sx of [-1.8, 1.8]) cyl(dirSign, 0.02, 0.7, sx, 0.65, 0, MAT.metal);
  g.add(dirSign);
  // waiting passengers
  let s2 = i * 97 + 3; const r2 = () => ((s2 = (s2 * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 7; n++) {
    const p = makePerson(false, r2);
    const px = -60 + r2() * 120; if (Math.abs(px) < 6) continue;
    p.position.set(px, 0, 3.0 + r2() * 4.5); p.rotation.y = Math.PI + (r2() - 0.5) * 1.2; g.add(p);
  }
  const rec = { g, psd, pis, dirTex, st, i, outdoor };
  stationCache.set(i, rec);
  world.add(g);
  updateStationDisplays(rec);
  return rec;
}
function disposeStation(i) {
  const rec = stationCache.get(i); if (!rec) return;
  world.remove(rec.g);
  rec.g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
  stationCache.delete(i);
}
function updateStationDisplays(rec) {
  const dest = state.dir > 0 ? STATIONS[15] : STATIONS[0];
  const here = rec.i === state.at;
  let line2 = '';
  if (state.mode === 'title') line2 = '';
  else if (here && state.phase === 'approach') line2 = '列車即將到達  Arriving';
  else if (here && ['arrived', 'opening', 'open', 'closing'].includes(state.phase)) line2 = '列車已到達  Train at platform';
  else line2 = '下一班列車  2 分鐘';
  for (const t of rec.pis) t.redraw([
    { text: `往 ${dest.zh}`, x: 20, y: 30, font: '700 34px "Noto Sans TC"', color: '#ffb000' },
    { text: dest.en, x: 492, y: 30, font: '600 28px "Noto Sans TC"', color: '#ffb000', align: 'right' },
    { text: line2, x: 20, y: 72, font: '500 28px "Noto Sans TC"', color: '#ffd166' },
  ]);
  rec.dirTex.redraw([
    { text: `往 ${dest.zh}`, x: 40, y: 80, font: '900 76px "Noto Serif TC"', color: '#1b1d20' },
    { text: `To ${dest.en}`, x: 984, y: 80, font: '600 54px "Noto Sans TC"', color: '#1b1d20', align: 'right' },
    { text: '', x: 0, y: 0, font: '10px sans-serif' },
  ]);
}

/* =========================================================
   Character (character.glb via GLTFLoader)
   ========================================================= */
let player = null, mixer = null, actions = {}, currentAction = null;
async function loadCharacter(onProgress) {
  const loader = new GLTFLoader();
  const viaUrl = loader.loadAsync('./character.glb', (e) => e.total && onProgress(e.loaded / e.total));
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000));
  try {
    return await Promise.race([viaUrl, timeout]);
  } catch (err) {
    // Sandboxed previews block binary fetches; parse the same GLB from an embedded copy
    const { CHARACTER_GLB_BASE64 } = await import('./character-glb.js');
    const bin = Uint8Array.from(atob(CHARACTER_GLB_BASE64), (c) => c.charCodeAt(0));
    return await loader.parseAsync(bin.buffer, './');
  }
}
function playAction(name, fade = 0.25) {
  const next = actions[name]; if (!next || next === currentAction) return;
  next.reset().setEffectiveWeight(1).fadeIn(fade).play();
  if (currentAction) currentAction.fadeOut(fade);
  currentAction = next;
}

/* =========================================================
   Game state
   ========================================================= */
const state = {
  mode: 'loading', dir: 1, at: START, phase: 'idle', phaseT: 0, s: X(START), v: 0, acc: 0,
  profile: null, door: 0, boarded: false, target: -1, missionShown: false,
  ff: 1, camMode: 0, startTime: 0, stops: 0, sound: true,
  p: { frame: 'train', x: 0, z: 0, rot: Math.PI, station: START },
  auto: [], ended: false, blink: false,
};

function makeProfile(D, vmax, a, v0) {
  const ta = (vmax - v0) / a, da = (vmax * vmax - v0 * v0) / (2 * a);
  const td = vmax / a, dd = (vmax * vmax) / (2 * a);
  const dc = Math.max(0, D - da - dd), tc = dc / vmax;
  return {
    T: ta + tc + td, D,
    at(t) {
      t = Math.max(0, Math.min(t, ta + tc + td));
      if (t < ta) return { d: v0 * t + 0.5 * a * t * t, v: v0 + a * t, acc: a };
      const t2 = t - ta;
      if (t2 < tc) return { d: da + vmax * t2, v: vmax, acc: 0 };
      const t3 = t2 - tc;
      return { d: da + dc + vmax * t3 - 0.5 * a * t3 * t3, v: Math.max(0, vmax - a * t3), acc: -a };
    },
  };
}

/* =========================================================
   Audio (Web Audio, synthesised)
   ========================================================= */
const audio = {
  ctx: null,
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.6; this.master.connect(ctx.destination);
    // motor whine
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3; f.frequency.value = 600;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc1.connect(f); this.osc2.connect(f); f.connect(this.motorGain); this.motorGain.connect(this.master);
    this.motorFilter = f; this.osc1.start(); this.osc2.start();
    // rumble noise
    const len = ctx.sampleRate * 2; const buf = ctx.createBuffer(1, len, ctx.sampleRate); const d = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    this.rumble = ctx.createGain(); this.rumble.gain.value = 0;
    src.connect(lp); lp.connect(this.rumble); this.rumble.connect(this.master); src.start();
    this.noiseBuf = buf;
  },
  tone(freq, start, dur, vol = 0.2, type = 'sine') {
    if (!this.ctx || !state.sound) return;
    const t0 = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  },
  chime() { [659, 523, 784].forEach((f, i) => this.tone(f, i * 0.32, 0.9, 0.16)); },
  doorOpen() { this.tone(988, 0, 0.5, 0.12); this.tone(784, 0.25, 0.7, 0.12); },
  doorClose() { for (let i = 0; i < 12; i++) this.tone(1320, i * 0.22, 0.12, 0.09, 'square'); },
  clack() {
    if (!this.ctx || !state.sound) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const g = this.ctx.createGain(); const t0 = this.ctx.currentTime;
    const v = Math.min(0.5, state.v / 40) * (state.p.frame === 'train' ? 1 : 0.4);
    g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    const hp = this.ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 220;
    s.connect(hp); hp.connect(g); g.connect(this.master); s.start(t0, Math.random()); s.stop(t0 + 0.12);
  },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, i * 0.14, 0.5, 0.16, 'triangle')); },
  lose() { [440, 370, 311].forEach((f, i) => this.tone(f, i * 0.22, 0.5, 0.14, 'triangle')); },
  update() {
    if (!this.ctx) return;
    const near = state.p.frame === 'train' ? 1 : 0.35;
    const on = state.sound ? 1 : 0;
    const v = state.v, a = Math.abs(state.acc);
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(90 + v * 26, t, 0.1);
    this.osc2.frequency.setTargetAtTime(45 + v * 13, t, 0.1);
    this.motorFilter.frequency.setTargetAtTime(400 + v * 40, t, 0.1);
    this.motorGain.gain.setTargetAtTime(on * near * (a > 0 && v > 0.2 ? 0.05 + Math.min(v, 20) * 0.0035 : v > 0.2 ? 0.015 : 0), t, 0.15);
    this.rumble.gain.setTargetAtTime(on * near * Math.min(0.35, v * 0.016), t, 0.2);
  },
};
let clackDist = 0;

let voice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /zh[-_]HK|yue/i.test(v.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(zh) {
  if (!state.sound || !voice || !('speechSynthesis' in window)) return;
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(zh); u.voice = voice; u.lang = voice.lang; u.rate = 1; speechSynthesis.speak(u); } catch (e) { /* optional */ }
}

/* =========================================================
   UI wiring
   ========================================================= */
const $ = (id) => document.getElementById(id);
const ui = {
  hud: $('hud'), title: $('title'), loading: $('loading'), mission: $('mission'), end: $('end'),
  status: $('hud-status'), speed: $('hud-speed'), towards: $('hud-towards'), towardsEn: $('hud-towards-en'),
  nextLabel: $('hud-next-label'), nextZh: $('hud-next-zh'), nextEn: $('hud-next-en'), nextStripe: $('hud-next-stripe'),
  chip: $('mission-chip'), chipZh: $('chip-zh'), announce: $('announce'), annZh: $('announce-zh'), annEn: $('announce-en'),
  hint: $('hint'), action: $('btn-action'), ff: $('btn-ff'), cam: $('btn-cam'), sound: $('btn-sound'), mini: $('mini-map'),
};
let annTimer = 0;
function announce(zh, en, secs = 6) {
  ui.annZh.textContent = zh; ui.annEn.textContent = en;
  ui.announce.classList.remove('hidden');
  ui.announce.style.animation = 'none'; void ui.announce.offsetWidth; ui.announce.style.animation = '';
  annTimer = secs;
}
function buildMiniMap() {
  ui.mini.innerHTML = '<div class="track"></div>';
  for (let i = 0; i < 16; i++) {
    const d = document.createElement('div'); d.className = 'dot' + (i === state.target && state.missionShown ? ' target' : '');
    d.style.left = `${(i / 15) * 100}%`; d.title = STATIONS[i].zh; ui.mini.appendChild(d);
  }
  const t = document.createElement('div'); t.className = 'train'; t.id = 'mini-train'; ui.mini.appendChild(t);
}
document.querySelectorAll('[data-dir]').forEach((b) => b.addEventListener('click', () => startGame(+b.dataset.dir)));
document.querySelectorAll('[data-again]').forEach((b) => b.addEventListener('click', () => startGame(+b.dataset.again)));
$('mc-ok').addEventListener('click', () => ui.mission.classList.add('hidden'));
ui.chip.addEventListener('click', () => ui.mission.classList.remove('hidden'));
ui.ff.addEventListener('click', toggleFF);
ui.cam.addEventListener('click', toggleCam);
ui.sound.addEventListener('click', () => { state.sound = !state.sound; ui.sound.textContent = state.sound ? '聲音 開' : '聲音 關'; if (!state.sound && 'speechSynthesis' in window) speechSynthesis.cancel(); });
ui.action.addEventListener('click', doAction);
function toggleFF() { state.ff = state.ff === 1 ? 2 : state.ff === 2 ? 4 : 1; ui.ff.textContent = `加速 ×${state.ff}`; ui.ff.classList.toggle('on', state.ff > 1); }
function toggleCam() { state.camMode = (state.camMode + 1) % 3; }

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if (state.mode !== 'play' && state.mode !== 'end') return;
  if (e.code === 'KeyC') toggleCam();
  if (e.code === 'KeyF') toggleFF();
  if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') { if (!ui.mission.classList.contains('hidden')) ui.mission.classList.add('hidden'); else doAction(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
// joystick
const stick = { x: 0, y: 0, id: null };
{
  const el = $('stick'), knob = $('knob');
  const set = (e) => {
    const r = el.getBoundingClientRect(); let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(dx, dy), R = r.width / 2 - 10; if (m > R) { dx *= R / m; dy *= R / m; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`; stick.x = dx / R; stick.y = dy / R;
  };
  el.addEventListener('pointerdown', (e) => { stick.id = e.pointerId; el.setPointerCapture(e.pointerId); set(e); });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) set(e); });
  const up = () => { stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}

/* =========================================================
   Game flow
   ========================================================= */
function stationName(i) { return `${STATIONS[i].zh} ${STATIONS[i].en}`; }
const camOx = { st: -1, v: 0 };
function setPlayerFrame(frame, station) {
  state.p.frame = frame;
  if (frame === 'train') { train.add(player); }
  else { const rec = buildStation(station); state.p.station = station; rec.g.add(player); }
}
function startGame(dir) {
  audio.init(); if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
  ui.title.classList.add('hidden'); ui.end.classList.add('hidden'); ui.mission.classList.add('hidden');
  ui.hud.classList.remove('hidden'); ui.chip.classList.add('hidden'); ui.announce.classList.add('hidden');
  Object.assign(state, {
    mode: 'play', dir, at: START, phase: 'approach', phaseT: 0, v: VMAX, acc: 0, door: 0, boarded: false,
    target: -1, missionShown: false, stops: 0, auto: [], ended: false, startTime: performance.now(), boardT: undefined, arrAnnounced: false,
  });
  state.profile = makeProfile(300, VMAX, ACC, VMAX);
  state.s = X(START) - dir * 300;
  for (const k of [...stationCache.keys()]) if (k !== START) disposeStation(k);
  setPlayerFrame('platform', START);
  state.p.x = 2.4; state.p.z = 3.6; state.p.rot = Math.PI; snapCam = true;
  for (const l of headlamps) l.material = l.userData.f === dir ? MAT.head : MAT.tail;
  train.visible = true;
  ui.towards.textContent = dir > 0 ? '中環' : '荃灣'; ui.towardsEn.textContent = dir > 0 ? 'Central' : 'Tsuen Wan';
  stationCache.forEach(updateStationDisplays);
  buildMiniMap(); drawRouteMap(false);
  setNextCard('本站 This station', START);
  announce('列車即將到達深水埗站，請於月台等候。', 'The train is arriving at Sham Shui Po. Please wait on the platform.', 6);
}
function setNextCard(label, i) {
  ui.nextLabel.textContent = label; ui.nextZh.textContent = STATIONS[i].zh; ui.nextEn.textContent = STATIONS[i].en;
  ui.nextStripe.style.background = STATIONS[i].color;
}
function chooseTarget() {
  const ahead = [];
  for (let i = START + state.dir; i >= 0 && i < 16; i += state.dir) ahead.push(i);
  // weight slightly towards nearer stops so the ride is not always very long
  const idx = Math.floor(Math.pow(Math.random(), 1.25) * ahead.length);
  return ahead[idx];
}
function showMission() {
  state.target = chooseTarget(); state.missionShown = true;
  const st = STATIONS[state.target];
  $('mc-zh').textContent = st.zh; $('mc-en').textContent = st.en;
  $('mc-stripe').style.background = st.color;
  $('mc-meta').textContent = `由深水埗起計第 ${Math.abs(state.target - START)} 個站 · 列車往${state.dir > 0 ? '中環' : '荃灣'}`;
  ui.chipZh.textContent = st.zh; ui.chip.classList.remove('hidden');
  ui.mission.classList.remove('hidden');
  buildMiniMap(); drawRouteMap(false);
  audio.chime();
}
function endGame(success, title, desc) {
  if (state.ended) return;
  state.ended = true; state.mode = 'end';
  const secs = Math.round((performance.now() - state.startTime) / 1000);
  $('end-badge').textContent = success ? '任務完成' : '任務失敗';
  $('end-badge').classList.toggle('fail', !success);
  $('end-title').textContent = title; $('end-desc').textContent = desc;
  $('end-stats').innerHTML = `<div><b>${state.stops}</b>乘搭站數</div><div><b>${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}</b>用時</div><div><b>${STATIONS[state.target]?.zh || '—'}</b>目標車站</div>`;
  if (success) { audio.win(); playAction('Cheer'); } else audio.lose();
  setTimeout(() => { ui.end.classList.remove('hidden'); }, success ? 2200 : 1500);
}

function nearestDoor(x) { let best = ALL_DOORS[0]; for (const d of ALL_DOORS) if (Math.abs(d - x) < Math.abs(best - x)) best = d; return best; }
function carCenter(x) { return Math.round(x / CAR_PITCH) * CAR_PITCH; }
function doorsUsable() { return state.door > 0.92 && (state.phase === 'open'); }
function doAction() {
  if (state.mode !== 'play' || !doorsUsable()) return;
  const d = nearestDoor(state.p.x);
  if (state.p.frame === 'train') state.auto = [[d, Math.max(0, Math.min(state.p.z, 0.6))], [d, 1.3], [d, 3.0]];
  else state.auto = [[d, Math.max(state.p.z, 2.6)], [d, 1.2], [carCenter(d), 0]];
}

/* Train state machine */
function setPhase(p) { state.phase = p; state.phaseT = 0; const rec = stationCache.get(state.at); if (rec) updateStationDisplays(rec); }
function updateTrain(dt) {
  state.phaseT += dt;
  const st = STATIONS[state.at];
  switch (state.phase) {
    case 'approach':
    case 'running': {
      const pr = state.profile.at(state.phaseT);
      const from = state.phase === 'approach' ? X(state.at) - state.dir * state.profile.D : X(state.at);
      const prevS = state.s;
      state.s = from + state.dir * pr.d; state.v = pr.v; state.acc = pr.acc;
      clackDist += Math.abs(state.s - prevS);
      if (clackDist > 12.5) { clackDist = 0; audio.clack(); setTimeout(() => audio.clack(), 70); }
      if (state.phase === 'running' && !state.arrAnnounced && state.profile.T - state.phaseT < 8) {
        state.arrAnnounced = true;
        const nx = state.at + state.dir;
        if (state.mode === 'play' && state.p.frame === 'train') announce(`即將抵達${STATIONS[nx].zh}站`, `Arriving at ${STATIONS[nx].en}`, 5);
      }
      if (state.phaseT >= state.profile.T) {
        if (state.phase === 'running') state.at += state.dir;
        state.s = X(state.at); state.v = 0; state.acc = 0;
        setPhase('arrived'); state.stops += state.boarded && state.mode === 'play' ? 1 : 0;
        if (state.mode === 'play' && state.boarded) setNextCard('本站 This station', state.at);
      }
      break;
    }
    case 'arrived':
      if (state.phaseT > 0.8) { setPhase('opening'); audio.doorOpen(); }
      break;
    case 'opening':
      state.door = Math.min(1, state.phaseT / 1.6);
      if (state.door >= 1) setPhase('open');
      break;
    case 'open': {
      const first = state.at === START && !state.missionShown;
      const isEnd = state.at === 0 || state.at === 15;
      let hold = 7.5;
      if (first) hold = state.boarded ? 2.5 : Infinity;
      if (state.mode !== 'play') hold = 5;
      if (first && state.boarded && state.boardT === undefined) state.boardT = state.phaseT;
      const t = first && state.boarded ? state.phaseT - (state.boardT ?? state.phaseT) : state.phaseT;
      if (t > hold && !(isEnd && state.mode !== 'play')) {
        setPhase('closing'); audio.doorClose(); state.boardT = undefined;
        if (state.mode === 'play' && state.p.frame === 'train') announce('請勿靠近車門', 'Please stand back from the doors', 3);
      }
      break;
    }
    case 'closing': {
      state.door = 1 - THREE.MathUtils.clamp((state.phaseT - 1.0) / 1.6, 0, 1);
      if (state.phaseT > 2.9) { state.door = 0; onDoorsClosed(); }
      break;
    }
    case 'idle': state.v = 0; state.acc = 0; break;
  }
  // door meshes
  const e = state.door * state.door * (3 - 2 * state.door);
  for (const l of doorLeaves) l.mesh.position.x = l.closedX + l.sign * 0.74 * e;
  const rec = stationCache.get(state.at);
  const stopped = ['arrived', 'opening', 'open', 'closing'].includes(state.phase);
  if (rec) for (const l of rec.psd.leaves) l.mesh.position.x = l.closedX + l.sign * 0.76 * (stopped ? e : 0);
  const flash = state.phase === 'closing' && Math.floor(state.phaseT * 5) % 2 === 0;
  for (const dl of doorLights) dl.material = flash ? MAT.ledRed : MAT.indicatorOff;
  if (rec) for (const lp of rec.psd.lamps) lp.material.color.set(state.phase === 'closing' ? (flash ? 0xffb000 : 0x3a2a10) : stopped && state.door > 0.5 ? 0x30d158 : 0x22262a);
}
function onDoorsClosed() {
  const i = state.at;
  if (state.mode === 'play') {
    if (i === START && !state.missionShown) { showMission(); }
    else if (state.p.frame === 'platform') {
      if (i === state.target) endGame(true, '準時到達', `你喺${stationName(i)}站成功落車，完成任務。`);
      else endGame(false, '落錯車站', `你喺${STATIONS[i].zh}站落咗車，但任務要求喺${STATIONS[state.target].zh}站落車。`);
    } else if (i === state.target) {
      endGame(false, '錯過車站', `列車已經離開${STATIONS[i].zh}站，你未有及時落車。`);
    }
  }
  const nx = i + state.dir;
  if (nx < 0 || nx > 15) { setPhase('idle'); return; }
  state.profile = makeProfile(SPACING, VMAX, ACC, 0);
  state.arrAnnounced = false;
  setPhase('running');
  if (state.mode === 'play' && state.p.frame === 'train') {
    const n = STATIONS[nx]; const term = nx === 0 || nx === 15;
    setNextCard(term ? '終點站 Terminus' : '下一站 Next station', nx);
    const zh = `下一站：${n.zh}${n.ic ? `。乘客可以轉乘${n.ic}` : ''}${term ? '。此站為終點站' : ''}`;
    const en = `Next station: ${n.en}${n.icEn ? `. Interchange station for the ${n.icEn}` : ''}${term ? '. This is the terminus' : ''}`;
    setTimeout(() => { if (state.phase === 'running' && state.mode === 'play') { announce(zh, en, 7); audio.chime(); setTimeout(() => speak(zh), 1000); } }, ui.mission.classList.contains('hidden') ? 600 : 2500);
  }
  drawRouteMap(false);
}

/* Player movement & collisions */
const tmpV = new THREE.Vector3();
function trainWalkable(x, z) {
  const k = Math.round(x / CAR_PITCH); if (k < -2 || k > 2) return false;
  const lx = x - k * CAR_PITCH;
  if (Math.abs(lx) > CAR_HALF - 0.25) {
    const outer = (k === -2 && lx < 0) || (k === 2 && lx > 0);
    return !outer && Math.abs(z) < 0.42;
  }
  const atDoor = DOOR_LOCAL.some((d) => Math.abs(lx - d) < DOOR_HALF - 0.2);
  if (atDoor) {
    const maxZ = doorsUsable() || (state.phase === 'closing' && state.door > 0.6) ? 1.9 : 1.22;
    return z > -1.22 && z < maxZ;
  }
  return Math.abs(z) < 0.8;
}
function platformWalkable(x, z) {
  if (Math.abs(x) > HALF_PLAT - 3) return false;
  if (z > 8.7) return false;
  const stopped = state.at === state.p.station && (doorsUsable() || (state.phase === 'closing' && state.door > 0.6));
  if (z < PSD_Z + 0.25) {
    if (!stopped) return false;
    if (!ALL_DOORS.some((d) => Math.abs(x - d) < DOOR_HALF - 0.2)) return false;
    if (z < 1.0) return false;
  }
  // columns
  for (const cx of COLS) if (Math.abs(x - cx) < 0.6 && Math.abs(z - COL_Z) < 0.6) return false;
  return true;
}
function updatePlayer(dt) {
  if (!player) return;
  const p = state.p;
  let ix = 0, iz = 0;
  if (state.mode === 'play' || state.mode === 'end') {
    if (keys.has('KeyW') || keys.has('ArrowUp')) iz -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) iz += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
    ix += stick.x; iz += stick.y;
  }
  if (state.mode === 'end' && p.frame === 'platform') { ix = iz = 0; }
  let mx = 0, mz = 0, moving = false, speed = 1.7;
  if (Math.hypot(ix, iz) > 0.15) {
    state.auto = [];
    // camera-relative movement
    camera.getWorldDirection(tmpV); tmpV.y = 0; tmpV.normalize();
    const fx = tmpV.x, fz = tmpV.z, rx = -fz, rz = fx;
    const m = Math.min(1, Math.hypot(ix, iz));
    const nx = (fx * -iz + rx * ix), nz = (fz * -iz + rz * ix); const l = Math.hypot(nx, nz) || 1;
    mx = (nx / l) * m; mz = (nz / l) * m;
  } else if (state.auto.length) {
    const [tx, tz] = state.auto[0];
    const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
    if (dist < 0.08) { state.auto.shift(); if (!state.auto.length) faceCamera(); }
    else { mx = dx / dist; mz = dz / dist; if (dist < 0.3) speed *= dist / 0.3 + 0.2; }
  }
  if (mx || mz) {
    const walk = p.frame === 'train' ? trainWalkable : platformWalkable;
    const step = speed * dt;
    const nx = p.x + mx * step, nz = p.z + mz * step;
    if (walk(nx, p.z)) p.x = nx;
    if (walk(p.x, nz)) p.z = nz;
    if (state.auto.length && p.x !== nx && p.z !== nz) { state.autoStuck = (state.autoStuck || 0) + dt; if (state.autoStuck > 0.6) { state.auto = []; state.autoStuck = 0; } } else state.autoStuck = 0;
    if (!walk(p.x, p.z)) { /* squeezed by closing doors */ }
    p.rot = lerpAngle(p.rot, Math.atan2(mx, mz), Math.min(1, dt * 10));
    moving = true;
  }
  // doors closing: keep player out of the doorway
  if (state.phase === 'closing' && state.door < 0.6) {
    if (p.frame === 'train' && p.z > 1.2) p.z = Math.max(1.2, p.z - dt * 2);
    if (p.frame === 'platform' && p.z < PSD_Z + 0.3) p.z = PSD_Z + 0.3;
  }
  // frame transitions (train <-> platform) — only when stopped at a station
  const stoppedHere = ['opening', 'open', 'closing'].includes(state.phase);
  if (p.frame === 'train' && p.z > 1.62 && stoppedHere) {
    setPlayerFrame('platform', state.at);
    if (state.mode === 'play') ui.hint.textContent = state.at === state.target ? '你已落車，車門關上後任務完成' : `你已喺${STATIONS[state.at].zh}站落車`;
  } else if (p.frame === 'platform' && p.z < 1.55 && stoppedHere && state.at === p.station) {
    setPlayerFrame('train');
    if (!state.boarded) {
      state.boarded = true;
      // walk to the middle of this carriage and stand there
      state.auto = [[p.x, 0.0], [carCenter(p.x), 0]];
      announce('歡迎乘搭荃灣綫', 'Welcome aboard the Tsuen Wan Line', 4);
    }
  }
  player.position.set(p.x, 0, p.z);
  player.rotation.y = p.rot;
  if (state.mode === 'end' && state.ended && p.frame === 'platform' && currentAction === actions.Cheer) { /* keep cheer */ }
  else if (state.mode === 'title') playAction('Idle');
  else playAction(moving ? 'Walk' : 'Idle', 0.2);
  if (actions.Walk) actions.Walk.timeScale = moving ? Math.max(0.6, speed / 1.7) : 1;
}
function faceCamera() {
  camera.getWorldDirection(tmpV);
  state.p.targetRot = Math.atan2(-tmpV.x, -tmpV.z);
  state.p.rot = lerpAngle(state.p.rot, state.p.targetRot, 1);
}
function lerpAngle(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI; if (d < -Math.PI) d += Math.PI * 2; return a + d * t; }

/* World placement: tiles, stations, environment */
let envOut = 0;
function updateWorld(dt) {
  world.position.x = -state.s;
  const base = Math.floor((state.s - (NTILE * TILE) / 2) / TILE) * TILE;
  for (let k = 0; k < NTILE; k++) {
    const T = base + k * TILE; const t = tiles[k];
    t.position.x = T;
    let inStation = false;
    for (let i = 0; i < 16; i++) { const xs = X(i); if (T >= xs - HALF_PLAT && T + TILE <= xs + HALF_PLAT) { inStation = true; break; } }
    const under = isUnderground(T + TILE / 2);
    t.userData.tunnel.visible = under && !inStation;
    t.userData.outdoor.visible = !under && !inStation;
  }
  // stations needed now
  const need = new Set([state.at]);
  if (state.phase === 'running') need.add(state.at + state.dir);
  if (state.p.frame === 'platform') need.add(state.p.station);
  for (const i of need) if (i >= 0 && i < 16) buildStation(i);
  for (const i of [...stationCache.keys()]) if (!need.has(i) && Math.abs(X(i) - state.s) > 260) disposeStation(i);
  // environment blend (outdoor vs underground) based on camera track position
  const camT = state.s + camera.position.x;
  const want = isUnderground(camT) ? 0 : 1;
  envOut += (want - envOut) * Math.min(1, dt * 2.5);
  scenery.visible = envOut > 0.02;
  if (envOut > 0.5) { scene.background = skyTex; } else scene.background = darkColor;
  fog.color.copy(darkColor).lerp(skyFogColor, envOut);
  fog.near = 30 + envOut * 60; fog.far = 170 + envOut * 500;
  sun.intensity = 0.35 + envOut * 1.6; hemi.intensity = 1.1 + envOut * 0.5;
  // headlight beam ahead of train in tunnels
  headBeam.position.set(state.dir * (2 * CAR_PITCH + CAR_HALF + 4), 0.8, 0);
  headBeam.intensity = state.v > 0.1 ? 40 * (1 - envOut) : 0;
}

/* Camera */
const camPos = new THREE.Vector3(0, 1.8, -1), camLook = new THREE.Vector3(0, 1.2, 1);
const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
let titleT = 0, snapCam = true;
function updateCamera(dt) {
  const p = state.p;
  if (state.mode === 'title' || state.mode === 'loading') {
    camOx.st = -1;
    titleT += dt * 0.18;
    const a = Math.sin(titleT) * 0.9;
    wantPos.set(2.8 + Math.sin(a) * 0.5, 1.55 + Math.sin(titleT * 1.7) * 0.05, -1.05);
    wantLook.set(0.9, 1.0, 0.0);
  } else if (p.frame === 'platform') {
    const rec = stationCache.get(p.station);
    const ox = rec ? rec.g.position.x - state.s : 0;
    if (camOx.st === p.station) { camPos.x += ox - camOx.v; camLook.x += ox - camOx.v; }
    camOx.st = p.station; camOx.v = ox;
    wantPos.set(ox + p.x + 0.4, 2.35, Math.min(p.z + 3.7, 8.55));
    wantLook.set(ox + p.x, 1.1, p.z - 2.4);
  } else {
    camOx.st = -1;
    const cx = THREE.MathUtils.clamp(p.x, -2 * CAR_PITCH - 9, 2 * CAR_PITCH + 9);
    if (state.camMode === 0) { wantPos.set(cx - 2.6, 1.85, -0.3); wantLook.set(p.x + 0.9, 1.05, 0.9); }
    else if (state.camMode === 1) { wantPos.set(cx + 2.6, 1.85, -0.3); wantLook.set(p.x - 0.9, 1.05, 0.9); }
    else { { const fz = THREE.MathUtils.clamp(p.z - 0.05, -0.5, 0.45); wantPos.set(p.x, 1.52, fz); wantLook.set(p.x, 1.38, fz + 3); } }
  }
  const k = snapCam ? 1 : 1 - Math.exp(-dt * (state.mode === 'title' ? 3 : 6)); snapCam = false;
  camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
  camera.position.copy(camPos); camera.lookAt(camLook);
  // carriage sway when moving
  if (p.frame === 'train' && state.v > 0.5) {
    const tt = performance.now() / 1000;
    camera.position.y += Math.sin(tt * 7.3) * 0.004 * Math.min(1, state.v / 15);
    camera.rotateZ(Math.sin(tt * 1.9) * 0.0025 * Math.min(1, state.v / 15) - state.acc * 0.0012 * state.dir);
  }
  if (player) player.visible = !(p.frame === 'train' && state.camMode === 2 && state.mode !== 'title');
}

/* HUD per frame */
let blinkT = 0;
function updateHUD(dt) {
  if (annTimer > 0) { annTimer -= dt; if (annTimer <= 0) ui.announce.classList.add('hidden'); }
  blinkT += dt; if (blinkT > 0.5) { blinkT = 0; state.blink = !state.blink; drawRouteMap(state.blink); }
  if (state.mode === 'title' || state.mode === 'loading') return;
  ui.speed.textContent = Math.round(state.v * 3.33);
  const ph = state.phase;
  ui.status.textContent = ph === 'approach' ? '列車即將到達' : ph === 'running' ? (state.acc > 0 ? '開出中' : state.acc < 0 ? '減速進站' : '行駛中') : ph === 'open' || ph === 'opening' ? '車門已開' : ph === 'closing' ? '車門關閉中' : ph === 'arrived' ? '到站' : '—';
  const mt = $('mini-train'); if (mt) mt.style.left = `${THREE.MathUtils.clamp(state.s / X(15), 0, 1) * 100}%`;
  // action button + hint
  const p = state.p;
  const usable = doorsUsable() && state.mode === 'play' && (p.frame === 'train' || state.at === p.station);
  ui.action.classList.toggle('hidden', state.mode !== 'play');
  if (state.mode === 'play') {
    ui.action.disabled = !usable;
    ui.action.textContent = p.frame === 'train' ? '落車' : '上車';
  }
  if (state.mode !== 'play') { ui.hint.textContent = ''; return; }
  let hint = '';
  if (!state.boarded) hint = ph === 'approach' || ph === 'arrived' ? '請在幕門前等候列車到站' : usable ? '車門已開：行入車廂上車（或按「上車」）' : '';
  else if (p.frame === 'train') {
    if (ph === 'open' && state.at !== START) hint = state.at === state.target ? `已到 ${STATIONS[state.at].zh}，快啲行出車門落車` : `本站 ${STATIONS[state.at].zh} · 目標係 ${STATIONS[state.target].zh}`;
    else if (ph === 'running') hint = '按 C 轉視角 · 按 F 加速列車';
  } else hint = state.at === p.station ? '你已喺月台，車門關上後就會確認' : '';
  ui.hint.textContent = hint;
}

/* =========================================================
   Boot
   ========================================================= */
async function boot() {
  const bar = $('load-bar'), txt = $('load-text');
  const chars = STATIONS.map((s) => s.zh + s.en).join('') + '往列車即將到達已下一班分鐘荃灣綫往中環To';
  bar.style.width = '15%';
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 40px "Noto Serif TC"', chars), document.fonts.load('700 40px "Noto Sans TC"', chars),
        document.fonts.load('500 40px "Noto Sans TC"', chars),
      ]),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
  } catch (e) { /* fonts optional */ }
  bar.style.width = '35%';
  const gltf = await loadCharacter((f) => { bar.style.width = `${35 + f * 50}%`; });
  bar.style.width = '90%'; txt.textContent = '建立荃灣綫車站及列車 …';
  player = gltf.scene;
  player.scale.setScalar(0.92);
  mixer = new THREE.AnimationMixer(player);
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  if (actions.Cheer) { actions.Cheer.setLoop(THREE.LoopRepeat); }
  // place the character in the exact centre of the carriage, playing the breathing/idle clip
  train.add(player); player.position.set(0, 0, 0); state.p = { frame: 'train', x: 0, z: 0, rot: 1.9, station: START };
  playAction('Idle', 0);
  state.mode = 'title'; state.phase = 'idle'; state.at = START; state.s = X(START);
  buildStation(START);
  drawRouteMap(false);
  bar.style.width = '100%';
  setTimeout(() => { ui.loading.classList.add('hidden'); ui.title.classList.remove('hidden'); }, 250);
  window.__game = { state, startGame, doAction, STATIONS, X, get player() { return player; }, camera,
    advance(secs, dt = 0.05) { for (let t = 0; t < secs; t += dt) { if (state.mode === 'play' || state.mode === 'end') updateTrain(dt * (state.boarded && state.p.frame === 'train' ? state.ff : 1)); updatePlayer(dt); updateWorld(dt); } snapCam = true; } };
}

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.mode === 'play' || state.mode === 'end') {
    const sdt = dt * (state.boarded && state.p.frame === 'train' ? state.ff : 1);
    updateTrain(sdt);
  }
  updatePlayer(dt);
  updateWorld(dt);
  updateCamera(dt);
  if (mixer) mixer.update(dt);
  audio.update();
  updateHUD(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = camera.aspect < 0.8 ? 75 : 62;
  camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight);
});
window.dispatchEvent(new Event('resize'));
boot().catch((e) => { $('load-text').textContent = '載入失敗：' + e.message; console.error(e); });
frame();
