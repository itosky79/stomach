"use strict";
/* ================= 状態 ================= */
let curType = 'hook', curMode = 0, curPose = 'stand';
let pylorusOpen = false, labelMode = 1, showBone = true;
let showOri = true;
let autoSpin = false, viewMode = 1, skinOpacity = 0.30;
let airLevel = 0.6, targetMl = 120, administered = 0;
let compRegion = '', compAmt = 0;
let tiltCur = 90, rollCur = 0, tiltT = 90, rollT = 0;
let seqIdx = -1, playing = false, playT = 0;
let fluoroTime = 0, shotCount = 0, films = [];

const Zax = new THREE.Vector3(0, 0, 1), Yax = new THREE.Vector3(0, 1, 0);
const qBase = (function () {
  const b = POSES.supine.basis;
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(b[0][0], b[0][1], b[0][2]),
    new THREE.Vector3(b[1][0], b[1][1], b[1][2]),
    new THREE.Vector3(b[2][0], b[2][1], b[2][2])));
})();
const qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
const gWorld = new THREE.Vector3(0, -1, 0);      // 室内では重力はつねに真下
const qWorldBody = new THREE.Quaternion();
function applyPose() {
  qA.setFromAxisAngle(Zax, -tiltCur * Math.PI / 180);   // 撮影台の起倒
  qB.setFromAxisAngle(Yax, rollCur * Math.PI / 180);    // 患者の体軸回転
  tiltGroup.quaternion.copy(qA);
  bodyGroup.quaternion.copy(qBase).multiply(qB);
  qWorldBody.copy(qA).multiply(bodyGroup.quaternion);
  placeTable();
}
function upLocal(out) {
  qA.copy(qWorldBody).invert();
  return out.set(0, 1, 0).applyQuaternion(qA);
}
function goPose(t, r) {
  tiltT = t;
  rollT = rollCur + (((r - rollCur) % 360 + 540) % 360 - 180);
}
const ROLLN = [[0, '正面'], [45, '第1斜位'], [90, '左側臥位'], [135, '腹臥位第2斜位'],
               [180, '腹臥位正面'], [225, '腹臥位第1斜位'], [270, '右側臥位'], [315, '第2斜位']];
//  第1斜位＝右前斜位（RAO）。背臥位では右側挙上、腹臥位では左側挙上で、
//  同じ斜位面を後壁側／前壁側から見ることになる。第2斜位はその逆。
function poseName(tilt, roll) {
  const r = ((roll % 360) + 360) % 360;
  let best = ROLLN[0], bd = 999;
  for (const e of ROLLN) { const d = Math.min(Math.abs(r - e[0]), 360 - Math.abs(r - e[0])); if (d < bd) { bd = d; best = e; } }
  const tl = tilt >= 70 ? '立位' : tilt >= 25 ? '半立位' : tilt > -10 ? '水平' : '頭低位';
  if (best[1] === '正面' || best[1] === '第1斜位' || best[1] === '第2斜位')
    return (tl === '水平' ? '背臥位' : tl) + best[1];
  return (tl === '水平' ? '' : tl + '・') + best[1];
}

/* ================= 流体ソルバ ================= */
function computeHeights() {
  const ux = uUp.value.x, uy = uUp.value.y, uz = uUp.value.z;
  for (let n = 0; n < NN; n++) {
    let lo = 1e9, hi = -1e9; const b = n * CM;
    for (let j = 0; j < CM; j++) {
      const k = (b + j) * 3;
      const h = pos[k] * ux + pos[k + 1] * uy + pos[k + 2] * uz;
      hArr[b + j] = h;
      if (h < lo) lo = h; if (h > hi) hi = h;
    }
    hmin[n] = lo; hmax[n] = hi;
  }
}
function levelOf(n) {
  const c = cap[n]; if (c <= 1e-9) return hmin[n] - 1e-3;
  const f = wVol[n] / c;
  if (f <= 0) return hmin[n] - 1e-3;
  if (f >= 1) return hmax[n];
  return hmin[n] + invFrac(f) * (hmax[n] - hmin[n]);
}
function flowStep(dt) {
  const K = 6.5, ds = dt / SUB;
  for (let s = 0; s < SUB; s++) {
    const rev = (s & 1) === 1;
    for (let e = 0; e < edges.length; e++) {
      const E = edges[rev ? edges.length - 1 - e : e];
      const i = E.i, j = E.j;
      const B = Math.max(hmin[i], hmin[j]);
      const si = levelOf(i), sj = levelOf(j);
      let a, b, kk, head;
      const hi2 = si - Math.max(sj, B), hj2 = sj - Math.max(si, B);
      if (hi2 > 1e-5) { a = i; b = j; kk = E.k; head = hi2; }
      else if (hj2 > 1e-5) { a = j; b = i; kk = E.k2; head = hj2; }
      else continue;
      const Ae = Math.min(area[i], area[j]);
      let amt = K * kk * head * Ae * ds;
      const lim = Math.min(wVol[a] * 0.5, cap[b] - wVol[b], 0.30 * Math.min(cap[i], cap[j]));
      if (amt > lim) amt = lim;
      if (amt <= 0) continue;
      wVol[a] -= amt; wVol[b] += amt;
    }
  }
}
function dose(dt) {
  const diff = targetMl - administered;
  if (diff > 0.2) {
    let free = 0;
    for (let n = NMAIN; n < NMAIN + 6; n++) free += Math.max(0, cap[n] - wVol[n]);
    if (free > 1e-4) {
      const amt = Math.min(diff, 280 * dt, free);
      for (let n = NMAIN; n < NMAIN + 6; n++) wVol[n] += amt * Math.max(0, cap[n] - wVol[n]) / free;
      administered += amt;
    }
  } else if (diff < -0.2) {
    let tot = 0; for (let n = 0; n < NN; n++) tot += wVol[n];
    const rem = Math.min(-diff, 460 * dt, tot);
    if (tot > 1e-6) { const s = (tot - rem) / tot; for (let n = 0; n < NN; n++) wVol[n] *= s; }
    administered -= rem;
  }
  if (pylorusOpen) {
    const n = NMAIN - 1, d = Math.min(wVol[n], wVol[n] * 1.3 * dt);
    wVol[n] -= d; drained += d;
  }
}
function updateWet(dt) {
  const dry = 0.05 * dt;
  for (let n = 0; n < NN; n++) {
    const L = lvl[n], b = n * CM;
    for (let j = 0; j < CM; j++) {
      const idx = b + j;
      aLevel[idx] = L;
      if (hArr[idx] <= L) aWet[idx] = 1;
      else { const v = aWet[idx] - dry; aWet[idx] = v > 0 ? v : 0; }
    }
  }
  geom.attributes.aLevel.needsUpdate = true;
  geom.attributes.aWet.needsUpdate = true;
}
function buildSurface() {
  let p = 0, prev = null;
  for (let n = 0; n < NN; n++) {
    const c = cap[n], f = c > 1e-9 ? wVol[n] / c : 0;
    let cur = null;
    if (f > 0.004 && f < 0.996) {
      const L = lvl[n], b = n * CM; const hits = [];
      for (let j = 0; j < CM && hits.length < 2; j++) {
        const j2 = (j + 1) % CM, h1 = hArr[b + j], h2 = hArr[b + j2];
        if ((h1 - L) * (h2 - L) < 0) {
          const t = (L - h1) / (h2 - h1), k1 = (b + j) * 3, k2 = (b + j2) * 3;
          hits.push([pos[k1] + (pos[k2] - pos[k1]) * t, pos[k1 + 1] + (pos[k2 + 1] - pos[k1 + 1]) * t, pos[k1 + 2] + (pos[k2 + 2] - pos[k1 + 2]) * t]);
        }
      }
      if (hits.length === 2) cur = { a: hits[0], b: hits[1], n: n };
    }
    if (cur && prev && prev.n === n - 1 && n !== NMAIN) {
      const d1 = (cur.a[0] - prev.a[0]) ** 2 + (cur.a[1] - prev.a[1]) ** 2 + (cur.a[2] - prev.a[2]) ** 2;
      const d2 = (cur.a[0] - prev.b[0]) ** 2 + (cur.a[1] - prev.b[1]) ** 2 + (cur.a[2] - prev.b[2]) ** 2;
      if (d2 < d1) { const t = cur.a; cur.a = cur.b; cur.b = t; }
      const q = [prev.a, prev.b, cur.b, prev.a, cur.b, cur.a];
      for (let v = 0; v < 6; v++) { surfPos[p++] = q[v][0]; surfPos[p++] = q[v][1]; surfPos[p++] = q[v][2]; }
    }
    prev = cur;
  }
  surfGeom.attributes.position.needsUpdate = true;
  surfGeom.setDrawRange(0, p / 3);
}

/* ================= 組み立て ================= */
function rebuildAll() {
  rebuild();
  anatGroup.position.set(-anatOff[0], -anatOff[1], -anatOff[2]);
  geom.attributes.aRug.needsUpdate = true;
}
