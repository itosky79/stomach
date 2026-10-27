"use strict";
/* ================= 状態 ================= */
let curType = 'bp3d', curMode = 0, curPose = 'stand';   // 既定は解剖モデル（BodyParts3D の胃。教科書の記載に合わせてある）
let pylorusOpen = false, labelMode = 1, showBone = true;
let showOri = true;
let autoSpin = false, viewMode = 1, skinOpacity = 0.30;
let airLevel = 0.6, targetMl = 150 / Math.pow(BODY_SCALE, 3), administered = 0;   // バリウム 150 mL（実寸。学会マニュアル）。targetMl は模型の単位
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
  applyTwist();
}
/* ---- 体位による胃のねじれ（TYPES[型].twist）----
   胃は噴門と十二指腸で緩く留まっているだけで、体位によって腹の中で回り、ねじれる（胃X線検診 上部消化管検査必携テキスト
   pp.90-94）。教科書の各体位の記載（チェック項目）どおりのバリウムの位置になるよう、基準撮影法の体位ごとに胃の向き
   （噴門を中心にした回転。体の座標の x 左・y 頭側・z 腹側のまわりの角度、度）を決めて twist に置く（TEXTBOOK_CHECK.md）。
   ほかの体位では、重力の向きが近い体位の値をガウスの重み（σ = TWIST_SIG°）で混ぜ、どの体位からも遠いときは 0 に近づける。
   食道は回さない（噴門の位置は変わらない）。 */
const TWIST_SIG = 8, TWIST_W0 = 0.02;
let twistBase = null, twistCur = [NaN, 0, 0];
function upOf(tilt, roll) {   // 体の座標での上向き（upLocal と同じ。評価モードで確かめた式）
  const t = tilt * Math.PI / 180, r = roll * Math.PI / 180;
  return [-Math.sin(r) * Math.cos(t), Math.sin(t), Math.cos(r) * Math.cos(t)];
}
function twistFor(tilt, roll) {
  const T = TYPES[curType].twist; if (!T || !T.length) return [0, 0, 0];
  const u = upOf(tilt, roll); let ws = TWIST_W0; const r = [0, 0, 0];
  for (const k of T) {
    const v = upOf(k.tilt, k.roll), c = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
    const a = Math.acos(c) * 180 / Math.PI, w = Math.exp(-0.5 * (a / TWIST_SIG) ** 2);
    ws += w; r[0] += w * k.rot[0]; r[1] += w * k.rot[1]; r[2] += w * k.rot[2];
  }
  return r.map(x => x / ws);
}
function twistSave() { twistBase = { pos: pos.slice(), centers: centers.slice(), fu: frameU.slice(), fv: frameV.slice() }; twistCur = [NaN, 0, 0]; }
const _twq = new THREE.Quaternion(), _twv = new THREE.Vector3(), _twa = new THREE.Vector3();
function applyTwist() {
  if (!twistBase) return;
  const rv = twistFor(tiltCur, rollCur);
  if (Math.abs(rv[0] - twistCur[0]) < 0.05 && Math.abs(rv[1] - twistCur[1]) < 0.05 && Math.abs(rv[2] - twistCur[2]) < 0.05) return;
  twistCur = rv;
  const ang = Math.hypot(rv[0], rv[1], rv[2]) * Math.PI / 180;
  if (ang < 1e-6) _twq.identity(); else _twq.setFromAxisAngle(_twa.set(rv[0], rv[1], rv[2]).normalize(), ang);
  const B = twistBase, e = (NN - 1) * 3, cx = B.centers[e], cy = B.centers[e + 1], cz = B.centers[e + 2];   // 噴門（食道の下端）
  const rot = (src, dst, k, piv) => {
    _twv.set(src[k] - (piv ? cx : 0), src[k + 1] - (piv ? cy : 0), src[k + 2] - (piv ? cz : 0)).applyQuaternion(_twq);
    dst[k] = _twv.x + (piv ? cx : 0); dst[k + 1] = _twv.y + (piv ? cy : 0); dst[k + 2] = _twv.z + (piv ? cz : 0);
  };
  for (let i = 0; i < NMAIN * CM; i++) rot(B.pos, pos, i * 3, true);
  for (let i = 0; i < NMAIN; i++) { rot(B.centers, centers, i * 3, true); rot(B.fu, frameU, i * 3, false); rot(B.fv, frameV, i * 3, false); }
  geom.attributes.position.needsUpdate = true;
  geom.computeVertexNormals();
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
/* 胃の型ごとに、BodyParts3D の体を噴門で胃に重ねる。噴門は横隔膜の食道裂孔のところで位置が決まっていて、
   胃の残りの部分はそこから垂れ下がる形になるので、型による胃の形の違いを噴門を基準にして体に置く。
   型の噴門は、食道の管の下端（胃につながるところ）の中心。体を動かした分だけ天板と足台も置き直す。 */
const _fit = new THREE.Vector3();
function fitBodyToStomach() {
  const e = (NN - 1) * 3, c = BP3D.meta.cardia;
  _fit.set(centers[e] - c[0], centers[e + 1] - c[1], centers[e + 2] - c[2]);
  bodyFit.position.copy(_fit);
  setTableToBody(_fit);
}
function rebuildAll() {
  rebuild();
  fitBodyToStomach();
  anatGroup.position.set(-anatOff[0], -anatOff[1], -anatOff[2]);
  geom.attributes.aRug.needsUpdate = true;
  twistSave(); applyTwist();
}
