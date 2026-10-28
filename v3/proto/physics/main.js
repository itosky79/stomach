/* 胃の物理の試作（第 0 段階の 5）
   目的：Quest 2 で次の 3 つが滑らかに動くかを測る。
   1. 胃が伸び縮みする（位置ベースの柔らかい物体：辺の長さ、体積（ガスの圧）、元の形へ戻る力）
   2. 圧迫筒で押すとへこむ（筒の先端の円板より奥に入った前壁を押し戻す。背側は台で支える）
   3. バリウムが溜まり、壁にへばりつく（液面は体積が合う高さを二分法で求める。付着は頂点ごとの量）
   単位は cm（v2 の寸法の決まり）。VR では 1 cm = 0.01 m で表示する。 */
import * as THREE from '../../lib/three.module.min.js';

const Q = new URLSearchParams(location.search);
let EMU = '';
if (Q.get('xr') === 'emulate') {
  const { XRDevice, metaQuest2, metaQuest3, DevUI } = await import('../../lib/iwer.min.js');
  const dev = new XRDevice(Q.get('device') === 'quest2' ? metaQuest2 : metaQuest3);
  dev.installRuntime({ forceInstall: true });
  new DevUI(dev);
  EMU = Q.get('device') === 'quest2' ? 'Quest 2' : 'Quest 3';
}
window.PROTO_OK = true;

/* ---------------- 描画の準備 ---------------- */
const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0A0F14);
const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 2000);
camera.position.set(0, 22, 62); camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xE4F1FF, 0x1C2A36, 1.6));
const sun = new THREE.DirectionalLight(0xFFFFFF, 1.8); sun.position.set(0.4, 1, 0.7); scene.add(sun);

const world = new THREE.Group(); scene.add(world);      // cm の世界。VR のときだけ縮めて目の前に置く
const body = new THREE.Group(); world.add(body);        // 胃。体位（傾き・回転）で向きが変わる
const grid = new THREE.GridHelper(80, 16, 0x24384A, 0x16222E); grid.position.y = -20; world.add(grid);

/* ---------------- 胃の形（J 字の管＋両端の丸み）---------------- */
// 座標：x = 患者の左(+)、y = 頭側(+)、z = 腹側(+)
const CL = [[2, 11, -2], [4, 7, -1], [4.5, 2, 0], [3.5, -3, 1], [1, -7, 2], [-3, -8.5, 2.5], [-7, -6, 2], [-9.5, -2.5, 1]];
const RAD = [5.2, 5.8, 5.6, 5.2, 4.6, 3.9, 3.0, 2.0];
const RES = [[36, 14], [70, 22], [120, 32]];            // [断面の数, 1 周の頂点数]

let N = 0, T = 0, pos, prev, rest, restBase, idx, ea, eb, el, grad, wet, wmax, sub, contact, V0 = 1;
let geom, meshFront, meshBack;
const matFront = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.55, side: THREE.FrontSide });
const matBack = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.7, side: THREE.BackSide });

function build(level) {
  const [R0, C] = RES[level];
  const curve = new THREE.CatmullRomCurve3(CL.map(p => new THREE.Vector3(...p)));
  const KC = level === 0 ? 3 : 5;                     // 両端の丸みに使う輪の数
  const R = R0 + KC * 2;
  const fr = curve.computeFrenetFrames(R0 - 1, false);
  N = R * C + 2; pos = new Float32Array(N * 3);
  const radAt = u => { const f = u * (RAD.length - 1), i = Math.min(RAD.length - 2, Math.floor(f)); return RAD[i] + (RAD[i + 1] - RAD[i]) * (f - i); };
  const c = new THREE.Vector3(), p = new THREE.Vector3();
  // 輪 i：先頭 KC 個は噴門側の半球、末尾 KC 個は幽門側の半球、間が管
  const ring = (i, cc, nn, bb, r) => {
    for (let j = 0; j < C; j++) {
      const th = j / C * Math.PI * 2;
      p.copy(cc).addScaledVector(nn, r * Math.cos(th)).addScaledVector(bb, r * Math.sin(th));
      p.toArray(pos, (i * C + j) * 3);
    }
  };
  const ends = [[0, -1], [R0 - 1, 1]];
  for (let i = 0; i < R0; i++) { const u = i / (R0 - 1); curve.getPointAt(u, c); ring(KC + i, c, fr.normals[i], fr.binormals[i], radAt(u)); }
  for (const [fi, sg] of ends) {
    const u = fi / (R0 - 1), r = radAt(u), squash = sg < 0 ? 0.9 : 0.6;
    for (let k = 1; k <= KC; k++) {
      const ph = k / (KC + 1) * Math.PI / 2;
      curve.getPointAt(u, c); c.addScaledVector(fr.tangents[fi], sg * r * squash * Math.sin(ph));
      ring(sg < 0 ? KC - k : KC + R0 - 1 + k, c, fr.normals[fi], fr.binormals[fi], r * Math.cos(ph));
    }
    curve.getPointAt(u, c); c.addScaledVector(fr.tangents[fi], sg * r * squash).toArray(pos, (sg < 0 ? N - 2 : N - 1) * 3);
  }
  const ix = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C; j++) {
    const j2 = (j + 1) % C, a = i * C + j, b = i * C + j2, d = (i + 1) * C + j, e = (i + 1) * C + j2;
    ix.push(a, d, b, b, d, e);
  }
  for (let j = 0; j < C; j++) { const j2 = (j + 1) % C; ix.push(N - 2, j2, j); ix.push(N - 1, (R - 1) * C + j, (R - 1) * C + j2); }
  idx = new Uint32Array(ix); T = idx.length / 3;
  if (volume(pos) < 0) for (let t = 0; t < T; t++) { const k = idx[t * 3 + 1]; idx[t * 3 + 1] = idx[t * 3 + 2]; idx[t * 3 + 2] = k; }
  V0 = volume(pos);
  // 辺（重複なし）
  const seen = new Set(), A = [], B = [];
  for (let t = 0; t < T; t++) for (let k = 0; k < 3; k++) {
    const a = idx[t * 3 + k], b = idx[t * 3 + (k + 1) % 3], lo = Math.min(a, b), hi = Math.max(a, b), key = lo * N + hi;
    if (!seen.has(key)) { seen.add(key); A.push(lo); B.push(hi); }
  }
  ea = new Uint32Array(A); eb = new Uint32Array(B); el = new Float32Array(A.length);
  for (let e = 0; e < A.length; e++) el[e] = dist(pos, A[e], B[e]);
  prev = pos.slice(); restBase = pos.slice(); rest = pos.slice();
  grad = new Float32Array(N * 3); wet = new Float32Array(N); wmax = new Float32Array(N);
  sub = new Float32Array(N); contact = new Uint8Array(N);
  if (geom) { body.remove(meshFront, meshBack); geom.dispose(); }
  geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage));
  geom.setIndex(new THREE.BufferAttribute(idx, 1));
  meshBack = new THREE.Mesh(geom, matBack); meshBack.renderOrder = 1;
  meshFront = new THREE.Mesh(geom, matFront); meshFront.renderOrder = 3;
  body.add(meshBack, meshFront);
  backZ = Infinity; for (let i = 0; i < N; i++) backZ = Math.min(backZ, pos[i * 3 + 2]); backZ -= 0.3;
  refill();
}
function dist(P, a, b) { return Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]); }
function volume(P) {
  let v = 0;
  for (let t = 0; t < T; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return v / 6;
}
let backZ = 0;
function refill() { wet.fill(0); wmax.fill(0); }

/* ---------------- 柔らかい物体（位置ベース）---------------- */
const P = { visc: 0.6, adh: 0.5, ml: 150, gas: 1.0 };
function setGas(g) {   // ガスの量で元の形を相似に膨らませる
  P.gas = g; const s = Math.cbrt(g);
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < N; i++) { cx += restBase[i * 3]; cy += restBase[i * 3 + 1]; cz += restBase[i * 3 + 2]; }
  cx /= N; cy /= N; cz /= N;
  for (let i = 0; i < N; i++) {
    rest[i * 3] = cx + (restBase[i * 3] - cx) * s; rest[i * 3 + 1] = cy + (restBase[i * 3 + 1] - cy) * s; rest[i * 3 + 2] = cz + (restBase[i * 3 + 2] - cz) * s;
  }
  for (let e = 0; e < ea.length; e++) el[e] = dist(rest, ea[e], eb[e]);
}
const cones = [];   // { tip: Vector3（胃の座標）, axis: Vector3（押す向き）, r }
function physics() {
  // 慣性（減衰つき）と元の形へ戻る力
  for (let k = 0; k < N * 3; k++) {
    const v = (pos[k] - prev[k]) * 0.82; prev[k] = pos[k];
    pos[k] += v + (rest[k] - pos[k]) * 0.035;
  }
  const Vt = V0 * P.gas;
  for (let it = 0; it < 4; it++) {
    // 辺の長さ
    for (let e = 0; e < ea.length; e++) {
      const a = ea[e] * 3, b = eb[e] * 3;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz) || 1e-6, s = (d - el[e]) / d * 0.5 * 0.6;
      pos[a] += dx * s; pos[a + 1] += dy * s; pos[a + 2] += dz * s;
      pos[b] -= dx * s; pos[b + 1] -= dy * s; pos[b + 2] -= dz * s;
    }
    // 体積（ガスの圧）
    grad.fill(0); let V = 0;
    for (let t = 0; t < T; t++) {
      const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2], bx = pos[b], by = pos[b + 1], bz = pos[b + 2], cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
      const x1 = by * cz - bz * cy, y1 = bz * cx - bx * cz, z1 = bx * cy - by * cx;   // b×c
      V += ax * x1 + ay * y1 + az * z1;
      grad[a] += x1; grad[a + 1] += y1; grad[a + 2] += z1;
      grad[b] += cy * az - cz * ay; grad[b + 1] += cz * ax - cx * az; grad[b + 2] += cx * ay - cy * ax;   // c×a
      grad[c] += ay * bz - az * by; grad[c + 1] += az * bx - ax * bz; grad[c + 2] += ax * by - ay * bx;   // a×b
    }
    V /= 6; let g2 = 0;
    for (let k = 0; k < N * 3; k++) { grad[k] /= 6; g2 += grad[k] * grad[k]; }
    const lam = (Vt - V) / (g2 || 1) * 0.5;
    for (let k = 0; k < N * 3; k++) pos[k] += grad[k] * lam;
    // 圧迫筒と背中（台）
    collide();
  }
}
const nrm = () => geom.attributes.normal ? geom.attributes.normal.array : null;
function collide() {
  contact.fill(0);
  const NR = nrm();
  for (const cn of cones) {
    const tx = cn.tip.x, ty = cn.tip.y, tz = cn.tip.z, ax = cn.axis.x, ay = cn.axis.y, az = cn.axis.z, r2 = cn.r * cn.r;
    for (let i = 0; i < N; i++) {
      const k = i * 3, dx = pos[k] - tx, dy = pos[k + 1] - ty, dz = pos[k + 2] - tz;
      const t = dx * ax + dy * ay + dz * az;
      if (t <= 0 || t > 14) continue;
      if (NR && NR[k] * ax + NR[k + 1] * ay + NR[k + 2] * az > 0.25) continue;   // 筒のほうを向いた壁（前壁）だけ押す
      const qx = dx - ax * t, qy = dy - ay * t, qz = dz - az * t;
      if (qx * qx + qy * qy + qz * qz > r2) continue;
      pos[k] -= ax * t; pos[k + 1] -= ay * t; pos[k + 2] -= az * t;
      contact[i] = 1;
    }
  }
  for (let i = 0; i < N; i++) if (pos[i * 3 + 2] < backZ) pos[i * 3 + 2] = backZ;
}

/* ---------------- バリウムの液面とへばりつき ---------------- */
const up = new THREE.Vector3(0, 1, 0);   // 胃の座標での「上」
const poly = new Float32Array(4 * 3);
function volBelow(L) {   // 上向き u で高さ < L の部分の体積。切り口は平面上の点 O を頂点にした四面体で 0 になる
  const ux = up.x, uy = up.y, uz = up.z, ox = ux * L, oy = uy * L, oz = uz * L;
  let V = 0;
  for (let t = 0; t < T; t++) {
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k] * 3, b = idx[t * 3 + (k + 1) % 3] * 3;
      const ha = pos[a] * ux + pos[a + 1] * uy + pos[a + 2] * uz - L, hb = pos[b] * ux + pos[b + 1] * uy + pos[b + 2] * uz - L;
      if (ha < 0) { poly[n * 3] = pos[a]; poly[n * 3 + 1] = pos[a + 1]; poly[n * 3 + 2] = pos[a + 2]; n++; }
      if ((ha < 0) !== (hb < 0)) {
        const f = ha / (ha - hb);
        poly[n * 3] = pos[a] + (pos[b] - pos[a]) * f; poly[n * 3 + 1] = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f; poly[n * 3 + 2] = pos[a + 2] + (pos[b + 2] - pos[a + 2]) * f; n++;
      }
    }
    for (let k = 1; k + 1 < n; k++) {
      const ax = poly[0] - ox, ay = poly[1] - oy, az = poly[2] - oz;
      const bx = poly[k * 3] - ox, by = poly[k * 3 + 1] - oy, bz = poly[k * 3 + 2] - oz;
      const cx = poly[k * 3 + 3] - ox, cy = poly[k * 3 + 4] - oy, cz = poly[k * 3 + 5] - oz;
      V += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
  }
  return V / 6;
}
let level = 0, vNow = 0;
function solveLevel() {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N; i++) { const h = pos[i * 3] * up.x + pos[i * 3 + 1] * up.y + pos[i * 3 + 2] * up.z; lo = Math.min(lo, h); hi = Math.max(hi, h); }
  vNow = volume(pos);
  const target = Math.min(P.ml, vNow * 0.96);
  for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (volBelow(m) < target) lo = m; else hi = m; }
  level = (lo + hi) / 2;
  for (let i = 0; i < N; i++) { const d = level - (pos[i * 3] * up.x + pos[i * 3 + 1] * up.y + pos[i * 3 + 2] * up.z); sub[i] = Math.max(0, Math.min(1, 0.5 + d / 1.2)); }
}
function updateWet(dt) {
  // 液に浸かると付く。出ると、粘度が低いほど速く流れ落ち、付着が強いほど薄い層が残る
  const drain = 0.12 + 2.6 * (1 - P.visc) * (1 - P.visc);
  for (let i = 0; i < N; i++) {
    if (sub[i] > 0.5) { wet[i] += (1 - wet[i]) * Math.min(1, dt * 6); }
    else {
      const floor = wmax[i] * (0.15 + 0.6 * P.adh);
      if (wet[i] > floor) wet[i] = Math.max(floor, wet[i] - drain * dt * (wet[i] - floor + 0.08));
    }
    if (contact[i]) wet[i] *= 0.985;   // 圧迫で押された壁からは少し押しのけられる
    if (wet[i] > wmax[i]) wmax[i] = wet[i];
  }
}

/* ---------------- 液面（ニボー）の板 ---------------- */
const MAXD = 4096;
const discGeom = new THREE.BufferGeometry();
discGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXD * 9), 3).setUsage(THREE.DynamicDrawUsage));
const disc = new THREE.Mesh(discGeom, new THREE.MeshStandardMaterial({ color: 0xF4F6F8, roughness: 0.35, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }));
disc.renderOrder = 2; body.add(disc);
function buildDisc() {
  // 液面と交わる三角形ごとに切り口の線分を出し、つながった輪ごとに重心から扇形に張る
  const segs = [], parent = new Map();
  const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
  const ptOf = new Map();
  const L = level, ux = up.x, uy = up.y, uz = up.z;
  for (let t = 0; t < T; t++) {
    const keys = [];
    for (let k = 0; k < 3; k++) {
      const ia = idx[t * 3 + k], ib = idx[t * 3 + (k + 1) % 3], a = ia * 3, b = ib * 3;
      const ha = pos[a] * ux + pos[a + 1] * uy + pos[a + 2] * uz - L, hb = pos[b] * ux + pos[b + 1] * uy + pos[b + 2] * uz - L;
      if ((ha < 0) === (hb < 0)) continue;
      const key = Math.min(ia, ib) * N + Math.max(ia, ib);
      if (!ptOf.has(key)) {
        const f = ha / (ha - hb);
        ptOf.set(key, [pos[a] + (pos[b] - pos[a]) * f, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * f, pos[a + 2] + (pos[b + 2] - pos[a + 2]) * f]);
        parent.set(key, key);
      }
      keys.push(key);
    }
    if (keys.length === 2) { segs.push(keys); const ra = find(keys[0]), rb = find(keys[1]); if (ra !== rb) parent.set(ra, rb); }
  }
  const cen = new Map();
  for (const [key, p] of ptOf) { const r = find(key); const c = cen.get(r) || [0, 0, 0, 0]; c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; c[3]++; cen.set(r, c); }
  const arr = discGeom.attributes.position.array; let n = 0;
  for (const [ka, kb] of segs) {
    if (n >= MAXD) break;
    const c = cen.get(find(ka)), pa = ptOf.get(ka), pb = ptOf.get(kb), o = n * 9;
    arr[o] = c[0] / c[3]; arr[o + 1] = c[1] / c[3]; arr[o + 2] = c[2] / c[3];
    arr[o + 3] = pa[0]; arr[o + 4] = pa[1]; arr[o + 5] = pa[2]; arr[o + 6] = pb[0]; arr[o + 7] = pb[1]; arr[o + 8] = pb[2];
    n++;
  }
  discGeom.setDrawRange(0, n * 3);
  discGeom.attributes.position.needsUpdate = true;
  discGeom.computeVertexNormals();
}

/* ---------------- 色（粘膜・付着・液）---------------- */
function paint() {
  const col = geom.attributes.color.array;
  for (let i = 0; i < N; i++) {
    const s = sub[i], w = s + (1 - s) * wet[i], o = i * 4;
    col[o] = 0.70 + (0.95 - 0.70) * w; col[o + 1] = 0.36 + (0.96 - 0.36) * w; col[o + 2] = 0.40 + (0.97 - 0.40) * w;
    col[o + 3] = 0.30 + 0.55 * wet[i] * (1 - s) + 0.93 * s - 0.30 * s;
  }
  geom.attributes.color.needsUpdate = true;
  geom.attributes.position.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}

/* ---------------- 圧迫筒 ---------------- */
const CONE_R = 5;   // 先端の直径 10 cm（DIMENSIONS.md）
const coneGeo = new THREE.CylinderGeometry(CONE_R, CONE_R * 1.1, 24, 28, 1, false); coneGeo.translate(0, -12, 0);
const coneMat = new THREE.MeshStandardMaterial({ color: 0x9FB6C4, roughness: 0.4, transparent: true, opacity: 0.32, depthWrite: false });
function makeCone() { const m = new THREE.Mesh(coneGeo, coneMat); m.renderOrder = 4; m.visible = false; world.add(m); return m; }
const coneMeshes = [makeCone(), makeCone()];
const Yax = new THREE.Vector3(0, 1, 0);
function placeConeMesh(m, tipWorldCm, axisWorld) {   // tip と axis は world（cm）の座標
  m.position.copy(tipWorldCm); m.quaternion.setFromUnitVectors(Yax, axisWorld); m.visible = true;
}
const _q = new THREE.Quaternion(), _v = new THREE.Vector3();
function toBody(tipWorldCm, axisWorld, r) {
  body.updateMatrixWorld();
  const tip = body.worldToLocal(world.localToWorld(tipWorldCm.clone()));
  body.getWorldQuaternion(_q);
  const axis = axisWorld.clone().applyQuaternion(_q.clone().invert()).normalize();
  return { tip, axis, r };
}

// 画面：マウスを押し続けると、カーソルの先の胃を押す
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
let mouseIn = false, pressing = false, press = 0, contactPt = null, contactDir = new THREE.Vector3();
canvas.addEventListener('pointermove', e => { mouse.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); mouseIn = true; });
canvas.addEventListener('pointerleave', () => { mouseIn = false; });
canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pressing = true; mouse.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1); mouseIn = true; });
canvas.addEventListener('pointerup', () => { pressing = false; });
function screenCone(dt) {
  press += ((pressing ? 1 : 0) - press) * Math.min(1, dt * (pressing ? 2.2 : 5));
  coneMeshes[1].visible = false;
  if (!mouseIn) { coneMeshes[0].visible = false; return; }
  ray.setFromCamera(mouse, camera);
  if (!pressing || !contactPt) {
    const hit = ray.intersectObject(meshFront, false)[0];
    if (hit) { contactPt = world.worldToLocal(hit.point.clone()); contactDir.copy(ray.ray.direction); }
    else if (!pressing) { contactPt = null; }
  } else {
    // 押している間は、最初に当てた点を通り視線に垂直な面の上でカーソルを追う
    const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(contactDir, world.localToWorld(contactPt.clone()));
    const p = ray.ray.intersectPlane(pl, new THREE.Vector3()); if (p) contactPt = world.worldToLocal(p);
  }
  if (!contactPt) { coneMeshes[0].visible = false; return; }
  const tip = contactPt.clone().addScaledVector(contactDir, -2.5 + press * 8.5);   // 押すと最大 6 cm 食い込む
  placeConeMesh(coneMeshes[0], tip, contactDir);
  coneMeshes[0].visible = press > 0.02;   // 押していないときは筒を出さない（胃が見えるように）
  if (press > 0.02) cones.push(toBody(tip, contactDir, CONE_R));
}

// VR：コントローラーの先が圧迫筒の先端
const ctrls = [renderer.xr.getController(0), renderer.xr.getController(1)];
ctrls.forEach(c => scene.add(c));
const _f = new THREE.Vector3();
function xrCones() {
  ctrls.forEach((c, i) => {
    const m = coneMeshes[i];
    if (!c.visible) { m.visible = false; return; }
    c.getWorldDirection(_f).negate();                      // コントローラーの前（-Z）
    const tipW = c.getWorldPosition(new THREE.Vector3()).addScaledVector(_f, 0.04);
    const tipCm = world.worldToLocal(tipW);
    placeConeMesh(m, tipCm, _f);
    cones.push(toBody(tipCm, _f.clone(), CONE_R));
  });
}

/* ---------------- 重さの表示 ---------------- */
const perfEl = document.getElementById('perf');
const pf = { prev: 0, n: 0, sum: 0, max: 0, phys: 0, text: '' };
const pcv = document.createElement('canvas'); pcv.width = 640; pcv.height = 240;
const pcx = pcv.getContext('2d'); const ptex = new THREE.CanvasTexture(pcv);
const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.18), new THREE.MeshBasicMaterial({ map: ptex, transparent: true }));
panel.position.set(0.42, 1.32, -0.75); panel.rotation.y = -0.45; panel.visible = false; scene.add(panel);
function perfTick(now, physMs) {
  if (pf.prev) { const d = now - pf.prev; pf.n++; pf.sum += d; pf.max = Math.max(pf.max, d); pf.phys += physMs; }
  pf.prev = now;
  if (pf.sum < 500) return;
  const vr = renderer.xr.isPresenting;
  pf.text = (pf.n * 1000 / pf.sum).toFixed(0) + ' fps（' + (vr ? 'VR' : '画面') + (EMU ? '・' + EMU + ' を模擬' : '') + '）\n' +
    '1 回 ' + (pf.sum / pf.n).toFixed(1) + ' ms（最大 ' + pf.max.toFixed(1) + '）\n' +
    '物理 ' + (pf.phys / pf.n).toFixed(1) + ' ms・頂点 ' + N + '・三角形 ' + T + '\n' +
    '胃 ' + vNow.toFixed(0) + ' ml・バリウム ' + Math.min(P.ml, vNow * 0.96).toFixed(0) + ' ml';
  perfEl.textContent = pf.text;
  if (vr) {
    pcx.fillStyle = 'rgba(5,8,11,0.9)'; pcx.fillRect(0, 0, 640, 240);
    pcx.fillStyle = '#CFE8EF'; pcx.font = '30px monospace';
    pf.text.split('\n').forEach((l, i) => pcx.fillText(l, 20, 48 + i * 50));
    ptex.needsUpdate = true;
  }
  pf.n = 0; pf.sum = 0; pf.max = 0; pf.phys = 0;
}

/* ---------------- 操作パネル ---------------- */
const $ = id => document.getElementById(id);
function bind(id, fmt, fn) {
  const el = $(id), out = el.parentElement.querySelector('output');
  const upd = () => { out.textContent = fmt(+el.value); fn(+el.value); };
  el.addEventListener('input', upd); upd();
}
let tilt = 0, roll = 0;
bind('visc', v => v, v => { P.visc = v / 100; });
bind('adh', v => v, v => { P.adh = v / 100; });
bind('ml', v => v + 'ml', v => { P.ml = v; });
bind('tilt', v => v + '°', v => { tilt = v; });
bind('roll', v => v + '°', v => { roll = v; });
let resLevel = [0, 1, 2].includes(+Q.get('res')) && Q.get('res') !== null ? +Q.get('res') : 1;   // ?res=0/1/2 で最初の細かさ
[...$('res').children].forEach(x => x.setAttribute('aria-pressed', +x.dataset.r === resLevel));
build(resLevel);
bind('gas', v => v + '%', v => { setGas(v / 100); });
$('res').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  resLevel = +b.dataset.r; [...$('res').children].forEach(x => x.setAttribute('aria-pressed', x === b));
  build(resLevel); setGas(+$('gas').value / 100);
});
$('refill').addEventListener('click', refill);
const VIEWS = { front: [0, 22, 62], side: [62, 10, 4], top: [0, 64, 8] };
$('view').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  [...$('view').children].forEach(x => x.setAttribute('aria-pressed', x === b));
  camera.position.set(...VIEWS[b.dataset.v]); camera.lookAt(0, 0, 0);
});

/* ---------------- VR の出入り ---------------- */
const bVR = $('vr');
if (navigator.xr && navigator.xr.isSessionSupported) navigator.xr.isSessionSupported('immersive-vr').then(ok => { bVR.hidden = !ok; }).catch(() => { });
let xrs = null;
bVR.addEventListener('click', async () => {
  if (xrs) { xrs.end(); return; }
  try {
    xrs = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'hand-tracking'] });
    xrs.addEventListener('end', () => {
      xrs = null; bVR.textContent = 'VR'; world.scale.setScalar(1); world.position.set(0, 0, 0); panel.visible = false;
      setTimeout(() => { camera.fov = 40; camera.near = 0.5; resize(); }, 0);
    });
    camera.near = 0.05; camera.updateProjectionMatrix();
    await renderer.xr.setSession(xrs);
    world.scale.setScalar(0.01); world.position.set(0, 1.15, -0.45);   // 胃を胸の下くらいの高さ、手の届く 45 cm 前に
    panel.visible = true; bVR.textContent = 'VR 終了';
  } catch (e) { console.warn('VR を開始できませんでした', e); xrs = null; }
});

/* ---------------- ループ ---------------- */
function resize() {
  if (renderer.xr.isPresenting) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
const _gq = new THREE.Quaternion();
let last = performance.now();
renderer.setAnimationLoop(now => {
  const dt = Math.max(0.001, Math.min(0.05, (now - last) / 1000)); last = now;
  // 体位：傾き（0 = 立位。頭側を奥へ倒す）と、体軸まわりの回転
  body.quaternion.setFromEuler(new THREE.Euler(-tilt * Math.PI / 180, roll * Math.PI / 180, 0, 'XYZ'));
  body.updateMatrixWorld();
  body.getWorldQuaternion(_gq);
  up.set(0, 1, 0).applyQuaternion(_gq.invert());
  const t0 = performance.now();
  cones.length = 0;
  if (renderer.xr.isPresenting) xrCones(); else screenCone(dt);
  physics();
  solveLevel();
  updateWet(dt);
  buildDisc();
  paint();
  const physMs = performance.now() - t0;
  renderer.render(scene, camera);
  perfTick(now, physMs);
});
