"use strict";
/* ================= 状態 ================= */
let curType = 'bp3d', curMode = 0, curPose = 'stand';   // 既定は解剖モデル（BodyParts3D の胃。教科書の記載に合わせてある）
let pylorusOpen = false, labelMode = 1, showBone = true;
let autoSpin = false, viewMode = 1, skinOpacity = 0.30;
let airLevel = 0.6, targetMl = 150 / Math.pow(BODY_SCALE, 3), administered = 0;   // バリウム 150 mL（実寸。学会マニュアル）。targetMl は模型の単位
let gasMl = 250;   // 発泡剤のガス（実寸 mL）。添付文書の 100〜400 mL の真ん中。胃の大きさはバリウム＋ガスに合わせる（model.js の rebuild）
let compRegion = '', compAmt = 0;
let tiltCur = 90, rollCur = 0, tiltT = 90, rollT = 0;
let tiltV = 0;                              // 起倒の速さ（°/秒）
const TILT_MAX = 20, TILT_ACC = 40;        // 起倒の最高速度（°/秒）と加速度（°/秒²）。仮の値（実機の値とは照らし合わせていない）
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
   胃は噴門部と幽門部が緩く固定されているだけで、体位によって腹の中でねじれ、振れる（胃X線検診 上部消化管検査必携テキスト
   pp.90-94）。動きは教科書に書いてある 2 つだけにする（TEXTBOOK_CHECK.md「ねじれ」）。
     α：噴門と幽門を結ぶ線のまわりのねじれ（「大弯を腹側に捻る」p.90）。噴門と幽門は動かさず、間をねじる。
        ねじれの角度は、噴門より口側（胃底部・胃体上部）で α、そこから幽門に向かって直線的に減り、幽門で 0
     β：前後の軸（体の z）のまわりの、噴門を中心にした正面での振れ（「Ba の重みで尾側方向に引き伸ばされ」p.94）
   基準撮影法の体位ごとに、教科書の各体位の記載を満たす [α, β]（度）を twist に置く。ねじれのいらない体位も [0, 0] として置く。
   ほかの体位の値は、重力の向きの角度の差を距離にしたガウスの RBF 補間（幅 TWIST_SIG°）で求める。表の体位ではちょうど表の値になり、
   その間はなめらかにつながり、どの体位からも遠いときは 0 に近づく。食道は動かさない。 */
const TWIST_SIG = 20;
let twistBase = null, twistCur = [NaN, 0], twistRbf = null;
function upOf(tilt, roll) {   // 体の座標での上向き（upLocal と同じ。評価モードで確かめた式）
  const t = tilt * Math.PI / 180, r = roll * Math.PI / 180;
  return [-Math.sin(r) * Math.cos(t), Math.sin(t), Math.cos(r) * Math.cos(t)];
}
function angDeg(u, v) { return Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180 / Math.PI; }
function twistCoef(T) {   // RBF の係数 c を解く：Φ c = [α, β]
  const n = T.length, U = T.map(k => upOf(k.tilt, k.roll));
  const M = U.map(u => U.map(v => Math.exp(-0.5 * (angDeg(u, v) / TWIST_SIG) ** 2)));
  const C = [0, 1].map(d => {
    const A = M.map((row, i) => [...row, T[i].ab[d]]);
    for (let i = 0; i < n; i++) {   // ガウスの消去法（部分ピボット）
      let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]];
      for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i] / A[i][i]; for (let c = i; c <= n; c++) A[r][c] -= f * A[i][c]; }
    }
    return A.map((row, i) => row[n] / row[i]);
  });
  return { T, U, C };
}
function twistFor(tilt, roll) {
  const T = TYPES[curType].twist; if (!T || !T.length) return [0, 0];
  const sig = JSON.stringify(T.map(k => [k.tilt, k.roll, k.ab]));
  if (!twistRbf || twistRbf.sig !== sig) { twistRbf = twistCoef(T); twistRbf.sig = sig; }
  if (twistRbf.C.some(c => c.some(x => !Number.isFinite(x)))) return [0, 0];   // 解けない表（同じ重力の向きの体位が 2 つある等）はねじれなし
  const u = upOf(tilt, roll), r = [0, 0];
  twistRbf.U.forEach((v, i) => { const w = Math.exp(-0.5 * (angDeg(u, v) / TWIST_SIG) ** 2); r[0] += w * twistRbf.C[0][i]; r[1] += w * twistRbf.C[1][i]; });
  return r;
}
function twistSave() {
  twistBase = { pos: pos.slice(), centers: centers.slice(), fu: frameU.slice(), fv: frameV.slice() }; twistCur = [NaN, 0];
  twistBase.centers.set(escBase.c.subarray((ESO_JOIN - 1) * 3, ESO_JOIN * 3), (NN - 1) * 3);   // ねじれの中心（噴門）は、胃とつなぐ前の食道の下の端
  posTw = pos.slice(); centersTw = centers.slice(); sagS.fill(0); sagTgt.fill(0);
}
const _twq = new THREE.Quaternion(), _twb = new THREE.Quaternion(), _twv = new THREE.Vector3(), _twa = new THREE.Vector3(), _twz = new THREE.Vector3(0, 0, 1);
function applyTwist() {
  if (!twistBase) return;
  const ab = twistFor(tiltCur, rollCur);
  if (Math.abs(ab[0] - twistCur[0]) < 0.05 && Math.abs(ab[1] - twistCur[1]) < 0.05) return;
  twistCur = ab;
  const B = twistBase, e = (NN - 1) * 3, cx = B.centers[e], cy = B.centers[e + 1], cz = B.centers[e + 2];   // 噴門（食道の下端）
  const pi = pylIdx * 3;
  _twa.set(B.centers[pi] - cx, B.centers[pi + 1] - cy, B.centers[pi + 2] - cz).normalize();               // 噴門 → 幽門
  _twb.setFromAxisAngle(_twz, ab[1] * Math.PI / 180);
  for (let i = 0; i < NMAIN; i++) {
    const w = i <= cardiaIdx ? 1 : Math.max(0, (pylIdx - i) / Math.max(1, pylIdx - cardiaIdx));
    _twq.setFromAxisAngle(_twa, ab[0] * w * Math.PI / 180).premultiply(_twb);   // ねじってから振る
    const rot = (src, dst, k, piv) => {
      _twv.set(src[k] - (piv ? cx : 0), src[k + 1] - (piv ? cy : 0), src[k + 2] - (piv ? cz : 0)).applyQuaternion(_twq);
      dst[k] = _twv.x + (piv ? cx : 0); dst[k + 1] = _twv.y + (piv ? cy : 0); dst[k + 2] = _twv.z + (piv ? cz : 0);
    };
    for (let j = 0; j < CM; j++) rot(B.pos, posTw, (i * CM + j) * 3, true);
    rot(B.centers, centersTw, i * 3, true); rot(B.fu, frameU, i * 3, false); rot(B.fv, frameV, i * 3, false);
  }
  shapeApply();
}

/* ---- 体位による胃の形の変化（たわみ）----
   胃は噴門と幽門部で留まり、その間は柔らかい（胃X線検診 上部消化管検査必携テキスト p.90）。バリウムの溜まったところは
   重さで沈み（「Ba の重みで尾側方向に引き伸ばされ」p.94）、ガスの溜まったところはまわりの組織より軽いので浮く。
   胃の中心の線を、両端を留めた張力 T の弦と、まわりの組織へのつなぎ止め（ばね K）として、断面ごとの正味の重さ
     L_i = (ρ_Ba − ρ_組織) × バリウムの量_i − ρ_組織 × ガスの量_i     （ρ_Ba = 2.56、ρ_組織 = 1.0 g/mL。200 w/v% の懸濁液の密度）
   とつり合う重力の向きのずれ s_i を求める：T (2 s_i − s_{i−1} − s_{i+1}) + K s_i = L_i。
   留めるのは噴門の断面と、幽門より先（十二指腸）。胃底部の側の端は自由。
   形は時定数 SHAPE.tau 秒で、つり合いの形に近づく（バリウムが流れると重さの分布が変わり、形も変わる）。 */
const SHAPE = { on: false, T: 40, K: 2, tau: 0.5, rhoBa: 2.56, rhoT: 1.0 };
let posTw = null, centersTw = null;
const sagS = new Float64Array(NMAIN), sagTgt = new Float64Array(NMAIN);
const _sa = new Float64Array(NMAIN), _sb = new Float64Array(NMAIN), _sc = new Float64Array(NMAIN), _sd = new Float64Array(NMAIN);
function shapeTarget() {
  const P = TYPES[curType].shape || SHAPE, T = P.T, K = P.K;
  for (let i = 0; i < NMAIN; i++) {
    const fixed = i === cardiaIdx || i >= pylIdx;
    if (fixed) { _sa[i] = 0; _sb[i] = 1; _sc[i] = 0; _sd[i] = 0; continue; }
    const L = (SHAPE.rhoBa - SHAPE.rhoT) * wVol[i] - SHAPE.rhoT * Math.max(0, cap[i] - wVol[i]);
    _sa[i] = i > 0 ? -T : 0; _sc[i] = i < NMAIN - 1 ? -T : 0;
    _sb[i] = (i > 0 ? T : 0) + (i < NMAIN - 1 ? T : 0) + K; _sd[i] = L;
  }
  for (let i = 1; i < NMAIN; i++) { const m = _sa[i] / _sb[i - 1]; _sb[i] -= m * _sc[i - 1]; _sd[i] -= m * _sd[i - 1]; }   // 三重対角（Thomas 法）
  sagTgt[NMAIN - 1] = _sd[NMAIN - 1] / _sb[NMAIN - 1];
  for (let i = NMAIN - 2; i >= 0; i--) sagTgt[i] = (_sd[i] - _sc[i] * sagTgt[i + 1]) / _sb[i];
}
function shapeStep(dt) {
  if (!posTw) return;
  const P = TYPES[curType].shape || SHAPE;
  if (!(P.on ?? SHAPE.on)) return;
  shapeTarget();
  const a = Math.min(1, dt / (P.tau || SHAPE.tau));
  let mx = 0;
  for (let i = 0; i < NMAIN; i++) { const d = (sagTgt[i] - sagS[i]) * a; sagS[i] += d; mx = Math.max(mx, Math.abs(d)); }
  if (mx > 1e-4) shapeApply();
}
function shapeApply() {   // 位置 = ねじったあとの位置 − s_i × 上向き（s が正なら下へ）
  if (!posTw) return;
  const u = uUp.value, ux = u.x, uy = u.y, uz = u.z;
  for (let i = 0; i < NMAIN; i++) {
    const s = sagS[i], dx = -s * ux, dy = -s * uy, dz = -s * uz, c = i * 3;
    centers[c] = centersTw[c] + dx; centers[c + 1] = centersTw[c + 1] + dy; centers[c + 2] = centersTw[c + 2] + dz;
    for (let j = 0; j < CM; j++) { const k = (i * CM + j) * 3; pos[k] = posTw[k] + dx; pos[k + 1] = posTw[k + 1] + dy; pos[k + 2] = posTw[k + 2] + dz; }
  }
  joinEsophagus();   // 胃が動いたので、食道の下の端を胃の壁までつなぎ直す（model.js）
  geom.attributes.position.needsUpdate = true;
  geom.computeVertexNormals();
}
function upLocal(out) {
  qA.copy(qWorldBody).invert();
  return out.set(0, 1, 0).applyQuaternion(qA);
}
function goPose(t, r) {
  if (typeof rotStop === 'function') rotStop();   // 回転法（学習）の途中でほかの体位を選んだら、回転をやめる
  tiltT = t;
  rollT = rollCur + (((r - rollCur) % 360 + 540) % 360 - 180);
}
const ROLLN = [[0, '正面位'], [45, '第1斜位'], [90, '左側臥位'], [135, '腹臥位第2斜位'],
               [180, '腹臥位正面位'], [225, '腹臥位第1斜位'], [270, '右側臥位'], [315, '第2斜位']];
//  第1斜位＝右前斜位（RAO）。背臥位では右側挙上、腹臥位では左側挙上で、
//  同じ斜位面を後壁側／前壁側から見ることになる。第2斜位はその逆。
function poseName(tilt, roll) {
  const r = ((roll % 360) + 360) % 360;
  let best = ROLLN[0], bd = 999;
  for (const e of ROLLN) { const d = Math.min(Math.abs(r - e[0]), 360 - Math.abs(r - e[0])); if (d < bd) { bd = d; best = e; } }
  // 台の角度の呼び方：立位 60〜90°、半立位 30〜60°、半臥位 1〜30°（必携テキスト p.76、高橋伸之「胃癌死をなくすために」の基準撮影法の定義）。
  // 0° 前後は水平（背臥位・腹臥位）、マイナスは頭低位（逆傾斜）
  const tl = tilt >= 60 ? '立位' : tilt >= 30 ? '半立位' : tilt >= 0.5 ? '半臥位' : tilt > -0.5 ? '水平' : '頭低位';
  if (best[1] === '正面位' || best[1] === '第1斜位' || best[1] === '第2斜位')
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
/* 噴門から胃へ入るバリウム（飲んでいる間だけ）：食道の出口から、胃の壁（管の網目の点）をいちばん急な下り坂に沿ってたどり、
   液面（すでに溜まったバリウム）か、それ以上下れない点に着いたら止まる。着いた断面にバリウムを入れる（pourInto）。
   たどった道は、流れている間は壁に沿った白い帯として描き（updatePour）、そのあとは付着した跡として残る（drawPourTrail）。
   胃を輪切りの管で表しているので、噴門の輪は胃の幅いっぱいに広がり、輪の底がすでに液だまりの中にあることが多い。
   断面の単位でたどると噴門＝液だまりになり、道すじが見えず、液だまりが何もないところから湧いて見えていた。
   食道が空になれば（飲み終われば）何もしない。そのあとは噴門は閉じていて（逆流しない）、いつもの流れ（flowStep）だけになる */
const pour = { n: 0, trail: [] };
let pourFlow = 0;   // 噴門から入っている量（模型の mL/秒）
const isStomach = n => n >= 0 && n < NMAIN && regionList[regionOf[n]][0] !== 'duode';
function pourTarget() {
  // 出発点：食道の下端の中心にいちばん近い、胃の壁の点
  let x = 0, y = 0, z = 0; const eb = (NN - 1) * CM;
  for (let j = 0; j < CM; j++) { const k = (eb + j) * 3; x += pos[k]; y += pos[k + 1]; z += pos[k + 2]; }
  x /= CM; y /= CM; z /= CM;
  let v = -1, bd = 1e9;
  for (let n = 0; n < NMAIN; n++) {
    if (!isStomach(n)) continue;
    for (let j = 0; j < CM; j++) {
      const k = (n * CM + j) * 3, d = (pos[k] - x) ** 2 + (pos[k + 1] - y) ** 2 + (pos[k + 2] - z) ** 2;
      if (d < bd) { bd = d; v = n * CM + j; }
    }
  }
  const trail = [v];
  for (let s = 0; s < 600; s++) {
    const n = Math.floor(v / CM), j = v % CM;
    if (hArr[v] <= lvl[n]) break;   // 液面に着いた
    let best = -1, bh = hArr[v];
    for (const [m, jj] of [[n, (j + 1) % CM], [n, (j + CM - 1) % CM], [n - 1, j], [n + 1, j], [n - 1, (j + 1) % CM], [n - 1, (j + CM - 1) % CM], [n + 1, (j + 1) % CM], [n + 1, (j + CM - 1) % CM]]) {
      if (!isStomach(m)) continue;
      const w = m * CM + jj;
      if (hArr[w] < bh) { bh = hArr[w]; best = w; }
    }
    if (best < 0) break;   // これ以上下れない（ここから溜まり始める）
    v = best; trail.push(v);
  }
  pour.trail = trail; pour.n = Math.floor(v / CM);
}
/* 着いた先が液だまりなら、つながっている液だまり（液面のある断面の続き）全体に、液面が同じだけ上がるよう分けて入れる。
   1 つの断面だけに入れると、そこだけ液面が盛り上がり、湧き上がるように見えるため。
   分け方は、断面の液面 1 単位あたりの容積（容量 ÷ 高さの幅）に比例させる（近似） */
function pourInto(amt, dt) {
  if (!(amt > 0)) return;
  const t = pour.n, set = [];
  if (lvl[t] >= hmin[t]) {
    for (const dir of [-1, 1]) for (let n = dir < 0 ? t : t + 1; n >= 0 && n < NMAIN; n += dir) {
      if (regionList[regionOf[n]][0] === 'duode' || lvl[n] < hmin[n]) break;
      set.push(n);
    }
  } else set.push(t);
  let wsum = 0; const w = set.map(n => { const v = wVol[n] < cap[n] ? cap[n] / Math.max(1e-3, hmax[n] - hmin[n]) : 0; wsum += v; return v; });
  if (!(wsum > 0)) return;
  let done = 0;
  set.forEach((n, k) => { const d = Math.min(amt * w[k] / wsum, cap[n] - wVol[n]); if (d > 0) { wVol[n] += d; done += d; } });
  wVol[NN - 1] -= done; pourFlow = done / dt;
}
/* 流れた跡にはバリウムが付く（付着）。流れている間の見た目は updatePour の帯で描く */
function drawPourTrail() {
  if (!(pourFlow > 0.05)) return;
  for (const v of pour.trail) { subT[v] = 1; prevS[v] = 0; }   // 流れ込むバリウムが通った壁：次の刻みで膜が残る（updateWet）
}
/* 流れている間：たどった道をならし（前後 4 点の平均）、胃の壁の少し内側に、壁に沿った細い帯として描く。
   網目の点を塗ると、網目が粗いので階段やギザギザに見えたため */
const _pp = [], _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _pt = new THREE.Vector3(), _pn = new THREE.Vector3(), _px = new THREE.Vector3();
function updatePour() {
  const tr = pour.trail, on = pourFlow > 0.05 && tr.length >= 3;
  pourMesh.visible = on;
  if (!on) return;
  const N = Math.min(tr.length, POUR_MAX), P = pourGeom.attributes.position.array;
  while (_pp.length < N) _pp.push(new THREE.Vector3());
  for (let i = 0; i < N; i++) {   // ならした道。壁から胃の中心のほうへ少し離す
    _pa.set(0, 0, 0); let c = 0;
    for (let k = Math.max(0, i - 4); k <= Math.min(N - 1, i + 4); k++) { const q = tr[k] * 3; _pa.x += pos[q]; _pa.y += pos[q + 1]; _pa.z += pos[q + 2]; c++; }
    _pa.multiplyScalar(1 / c);
    const n = Math.floor(tr[i] / CM) * 3;
    _pn.set(centers[n] - _pa.x, centers[n + 1] - _pa.y, centers[n + 2] - _pa.z).normalize();
    _pp[i].copy(_pa).addScaledVector(_pn, 0.06);
  }
  const w = Math.min(0.45, 0.15 + 0.04 * pourFlow) / 2;
  for (let i = 0; i < N; i++) {
    _pa.copy(_pp[Math.max(0, i - 1)]); _pb.copy(_pp[Math.min(N - 1, i + 1)]);
    _pt.subVectors(_pb, _pa).normalize();
    const n = Math.floor(tr[i] / CM) * 3;
    _pn.set(centers[n] - _pp[i].x, centers[n + 1] - _pp[i].y, centers[n + 2] - _pp[i].z).normalize();   // 壁から内向き
    _px.crossVectors(_pt, _pn).normalize().multiplyScalar(w * (i === N - 1 ? 1.6 : 1));
    P[i * 6] = _pp[i].x + _px.x; P[i * 6 + 1] = _pp[i].y + _px.y; P[i * 6 + 2] = _pp[i].z + _px.z;
    P[i * 6 + 3] = _pp[i].x - _px.x; P[i * 6 + 4] = _pp[i].y - _px.y; P[i * 6 + 5] = _pp[i].z - _px.z;
  }
  pourGeom.setDrawRange(0, (N - 1) * 6);
  pourGeom.attributes.position.needsUpdate = true;
  pourGeom.computeBoundingSphere();
}
const ESO_PUSH = 12;     // 食道の各断面の中身を毎秒この割合で胃側へ送る。26 断面を約 2 秒で通る。仮の値（実測と照合していない）
const DRINK = 12 / Math.pow(BODY_SCALE, 3);   // 飲む速さ（実寸 12 mL/秒、150 mL を約 12 秒で飲む）。仮の値（実測と照合していない）
function dose(dt) {
  const diff = targetMl - administered;
  if (diff > 0.2) {
    let free = 0;
    for (let n = NMAIN; n < NMAIN + 6; n++) free += Math.max(0, cap[n] - wVol[n]);
    if (free > 1e-4) {
      const amt = Math.min(diff, DRINK * dt, free);
      for (let n = NMAIN; n < NMAIN + 6; n++) wVol[n] += amt * Math.max(0, cap[n] - wVol[n]) / free;
      administered += amt;
    }
  } else if (diff < -0.2) {
    let tot = 0; for (let n = 0; n < NN; n++) tot += wVol[n];
    const rem = Math.min(-diff, 460 * dt, tot);
    if (tot > 1e-6) { const s = (tot - rem) / tot; for (let n = 0; n < NN; n++) wVol[n] *= s; }
    administered -= rem;
  }
  // 食道の蠕動：食道に残ったバリウムは、体の向きによらず胃へ送る（毎秒およそ ESO_PUSH の割合）。
  // 下部食道括約筋（model.js の流路）で胃から食道へは戻らないので、水平や頭低位でも食道にバリウムは残らない
  pourFlow = 0;
  if (wVol[NN - 1] > 1e-6) { pourTarget(); pourInto(Math.min(wVol[NN - 1] * ESO_PUSH * dt, wVol[NN - 1]), dt); }
  for (let n = NN - 2; n >= NMAIN; n--) {
    const d = Math.min(wVol[n] * ESO_PUSH * dt, Math.max(0, cap[n + 1] - wVol[n + 1]));
    if (d > 0) { wVol[n] -= d; wVol[n + 1] += d; }
  }
  if (pylorusOpen) {
    const n = NMAIN - 1, d = Math.min(wVol[n], wVol[n] * 1.3 * dt);
    wVol[n] -= d; drained += d;
  }
}
/* ================= バリウムの付着（壁に残る膜） =================
   液面が下がって壁が出ると、壁にバリウムの薄い膜が残る。膜は重力で流れ落ちて薄くなり、
   バリウムの「降伏値」（これより弱い力では流れない強さ）で止まる。粘液が残っている壁では膜が滑って落ちやすい。

   使う物性（画面の「バリウムの性質」で変えられる）
   - 濃度 C（w/v%）：100 mL の中の硫酸バリウムの g 数。添付文書（バリトップHD）は胃の二重造影で 200〜240 w/v%、
     学会マニュアル 2025［A］は 200 w/v% 以上を 150 mL 前後
   - 粘度 μ（mPa·s）と降伏値 τy（Pa）：特許 JP3717007B2 の高濃度製剤（260〜290 w/v%）で 見掛け粘度 70〜250 cP、
     降伏値 1.5〜6.6 dyne/cm²（0.15〜0.66 Pa）、24 ℃。注腸用の製剤では 200 w/v% で 135 mPa·s という報告もある（日本放射線技術学会雑誌 54 巻 4 号）。
     製剤ごとに大きく違い、200〜240 w/v% の胃用製剤の値は見つからなかったので、初めの値は 100 mPa·s・0.4 Pa とした（仮）
   - 密度：硫酸バリウム 4.50 g/cm³ と水から計算（C = 200 なら 2.56 g/mL）
   - X 線の吸収：硫酸バリウムの質量減弱係数を、透視の実効エネルギーを 50 keV と仮定して 8.2 cm²/g
     （NIST の表で Ba 13.79、S と O は小さいので重さの割合で足した）。膜 1 枚の光学的な厚み od = 8.2 × (C/100) × 厚み(cm)

   膜の式（流体力学の教科書的な式。どれも実測とは照合していない）
   - 残る厚み（液面が速さ U で下がるとき。Landau–Levich）：h0 = 0.94 (μU)^(2/3) / (σ^(1/6) (ρg)^(1/2))、表面張力 σ = 0.07 N/m（水と同じと仮定）
   - 流れ落ち（壁に沿った重力 g_t。Jeffreys の膜の流れ落ちに、ビンガム流体の降伏値を入れた形）：
       dh/dt = −(3/2) q / X、q = ρ g_t h³ /(3μ) × (1 − 1.5 r + 0.5 r³) × (1 + 3b/h)、r = hy/h、hy = τy /(ρ g_t)
     X は膜が流れ下る長さ（3 cm と仮定）。b は粘液による滑り（滑り長さ）
   - 天井側の壁（膜がぶら下がる）：ρ g_n h が τy を超えると、垂れて落ちる（薄い膜のレイリー・テイラー不安定の成長率 h³(ρ g_n)²/(12μσ)）
   - 粘液：初めは粘液で膜が滑る（滑り長さ 200 µm と仮定）。バリウムが壁の上を通るたびに粘液が取れて、付きがよくなる
     （「ローリングごとに粘液が除かれる」は特許 JP3717007B2 の記載。取れる割合は仮に 1 回で 40 %）
*/
const BA = { C: 200, mu: 100, ty: 0.4 };      // 濃度 w/v%、粘度 mPa·s、降伏値 Pa
const BA_MUM = 8.2, BA_SIG = 0.07, BA_X = 0.03, BA_SLIP = 200e-6, BA_WASH = 0.4, G0 = 9.8;
const BA_FOLD = 0.01;                          // ひだの間の溝に、膜より多くたまるバリウムの厚み（cm）。溝の深さ・形の資料がないので仮に 0.1 mm
const UNIT_M = 0.012;                          // 模型の長さ 1 ＝ 1.2 cm（BODY_SCALE）
const OD_FULL = BA_MUM * 2.0 * 50e-4;          // aWet ＝ 1 にあたる膜（200 w/v%、50 µm）の od。評価・表示のしきい値はこの割合
const filmH = new Float32Array(NV);            // 膜の厚さ（m）
const mucus = new Float32Array(NV).fill(1);    // 粘液の残り（1 ＝ 全部、0 ＝ 取れた）
const subT = new Float32Array(NV);             // 液面の下にいた時間（秒）
const prevS = new Float32Array(NV);            // 前の刻みの、液面からの高さ（模型の長さ）
function baRho() { const c = BA.C / 100; return (c + (1 - c / 4.5)) * 1000; }   // kg/m³
function updateWet(dt) {
  const nrm = geom.attributes.normal.array, u = uUp.value;
  const rho = baRho(), mu = BA.mu * 1e-3, c = BA.C / 100, ODk = BA_MUM * c * 100;   // od ＝ ODk × h(m)
  uGroove.value = BA_MUM * c * BA_FOLD;
  for (let n = 0; n < NN; n++) {
    const L = lvl[n], b = n * CM;
    for (let j = 0; j < CM; j++) {
      const idx = b + j, s = hArr[idx] - L;
      aLevel[idx] = L;
      if (s <= 0) {                                   // 液面の下：バリウムの中
        subT[idx] += dt;
        filmH[idx] = 0; aFilm[idx] = 0; aWet[idx] = 1; prevS[idx] = s;
        continue;
      }
      if (prevS[idx] <= 0 && subT[idx] > 0) {         // いま液面から出た：膜が残る
        const U = Math.min(0.2, Math.max(0.002, (s - prevS[idx]) * UNIT_M / Math.max(dt, 1e-3)));
        filmH[idx] = 0.94 * Math.pow(mu * U, 2 / 3) / (Math.pow(BA_SIG, 1 / 6) * Math.sqrt(rho * G0));
        if (subT[idx] > 0.3) mucus[idx] *= 1 - BA_WASH;   // バリウムが上を通ったので、粘液が少し取れる
        subT[idx] = 0;
      }
      prevS[idx] = s;
      let h = filmH[idx];
      if (h > 0) {
        const un = nrm[idx * 3] * u.x + nrm[idx * 3 + 1] * u.y + nrm[idx * 3 + 2] * u.z;   // 外向きの法線と上向き（1 ＝ 天井側）
        const gt = G0 * Math.sqrt(Math.max(0, 1 - un * un)), gn = G0 * Math.max(0, un);
        const ty = BA.ty, bslip = BA_SLIP * mucus[idx];
        // 壁に沿って流れ落ちる
        if (gt > 1e-3) {
          const hy = ty / (rho * gt), r = Math.min(1, hy / h);
          const q = rho * gt * h * h * h / (3 * mu) * (1 - 1.5 * r + 0.5 * r * r * r) * (1 + 3 * bslip / h);
          h -= 1.5 * q / BA_X * dt;
        }
        // 天井側：重さが降伏値を超えると垂れ落ちる
        if (gn > 1e-3 && h > 0 && rho * gn * h > ty * (1 - mucus[idx] * 0.9)) {
          const k = h * h * h * (rho * gn) * (rho * gn) / (12 * mu * BA_SIG);
          h -= h * Math.min(1, k * dt);
        }
        h = Math.max(0, h);
        filmH[idx] = h;
      }
      const od = ODk * h;
      aFilm[idx] = od;
      aWet[idx] = Math.min(1, od / OD_FULL);
    }
  }
  geom.attributes.aLevel.needsUpdate = true;
  geom.attributes.aWet.needsUpdate = true;
  geom.attributes.aFilm.needsUpdate = true;
}
// 壁全体を「いまバリウムの中から出たところ」にする（settle やバリウムを入れ直したとき）
//   on(i)：その輪（断面 i）に膜を付けるか。washed：粘液がどれだけ取れたことにするか（1 ＝ 全部残る）
function resetFilm(on, muc) {
  const rho = baRho(), mu = BA.mu * 1e-3, ODk = BA_MUM * BA.C / 100 * 100;
  const h0 = 0.94 * Math.pow(mu * 0.02, 2 / 3) / (Math.pow(BA_SIG, 1 / 6) * Math.sqrt(rho * G0));   // 液面が 2 cm/秒で下がったときの膜
  mucus.fill(muc); subT.fill(0); prevS.fill(1);
  for (let i = 0; i < NN; i++) for (let j = 0; j < CM; j++) {
    const v = i * CM + j, h = on(i) ? h0 : 0;
    filmH[v] = h; aFilm[v] = ODk * h; aWet[v] = Math.min(1, aFilm[v] / OD_FULL);
  }
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
  // 食道の下の端は、胃とつなぐ前のもとの位置（model.js の escBase）を使う（つなぐ処理で体の位置が変わらないように）
  const e = (ESO_JOIN - 1) * 3, c = BP3D.meta.cardia;
  _fit.set(escBase.c[e] - c[0], escBase.c[e + 1] - c[1], escBase.c[e + 2] - c[2]);
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

/* ---- 圧迫 ----
   胃の形は model.js の applyCompression でつぶす（圧迫筒の円の中の前の壁を、X 線管の向きに後ろの壁へ押し込む）。
   入りきらなくなったバリウムは隣の断面へあふれ、そこから重力で流れる（model.js の spillExcess と flowStep）。
   透視像の白さは X 線が通るバリウムの厚みで決まるので（updateThickness）、つぶれて薄くなった所は自然に薄く写る。
   ここでは X 線管の向きを胃の座標で求め（setCompAxis）、3D の圧迫筒を押す場所の真上へ動かしてお腹に押し当てる（updateCompress） */
const _cw = new THREE.Vector3(), _co = new THREE.Vector3(), _cd = new THREE.Vector3(), _ray = new THREE.Raycaster(), _qi = new THREE.Quaternion();
let compAxisRoll = 0;
function setCompAxis() {   // X 線管の側（台の +y）を、胃の座標（bodyGroup の中）で表す
  _qi.copy(bodyGroup.quaternion).invert();
  _cd.set(0, 1, 0).applyQuaternion(_qi);
  compAxis = [_cd.x, _cd.y, _cd.z]; compAxisRoll = rollCur;
}
function updateCompress() {
  const on = compAmt > 0.01 && compMid >= 0 && compRegion;
  if (!on) {
    if (compCone) { compCone.position.set(0, COMP_HOME, 0); compRod.visible = false; }
    return;
  }
  // 圧迫したまま体を回したら、押す向きが変わるので作り直す
  if (Math.abs(rollCur - compAxisRoll) > 3 && Math.abs(rollCur - rollT) < 0.5) { setCompAxis(); rebuildAll(); }
  const c = compMid * 3;
  if (!compCone) return;
  // 圧迫の中心を台（tiltGroup）の座標へ
  bodyGroup.updateMatrixWorld(true);
  _cw.set(centers[c], centers[c + 1], centers[c + 2]).applyMatrix4(bodyGroup.matrixWorld);
  tiltGroup.worldToLocal(_cw);
  // X 線管の側から、台の法線（−y）に沿ってお腹の表面を探す
  _co.set(_cw.x, COMP_TOP, _cw.z); tiltGroup.localToWorld(_co);
  _cd.set(0, -1, 0).applyQuaternion(tiltGroup.quaternion);
  _ray.set(_co, _cd); _ray.far = 400;
  meshSkin.updateMatrixWorld(true);
  const hit = _ray.intersectObject(meshSkin, false)[0];
  let bottom;
  if (hit) { const h = tiltGroup.worldToLocal(hit.point.clone()); bottom = h.y - 4 * compAmt; }
  else bottom = _cw.y + 8;   // 体の表面が見つからないとき（念のため）：胃の中心の 8 cm 上
  compCone.position.set(_cw.x, bottom + 5, _cw.z);
  const top = COMP_TOP, len = Math.max(0.5, top - (bottom + 10));
  compRod.visible = true; compRod.position.set(_cw.x, bottom + 10 + len / 2, _cw.z); compRod.scale.set(1, len, 1);
}
/* ---- X 線が通るバリウムの厚み ----
   頂点ごとに、その頂点を通る X 線（X 線管の向き）が、その断面の中でバリウムを通る長さを求める（aThick）。
   断面の輪（多角形）と、X 線を断面の平面に写した直線との交わりから、管の中を通る区間を出し、そのうち液面より下の部分の長さをとる。
   X 線が断面に斜めに入るときは、その分だけ長くする（3 倍まで）。透視像の白さはこの長さで決まる（scene.js の FRAG_XRAY） */
const _bd = new THREE.Vector3();
function updateThickness() {
  _qi.copy(bodyGroup.quaternion).invert();
  _bd.set(0, 1, 0).applyQuaternion(_qi);   // X 線の向き（胃の座標）
  const bx = _bd.x, by = _bd.y, bz = _bd.z, u = uUp.value;
  const pu = new Float64Array(CM), pv = new Float64Array(CM);
  for (let i = 0; i < NN; i++) {
    const c = i * 3, Ux = frameU[c], Uy = frameU[c + 1], Uz = frameU[c + 2], Vx = frameV[c], Vy = frameV[c + 1], Vz = frameV[c + 2];
    const eu0 = bx * Ux + by * Uy + bz * Uz, ev0 = bx * Vx + by * Vy + bz * Vz, n = Math.hypot(eu0, ev0);
    const b = i * CM;
    if (n < 0.2) { for (let j = 0; j < CM; j++) aThick[b + j] = 10; continue; }   // X 線が管の向きとほぼ同じ：厚いとみなす
    const eu = eu0 / n, ev = ev0 / n, stretch = Math.min(3, 1 / n);
    // 断面の高さ（上向き）を U・V で表した傾き。液面の高さ lvl[i] との比較に使う
    const hu = u.x * Ux + u.y * Uy + u.z * Uz, hv = u.x * Vx + u.y * Vy + u.z * Vz;
    const hc = centers[c] * u.x + centers[c + 1] * u.y + centers[c + 2] * u.z, L = lvl[i] - hc;
    for (let j = 0; j < CM; j++) {
      const k = (b + j) * 3, dx = pos[k] - centers[c], dy = pos[k + 1] - centers[c + 1], dz = pos[k + 2] - centers[c + 2];
      pu[j] = dx * Ux + dy * Uy + dz * Uz; pv[j] = dx * Vx + dy * Vy + dz * Vz;
    }
    for (let j = 0; j < CM; j++) {
      // 頂点 j を通り向き (eu, ev) の直線と、輪の辺との交わり（直線上の位置 t）の最小と最大
      const qu = pu[j], qv = pv[j];
      let t0 = 0, t1 = 0;
      for (let e = 0; e < CM; e++) {
        const e2 = (e + 1) % CM, au = pu[e] - qu, av = pv[e] - qv, du = pu[e2] - pu[e], dv = pv[e2] - pv[e];
        const den = eu * dv - ev * du;
        if (Math.abs(den) < 1e-9) continue;
        const s = (au * ev - av * eu) / den;   // 辺の上の位置（0〜1）
        if (s < 0 || s > 1) continue;
        const t = (au * dv - av * du) / den;    // 直線の上の位置
        if (t < t0) t0 = t; if (t > t1) t1 = t;
      }
      // 区間 [t0, t1] のうち、液面（高さ L、断面の中心から）より下の長さ
      const h0 = (qu + eu * t0) * hu + (qv + ev * t0) * hv, h1 = (qu + eu * t1) * hu + (qv + ev * t1) * hv;
      let len = t1 - t0;
      if (Math.abs(h1 - h0) > 1e-6) {
        const ta = (L - h0) / (h1 - h0);   // 液面と交わる位置（0〜1）
        const fb = h0 < h1 ? Math.max(0, Math.min(1, ta)) : 1 - Math.max(0, Math.min(1, ta));
        len *= fb;
      } else if (h0 > L) len = 0;
      aThick[b + j] = len * stretch;
    }
  }
  geom.attributes.aThick.needsUpdate = true;
}
