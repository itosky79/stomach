"use strict";
/* ================= 定数 ================= */
const CM = 28;                 // 断面あたりの頂点数
const NMAIN = 170, NESO = 26;  // 断面数（胃＋十二指腸 / 食道）
const NN = NMAIN + NESO, NV = NN * CM;
const FLAT = 0.78;             // 前後方向の扁平率
const SUB = 8;                 // 流体ソルバのサブステップ

/* ================= 円形断面の充填率⇔水位 逆変換表 ================= */
const INVN = 512, INV = new Float32Array(INVN + 1);
for (let q = 0; q <= INVN; q++) {
  const target = q / INVN; let lo = 0, hi = 1;
  for (let it = 0; it < 26; it++) {
    const mid = (lo + hi) / 2, s = 2 * mid - 1;
    const f = (Math.PI / 2 + Math.asin(Math.max(-1, Math.min(1, s))) + s * Math.sqrt(Math.max(0, 1 - s * s))) / Math.PI;
    if (f < target) lo = mid; else hi = mid;
  }
  INV[q] = (lo + hi) / 2;
}
function invFrac(f) {
  if (f <= 0) return 0; if (f >= 1) return 1;
  const x = f * INVN, i = x | 0, t = x - i;
  return INV[i] * (1 - t) + INV[Math.min(INVN, i + 1)] * t;
}
function cr1(a, x) {                       // 1次元 Catmull-Rom
  const n = a.length, i = Math.floor(x), f = x - i;
  const p0 = a[Math.max(0, i - 1)], p1 = a[Math.min(n - 1, i)],
        p2 = a[Math.min(n - 1, i + 1)], p3 = a[Math.min(n - 1, i + 2)];
  return 0.5 * (2 * p1 + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

/* ================= モデル用バッファ ================= */
const pos = new Float32Array(NV * 3), nor = new Float32Array(NV * 3);
const aLevel = new Float32Array(NV), aWet = new Float32Array(NV), hArr = new Float32Array(NV);
const aFilm = new Float32Array(NV);            // 壁に残ったバリウムの膜 1 枚の光学的な厚み（sim.js の updateWet）
const aThick = new Float32Array(NV).fill(10);   // その頂点を通る X 線が胃の中のバリウムを通る長さ（模型の単位）。sim.js の updateThickness
const aRug = new Float32Array(NV * 3);          // (軸方向t, 周方向θ, 皺襞の強さ)
const frameU = new Float32Array(NN * 3), frameV = new Float32Array(NN * 3);
const centers = new Float32Array(NN * 3), radius = new Float32Array(NN);
const area = new Float32Array(NN), dl = new Float32Array(NN), cap = new Float32Array(NN);
const wVol = new Float32Array(NN), hmin = new Float32Array(NN), hmax = new Float32Array(NN), lvl = new Float32Array(NN);
const regionOf = new Int8Array(NN);
let edges = [], regionList = [], cardiaIdx = 0, pylIdx = 0, bsRadius = 12, boxHalf = [8, 10, 6];
let anatOff = [0, 0, 0], lumenK = 1, distK = [1, 1];
/* 胃の拡張の実測値（2026-11-01）
   ・健康な成人の MRI：胃の容積（内容物＋空気）は空腹時 151.9 mL、液体 400 mL を飲んだ 15 分後 521.6 mL。胃角から引いた線で分けた
     近位と遠位の容積の比は、空腹時 2.33、15 分後 3.59（偽薬群。Min YW ほか, PLoS ONE 2015;10(9):e0138927）。
     この 2 点を直線で結び、胃の容積から近位：遠位の比を決める（範囲の外は端の値）
   ・発泡剤で拡張した胃の CT gastrography：胃の容積 438.5 ± 163.4 mL（BMI 25 未満。Kim SH ほか, Obesity Surgery 2020, doi:10.1007/s11695-019-04189-5）。
     バリウム 150 mL ＋ ガス 100〜400 mL（250〜550 mL）は、この範囲に入る */
const DISTEND = {
  v0: 151.9, r0: 2.33, v1: 521.6, r1: 3.59,
  ratio(v) { const t = Math.max(0, Math.min(1, (v - this.v0) / (this.v1 - this.v0))); return this.r0 + (this.r1 - this.r0) * t; }
};
let totalCap = 0, drained = 0;

/* ---- 管の生成 ---- */
function buildRings(pts, rads, N, off, taper, radMul) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', 0.5);
  const tmp = new THREE.Vector3(), T = new THREE.Vector3(), U = new THREE.Vector3(), V = new THREE.Vector3();
  const AP = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), ci = (off + i) * 3;
    curve.getPoint(t, tmp);
    centers[ci] = tmp.x; centers[ci + 1] = tmp.y; centers[ci + 2] = tmp.z;
    let r = cr1(rads, t * (rads.length - 1));
    if (radMul) r *= radMul(t * (rads.length - 1));
    if (taper > 0) { const e = Math.min(t, 1 - t) / taper; if (e < 1) r *= Math.sqrt(Math.max(0, 1 - (1 - e) * (1 - e))); }
    radius[off + i] = Math.max(r, 0.04);
  }
  for (let i = 0; i < N; i++) {
    const a = Math.max(0, i - 1) * 3 + off * 3, b = Math.min(N - 1, i + 1) * 3 + off * 3, ci = (off + i) * 3;
    T.set(centers[b] - centers[a], centers[b + 1] - centers[a + 1], centers[b + 2] - centers[a + 2]).normalize();
    const d = AP.dot(T);
    U.set(AP.x - T.x * d, AP.y - T.y * d, AP.z - T.z * d);
    if (U.lengthSq() < 1e-5) { U.set(1, 0, 0); const d2 = U.dot(T); U.set(1 - T.x * d2, -T.y * d2, -T.z * d2); }
    U.normalize(); V.crossVectors(T, U).normalize();
    frameU[(off + i) * 3] = U.x; frameU[(off + i) * 3 + 1] = U.y; frameU[(off + i) * 3 + 2] = U.z;
    frameV[(off + i) * 3] = V.x; frameV[(off + i) * 3 + 1] = V.y; frameV[(off + i) * 3 + 2] = V.z;
    const r = radius[off + i], rb = r * FLAT;
    for (let j = 0; j < CM; j++) {
      const th = j / CM * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), k = ((off + i) * CM + j) * 3;
      aRug[k] = i / (N - 1); aRug[k + 1] = j / CM;
      pos[k]     = centers[ci]     + r * cs * V.x + rb * sn * U.x;
      pos[k + 1] = centers[ci + 1] + r * cs * V.y + rb * sn * U.y;
      pos[k + 2] = centers[ci + 2] + r * cs * V.z + rb * sn * U.z;
    }
    // 断面積・長さ
    const la = Math.max(0, i - 1), lb = Math.min(N - 1, i + 1);
    const ax = centers[(off + lb) * 3] - centers[(off + la) * 3],
          ay = centers[(off + lb) * 3 + 1] - centers[(off + la) * 3 + 1],
          az = centers[(off + lb) * 3 + 2] - centers[(off + la) * 3 + 2];
    dl[off + i] = Math.sqrt(ax * ax + ay * ay + az * az) / (lb - la);
    area[off + i] = Math.PI * r * r * FLAT;
    cap[off + i] = area[off + i] * dl[off + i];
  }
}

/* 圧迫筒：指定部位を前後に押しつぶし、左右へ広げる */
/* ---- 圧迫筒で胃をつぶす ----
   圧迫筒（直径 10 cm、実寸）を、選んだ部位の真ん中の断面の正面（X 線管の側、compAxis の向き）から押し当てる。
   圧迫筒の円の中にある胃の壁のうち、X 線管の側（前の壁）を、後ろの壁へ向けて押し込む。後ろの壁は動かさない（背中側で支えられる）。
   押し込む深さは強さ amt（0〜1）で決め、amt = 1 で前後の壁の隙間が COMP_GAP（実寸およそ 3 mm）まで薄くなる。
   円のふちでは押し込みを滑らかに弱める（壁が裂けないように）。
   つぶれた断面は、輪の多角形の面積から断面積と容量を求め直す。入りきらなくなったバリウムは rebuild の最後で隣の断面へあふれさせる */
const FUNDUS = { r: 0.6, d: 2.6 };       // 穹窿部を深くする量（rebuild）：胃底部の先端で太さ 1.6 倍、背中側へ 2.6（実寸およそ 3.1 cm）。2026-11-04 に 1.35 倍・1.5 から深くした
const COMP_R = 5 / 1.2, COMP_GAP = 0.25;   // 圧迫筒の半径（実寸 5 cm を模型の単位に）、押し込んだときの前後の壁の隙間（模型の単位）
let compAxis = [0, 0, 1];                   // X 線管の向き（胃の座標）。sim.js の setCompAxis が体位から決める
function ringArea(i) {   // 断面 i の輪の多角形の面積（断面の平面 U・V で測る）
  const c = i * 3, ux = frameU[c], uy = frameU[c + 1], uz = frameU[c + 2], vx = frameV[c], vy = frameV[c + 1], vz = frameV[c + 2];
  let A = 0, pu = 0, pv = 0, fu = 0, fv = 0;
  for (let j = 0; j <= CM; j++) {
    const k = (i * CM + (j % CM)) * 3;
    const dx = pos[k] - centers[c], dy = pos[k + 1] - centers[c + 1], dz = pos[k + 2] - centers[c + 2];
    const u = dx * ux + dy * uy + dz * uz, v = dx * vx + dy * vy + dz * vz;
    if (j === 0) { fu = u; fv = v; } else A += pu * v - u * pv;
    pu = u; pv = v;
  }
  return Math.abs(A) / 2;
}
function applyCompression(key, amt) {
  if (!(amt > 0) || !key) return;
  let f = -1, l = -1;
  for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] === key) { if (f < 0) f = i; l = i; }
  if (f < 0) return;
  const m = Math.round((f + l) / 2), cx = centers[m * 3], cy = centers[m * 3 + 1], cz = centers[m * 3 + 2];
  const [ax, ay, az] = compAxis;
  const wOf = k => {   // 圧迫筒の円の中なら 1、外なら 0（ふちで滑らかに）
    const dx = pos[k] - cx, dy = pos[k + 1] - cy, dz = pos[k + 2] - cz, h = dx * ax + dy * ay + dz * az;
    const r = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - h * h)), t = (r - 0.75 * COMP_R) / (0.5 * COMP_R);
    return t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
  };
  // 断面ごとの、いちばん前（X 線管の側）といちばん後ろの壁の高さ
  const hiA = new Float64Array(NMAIN).fill(-1e9), hiP = new Float64Array(NMAIN).fill(1e9);
  for (let i = 0; i < NMAIN; i++) for (let j = 0; j < CM; j++) {
    const k = (i * CM + j) * 3, h = pos[k] * ax + pos[k + 1] * ay + pos[k + 2] * az;
    if (h > hiA[i]) hiA[i] = h; if (h < hiP[i]) hiP[i] = h;
  }
  // 圧迫筒の面の高さ L：押す場所の真ん中の断面で、前の壁から後ろの壁（＋隙間）まで、強さの割合だけ下ろす。
  // ほかの断面も同じ面で押されるが、自分の後ろの壁（＋隙間）より奥へは押し込まない（後ろは背中側で支えられる）
  const L = hiA[m] - amt * Math.max(0, hiA[m] - hiP[m] - COMP_GAP);
  const before = new Float64Array(NMAIN), touched = new Uint8Array(NMAIN);
  for (let i = 0; i < NMAIN; i++) {
    const Li = Math.max(L, hiP[i] + COMP_GAP);
    for (let j = 0; j < CM; j++) {
      const k = (i * CM + j) * 3, w = wOf(k);
      if (w <= 0) continue;
      const h = pos[k] * ax + pos[k + 1] * ay + pos[k + 2] * az;
      if (h <= Li) continue;
      if (!touched[i]) { touched[i] = 1; before[i] = ringArea(i); }
      const d = (Li - h) * w;   // 前の壁を後ろへ
      pos[k] += d * ax; pos[k + 1] += d * ay; pos[k + 2] += d * az;
    }
  }
  for (let i = 0; i < NMAIN; i++) if (touched[i] && before[i] > 1e-9) {   // 断面積を、多角形の面積が減った割合で減らす
    area[i] *= Math.max(0.01, ringArea(i) / before[i]); cap[i] = area[i] * dl[i];
  }
  compMid = m;
}
/* 入りきらないバリウムを隣の断面へあふれさせる（近い断面から順に。十二指腸と食道へは入れない）。量は減らさない */
function spillExcess() {
  for (let i = 0; i < NMAIN; i++) {
    let ex = wVol[i] - cap[i];
    if (ex <= 1e-9) continue;
    wVol[i] = cap[i];
    for (let d = 1; d < NMAIN && ex > 1e-9; d++) for (const n of [i - d, i + d]) {
      if (n < 0 || n >= NMAIN || regionList[regionOf[n]][0] === 'duode' || ex <= 1e-9) continue;
      const room = cap[n] - wVol[n];
      if (room > 0) { const t = Math.min(room, ex); wVol[n] += t; ex -= t; }
    }
  }
}
let compMid = -1;

function tubeIndex(N, M, base, idx, p) {
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < M; j++) {
    const j2 = (j + 1) % M;
    const a = base + i * M + j, b = base + i * M + j2, c = base + (i + 1) * M + j2, d = base + (i + 1) * M + j;
    idx[p++] = a; idx[p++] = c; idx[p++] = b;
    idx[p++] = a; idx[p++] = d; idx[p++] = c;
  }
  return p;
}

const indices = new Uint32Array(((NMAIN - 1) + (NESO - 1)) * CM * 6);
{ let p = tubeIndex(NMAIN, CM, 0, indices, 0); tubeIndex(NESO, CM, NMAIN * CM, indices, p); }

/* ---- モデル再構築 ---- */
function rebuild() {
  const S = TYPES[curType], air = airLevel;
  const nCtl = S.pts.length - 1;
  regionList = S.regions;
  const pylStart = S.regions.find(r => r[0] === 'pylorus')[2];
  // 胃の拡張：胃の容量を胃の中身（バリウム＋発泡剤のガス、実寸 mL）に合わせ、胃角を境に近位（胃底部・胃体部）と遠位（胃角部より先）の
  // 容積の比を、胃の容積に応じて変える。拡張するほど近位がよく膨らむ（DISTEND の実測値による）。十二指腸球部と食道は膨らませない。
  // 太さ（rad0、なければ rad）に、近位で kP、遠位で kD を掛ける（胃角部の中で滑らかにつなぐ）。断面積は太さの 2 乗に比例する
  const R0 = S.rad0 || S.rad, S3 = Math.pow(BODY_SCALE, 3), want = targetMl * S3 + gasMl, nC = S.pts.length - 1;
  const reg = k => S.regions.find(r => r[0] === k), ang = reg('angle'), pc = reg('duode')[2];
  const wDist = c => c <= ang[2] ? 0 : c >= ang[3] ? 1 : (c - ang[2]) / (ang[3] - ang[2]);   // 0 = 近位、1 = 遠位
  // 穹窿部（胃底部）を深くする（2026-11-04）：胃底部の断面を太くし（先端ほど。最大 FUNDUS.r 倍）、中心の線を背中側へ下げる（最大 FUNDUS.d）。
  // 背臥位や頭低位で、胃底部により多くのバリウムが溜まるようにするため。胃全体の容積はこのあとバリウム＋ガスに合わせるので変わらない。
  // 値は見た目と溜まり方で決めた仮の値（実測と照らし合わせていない）
  const fEnd = reg('fundus')[3], fW = c => { const t = Math.max(0, Math.min(1, c / fEnd)); return 1 - t * t * (3 - 2 * t); };   // 胃底部の先端 1 → 胃体部との境 0
  const fMul = c => 1 + FUNDUS.r * fW(c);
  const pts = S.pts.map((p, k) => [p[0], p[1], p[2] - FUNDUS.d * fW(k)]);   // z は腹側が +、背中側へ下げる
  buildRings(pts, R0, NMAIN, 0, 0.06, fMul);
  let P1 = 0, D1 = 0;   // 倍率 1 のときの近位・遠位の容量（実寸 mL。胃角部は半分ずつ）
  for (let i = 0; i < NMAIN; i++) { const c = i / (NMAIN - 1) * nC; if (c >= pc) continue; const w = wDist(c); P1 += cap[i] * (1 - w) * S3; D1 += cap[i] * w * S3; }
  const ratio = DISTEND.ratio(want);
  // 近位 = want × ratio / (1 + ratio)、遠位 = want / (1 + ratio) になる倍率（近位・遠位それぞれ 2 乗で効く）
  distK = [Math.sqrt(want * ratio / (1 + ratio) / P1), Math.sqrt(want / (1 + ratio) / D1)];
  lumenK = Math.sqrt(want / (P1 + D1));
  const mulD = x => { const c = x, w = wDist(c); return distK[0] * (1 - w) + distK[1] * w; };
  buildRings(pts, R0, NMAIN, 0, 0.06, x => (x >= pc ? lumenK : mulD(x)) * fMul(x));

  cardiaIdx = Math.round(S.cardia / nCtl * (NMAIN - 1));
  pylIdx = Math.round((pylStart + 0.5) / nCtl * (NMAIN - 1));

  // 噴門位置から食道を生やす
  const ci = cardiaIdx * 3, rr = radius[cardiaIdx];
  const dir = new THREE.Vector3(-0.85, 0.5, -0.12).normalize().multiplyScalar(rr * 0.9);
  const J = [centers[ci] + dir.x, centers[ci + 1] + dir.y, centers[ci + 2] + dir.z];
  const eso = [[J[0] - 1.0, J[1] + 7.2, J[2] - 1.0], [J[0] - 0.8, J[1] + 4.6, J[2] - 0.8],
               [J[0] - 0.45, J[1] + 2.2, J[2] - 0.45], J];
  buildRings(eso, [1.0, 0.95, 0.92, 1.05], NESO, NMAIN, 0, null);

  // 部位の割り当て
  for (let i = 0; i < NMAIN; i++) {
    const c = i / (NMAIN - 1) * nCtl; let r = regionList.length - 1;
    for (let k = 0; k < regionList.length; k++) if (c < regionList[k][3]) { r = k; break; }
    regionOf[i] = r;
  }
  for (let i = NMAIN; i < NN; i++) regionOf[i] = -1;

  // 皺襞の強さ：胃底部・胃体部で明瞭、前庭部で乏しく、十二指腸にはない
  const FOLD = { fundus: 1.0, body: 1.0, angle: 0.6, antrum: 0.22, pylorus: 0.1, duode: 0.0 };
  for (let i = 0; i < NMAIN; i++) {
    const f = FOLD[regionList[regionOf[i]][0]];
    for (let j = 0; j < CM; j++) aRug[(i * CM + j) * 3 + 2] = f;
  }
  for (let i = NMAIN; i < NN; i++) for (let j = 0; j < CM; j++) aRug[(i * CM + j) * 3 + 2] = 0.75;

  compMid = -1;
  applyCompression(compRegion, compAmt);

  // 中心合わせ
  let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
  for (let i = 0; i < NMAIN; i++) {
    const k = i * 3, r = radius[i];
    mnx = Math.min(mnx, centers[k] - r); mxx = Math.max(mxx, centers[k] + r);
    mny = Math.min(mny, centers[k + 1] - r); mxy = Math.max(mxy, centers[k + 1] + r);
    mnz = Math.min(mnz, centers[k + 2] - r); mxz = Math.max(mxz, centers[k + 2] + r);
  }
  const ox = (mnx + mxx) / 2, oy = (mny + mxy) / 2, oz = (mnz + mxz) / 2;
  anatOff = [ox, oy, oz];
  for (let i = 0; i < NV * 3; i += 3) { pos[i] -= ox; pos[i + 1] -= oy; pos[i + 2] -= oz; }
  for (let i = 0; i < NN * 3; i += 3) { centers[i] -= ox; centers[i + 1] -= oy; centers[i + 2] -= oz; }
  boxHalf = [(mxx - mnx) / 2, (mxy - mny) / 2, (mxz - mnz) / 2];

  let rs = 0;
  for (let i = 0; i < NV * 3; i += 3) rs = Math.max(rs, pos[i] * pos[i] + pos[i + 1] * pos[i + 1] + pos[i + 2] * pos[i + 2]);
  bsRadius = Math.sqrt(rs);

  // 流路グラフ
  edges = [];
  for (let i = 0; i < NMAIN - 1; i++) {
    let k = 1, k2 = 1;
    if (regionList[regionOf[i]][0] === 'pylorus' || regionList[regionOf[i + 1]][0] === 'pylorus') { k = k2 = pylorusOpen ? 0.85 : 0.10; }
    edges.push({ i: i, j: i + 1, k: k, k2: k2 });
  }
  for (let i = NMAIN; i < NN - 1; i++) edges.push({ i: i, j: i + 1, k: 1, k2: 0 });   // 食道の中も口の側へは戻さない（蠕動で胃へ送る。sim.js の dose）
  // 食道の下端から胃へは、流路でつながず、噴門から胃の壁に沿って低いほうへ流れた先の断面へ入れる（sim.js の pourTarget と dose）。
  // 下部食道括約筋があるので、胃から食道へは戻らない（以前は 0.17 で戻していて、水平にすると逆流していた）

  totalCap = 0;
  for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] !== 'duode') totalCap += cap[i];
  spillExcess();   // 圧迫などで入りきらなくなった分は隣へ（以前は消していた）
  for (let i = NMAIN; i < NN; i++) wVol[i] = Math.min(wVol[i], cap[i]);
  saveEsoBase(); joinEsophagus();
  geom.attributes.position.needsUpdate = true;
  geom.computeVertexNormals();
}
/* ---- 食道と胃をつなぐ ----
   食道と胃は別々の管で作っていて、食道の下の端の輪は胃の壁の手前で終わる。体位で胃がねじれたり振れたりすると、すき間が空く。
   そこで、食道の下の端にいちばん近い胃の壁の点（噴門の前後の断面の中から探す）を求め、食道の最後の ESO_JOIN 個の輪を、
   その点より少し内側（0.5）まで滑らかに伸ばし、端をラッパのように広げて（最後の輪で 1.7 倍）胃の壁になじませる。
   胃の形が変わるたび（rebuild の最後と sim.js の shapeApply）に行う。食道のもとの形は escBase に取っておく */
const ESO_JOIN = 6;
const escBase = { c: new Float32Array(ESO_JOIN * 3), r: new Float32Array(ESO_JOIN), ok: false };
function saveEsoBase() {
  for (let k = 0; k < ESO_JOIN; k++) { const i = NN - ESO_JOIN + k; escBase.c.set(centers.subarray(i * 3, i * 3 + 3), k * 3); escBase.r[k] = radius[i]; }
  escBase.ok = true;
}
function joinEsophagus() {
  if (!escBase.ok) return;
  const L = ESO_JOIN - 1, ex = escBase.c[L * 3], ey = escBase.c[L * 3 + 1], ez = escBase.c[L * 3 + 2];
  // 食道の下の端（もとの位置）にいちばん近い胃の壁の点
  let best = -1, bd = Infinity, bs = cardiaIdx;
  for (let i = Math.max(0, cardiaIdx - 14); i <= Math.min(NMAIN - 1, cardiaIdx + 14); i++) for (let j = 0; j < CM; j++) {
    const k = (i * CM + j) * 3, d = (pos[k] - ex) ** 2 + (pos[k + 1] - ey) ** 2 + (pos[k + 2] - ez) ** 2;
    if (d < bd) { bd = d; best = k; bs = i; }
  }
  if (best < 0) return;
  // 壁の点から、その断面の中心へ 0.5 入った所を食道の終わりにする
  let ix = centers[bs * 3] - pos[best], iy = centers[bs * 3 + 1] - pos[best + 1], iz = centers[bs * 3 + 2] - pos[best + 2];
  const il = Math.hypot(ix, iy, iz) || 1;
  const tx = pos[best] + ix / il * 0.5, ty = pos[best + 1] + iy / il * 0.5, tz = pos[best + 2] + iz / il * 0.5;
  const dx = tx - ex, dy = ty - ey, dz = tz - ez;
  for (let k = 0; k < ESO_JOIN; k++) {
    const i = NN - ESO_JOIN + k, s = (k + 1) / ESO_JOIN, w = s * s * (3 - 2 * s);   // 端ほど大きく動かす
    const c = i * 3;
    centers[c] = escBase.c[k * 3] + dx * w; centers[c + 1] = escBase.c[k * 3 + 1] + dy * w; centers[c + 2] = escBase.c[k * 3 + 2] + dz * w;
    const r = escBase.r[k] * (1 + 0.7 * s * s * s), rb = r * FLAT;
    const ux = frameU[c], uy = frameU[c + 1], uz = frameU[c + 2], vx = frameV[c], vy = frameV[c + 1], vz = frameV[c + 2];
    for (let j = 0; j < CM; j++) {
      const th = j / CM * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th), q = (i * CM + j) * 3;
      pos[q] = centers[c] + r * cs * vx + rb * sn * ux;
      pos[q + 1] = centers[c + 1] + r * cs * vy + rb * sn * uy;
      pos[q + 2] = centers[c + 2] + r * cs * vz + rb * sn * uz;
    }
  }
}
