"use strict";
/* ================= 評価モード（URL に ?eval=1 を付けたときだけ読み込む）=================
   シミュレーションの妥当性を定量評価する。既存のシミュレーションの計算には手を加えず、
   同じ関数（settle / flowStep / levelOf / updateWet など）を決まった手順で呼んで測る。

   【評価の手順（各体位で共通。毎回同じ結果になるようにする）】
   1. 条件を固定する：胃型 = 鉤状胃、バリウム量 = 120 mL（モデルの単位）、発泡剤 = 既定値（airLevel 0.6）、
      圧迫なし、幽門は閉じる。
   2. 起倒角と回転角をそのまま設定し（画面のようにゆっくり動かさない）、settle() で平衡にする。
      settle() はバリウムを入れ直して 1/60 秒の刻みで 150 回流し、胃の壁を全面「付着あり」（aWet = 1）にする。
   3. そのあと時間刻み Δt = 1/60 秒で T 秒（既定 10 秒）ぶん、画面と同じ順に計算を進める
      （computeHeights → dose → flowStep → 液面 levelOf → updateWet）。経過時間に実時間を使わないので、
      同じ条件なら毎回同じ状態になる。

   【① 目的部位の描出率】
   二重造影の度合いは、3D 表示のシェーダ（scene.js の FRAG_SOLID）と同じ式で頂点ごとに 0〜1 で求める。
     below = （頂点の高さ h ≦ その断面の液面 L）なら 1、そうでなければ 0      … バリウムの溜まり
     coat  = smoothstep(0.12, 0.55, aWet)                                   … 付着の量
     down  = clamp(−n・u, 0, 1)   n：壁の外向きの法線、u：重力の逆向き（上）  … 壁が下を向いている度合い
     dbl   = (1 − below) × coat × smoothstep(0.02, 0.22, down)              … 二重造影
   描出率(%) = Σ(A_v × dbl_v) ÷ Σ A_v × 100（目的部位の頂点 v について合計）。
   A_v は頂点の受け持ち面積（その頂点を含む三角形の面積の 1/3 の合計）。しきい値は設けず、0〜1 の値で重み付けする。
   シェーダは画素ごとに補間した値で判定するが、ここでは頂点で判定して面積で重み付けしている（近似）。

   目的部位 =「部位」＋必要なら「壁」。
     部位：胃の型のデータ（TYPES[型].regions）で、管の輪ごとに割り当てた部位（regionOf）。
           胃底部・胃体部・胃角部・前庭部・幽門部・十二指腸球部。「胃全体」は十二指腸球部を除くすべて。
     壁  ：壁が向いている方向（頂点の外向きの法線 n を、管の接線に垂直な面に写した向き）の角度 φ で 4 つに分ける。
           基準は、腹側の軸（モデルの z）を管の接線に垂直に直した向き A と、
           管の曲がりの内側（胃の中心線の重心の側）を向く横の向き S（= 小弯の側）。
           φ = atan2(n・S, n・A)。|φ| ≦ 45° 前壁、45° < φ ≦ 135° 小弯、|φ| > 135° 後壁、−135° ≦ φ < −45° 大弯。
           （胃の断面は前後に扁平なので、頂点の位置の角度ではなく壁の向きで分ける）

   【② 体積の整合性】
   流れの計算（flowStep）は断面の間で同じ量を移すだけなので、モデルの水量の合計 Σ wVol は保存される
   （丸め誤差のみ）。一方、液面は「断面は楕円」と仮定して水量から逆算しているので、
   実際のメッシュで測った体積とは差が出うる。そこで次の 2 つを出す。
     V_ref  = settle() 直後の Σ wVol（投与量）
     V_mesh = Σ（断面 n の輪の多角形のうち液面より下の部分の面積 × 断面の長さ dl[n]）
     体積変動率(%)       = (V_mesh − V_ref) ÷ V_ref × 100   … CSV の「体積変動率(%)」
     体積変動率_モデル(%) = (Σ wVol − V_ref) ÷ V_ref × 100   … 保存の確認（0 に近いはず）

   【③ 再現性】
   同じ体位で手順 1〜3 を 10 回くり返し、そのたびに透視像（520 × 650 画素、撮影と同じ大きさ）を描いて画素を読み出す。
   10 枚すべてが 1 回目と 1 バイトも違わなければ「一致」。

   【④ 動作性能】
   描画時間(ms)：手順 3 のあと、画面を 1 回描く処理（render）と GPU の完了待ち（1 画素の読み出し）にかかる時間を
   30 回測った平均。シミュレーションの計算時間は別の列に出す。
   平均 fps：その体位のまま、通常の描画ループを 10 秒動かしたときの 1 秒あたりの描画回数。 */

const EVAL = { type: 'hook', ml: 120, air: 0.6, dt: 1 / 60, simSec: 10, repeat: 10, fpsSec: 10, timeReps: 30 };
const EVAL_KEY = 'stomach.v2.eval';
const REGION_NAMES = ['胃底部', '胃体部', '胃角部', '前庭部', '幽門部', '十二指腸球部'];
const WALLS = ['前壁', '小弯', '後壁', '大弯'];

/* ---- 状態の控えと復元（評価のあとは元の画面に戻す）---- */
function evalSave() {
  return { curType, targetMl, airLevel, compRegion, compAmt, pylorusOpen, tiltCur, tiltT, rollCur, rollT,
           administered, drained, wVol: wVol.slice(), aWet: aWet.slice() };
}
function evalRestore(s) {
  curType = s.curType; targetMl = s.targetMl; airLevel = s.airLevel; compRegion = s.compRegion; compAmt = s.compAmt;
  pylorusOpen = s.pylorusOpen; tiltCur = s.tiltCur; tiltT = s.tiltT; rollCur = s.rollCur; rollT = s.rollT;
  rebuildAll(); buildLabels();
  wVol.set(s.wVol); aWet.set(s.aWet); administered = s.administered; drained = s.drained;
  applyPose(); tiltGroup.updateMatrixWorld(true); upLocal(uUp.value); computeHeights();
  for (let n = 0; n < NN; n++) lvl[n] = levelOf(n);
  buildSurface();
}

/* ---- 手順 1〜3 ---- */
function evalStep(dt) {   // main.js の loop と同じ順（カメラ・ラベル・画面表示は除く）
  applyPose();
  tiltGroup.updateMatrixWorld(true);
  upLocal(uUp.value);
  computeHeights();
  dose(dt);
  flowStep(dt);
  for (let n = 0; n < NN; n++) lvl[n] = levelOf(n);
  updateWet(dt);
}
function evalPrepare(tilt, roll) {
  const changed = curType !== EVAL.type || airLevel !== EVAL.air || compAmt !== 0 || pylorusOpen;
  curType = EVAL.type; targetMl = EVAL.ml; airLevel = EVAL.air; compRegion = ''; compAmt = 0; pylorusOpen = false;
  if (changed) { rebuildAll(); buildLabels(); }
  tiltCur = tiltT = tilt; rollCur = rollT = roll;
  settle();
  const vRef = wVol.reduce((a, b) => a + b, 0);
  const t0 = performance.now();
  const steps = Math.round(EVAL.simSec / EVAL.dt);
  for (let s = 0; s < steps; s++) evalStep(EVAL.dt);
  buildSurface();
  return { vRef, simMs: performance.now() - t0 };
}

/* ---- ① 部位と壁の判定、二重造影、描出率 ---- */
function vertexAreas() {   // 頂点の受け持ち面積（隣の三角形の面積の 1/3 の合計）。胃と十二指腸の輪だけ
  const A = new Float64Array(NMAIN * CM), nf = (NMAIN - 1) * CM * 2;
  for (let f = 0; f < nf; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const s = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 / 3;
    A[a] += s; A[b] += s; A[c] += s;
  }
  return A;
}
function wallSectors() {   // 頂点ごとの壁（0 前壁、1 小弯、2 後壁、3 大弯）
  const sec = new Int8Array(NMAIN * CM), nrm = geom.attributes.normal.array;
  let gx = 0, gy = 0, gz = 0, gn = 0;   // 胃の中心線の重心（十二指腸球部を除く）
  for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] !== 'duode') { gx += centers[i * 3]; gy += centers[i * 3 + 1]; gz += centers[i * 3 + 2]; gn++; }
  const G = new THREE.Vector3(gx / gn, gy / gn, gz / gn);
  const T = new THREE.Vector3(), A = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Vector3(), r = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  let lastSign = 1;
  for (let i = 0; i < NMAIN; i++) {
    const a = Math.max(0, i - 1) * 3, b = Math.min(NMAIN - 1, i + 1) * 3;
    T.set(centers[b] - centers[a], centers[b + 1] - centers[a + 1], centers[b + 2] - centers[a + 2]).normalize();
    A.copy(Z).addScaledVector(T, -Z.dot(T)).normalize();                 // 腹側
    S.crossVectors(T, A).normalize();                                    // 横（向きは下で小弯側にそろえる）
    C.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
    const inner = G.clone().sub(C).dot(S);
    const sign = Math.abs(inner) > 0.05 ? Math.sign(inner) : lastSign;   // 重心の側 = 曲がりの内側 = 小弯
    lastSign = sign; S.multiplyScalar(sign);
    for (let j = 0; j < CM; j++) {
      const v = i * CM + j;
      r.set(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);   // 壁の外向きの法線
      const phi = Math.atan2(r.dot(S), r.dot(A)) * 180 / Math.PI;
      sec[v] = Math.abs(phi) <= 45 ? 0 : phi > 45 && phi <= 135 ? 1 : Math.abs(phi) > 135 ? 2 : 3;
    }
  }
  return sec;
}
function smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
function doubleContrast() {   // 頂点ごとの dbl（FRAG_SOLID と同じ式）
  const nrm = geom.attributes.normal.array, u = uUp.value;
  const d = new Float64Array(NMAIN * CM);
  for (let v = 0; v < NMAIN * CM; v++) {
    const below = hArr[v] <= aLevel[v] ? 1 : 0;
    const coat = smooth(0.12, 0.55, aWet[v]);
    const down = Math.max(0, Math.min(1, -(nrm[v * 3] * u.x + nrm[v * 3 + 1] * u.y + nrm[v * 3 + 2] * u.z)));
    d[v] = (1 - below) * coat * smooth(0.02, 0.22, down);
  }
  return d;
}
function parseTarget(text) {   // 「胃体部後壁」「胃体部+胃角部後壁」「胃全体」など。わからなければ null
  const parts = String(text || '').split(/[+＋、,，・]/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (const p of parts) {
    let wall = -1, rest = p;
    for (let w = 0; w < WALLS.length; w++) if (rest.endsWith(WALLS[w])) { wall = w; rest = rest.slice(0, -WALLS[w].length); break; }
    if (rest === '胃全体' || rest === '') { out.push({ regions: null, wall }); continue; }
    const k = REGION_NAMES.indexOf(rest);
    if (k < 0) return null;
    out.push({ regions: [rest], wall });
  }
  return out;
}
function targetMask(target, sec) {   // 目的部位に入る頂点
  const m = new Uint8Array(NMAIN * CM);
  for (let i = 0; i < NMAIN; i++) {
    const name = regionList[regionOf[i]][1], duode = regionList[regionOf[i]][0] === 'duode';
    for (const t of target) {
      if (t.regions ? t.regions.indexOf(name) < 0 : duode) continue;
      for (let j = 0; j < CM; j++) { const v = i * CM + j; if (t.wall < 0 || sec[v] === t.wall) m[v] = 1; }
    }
  }
  return m;
}
function depictionRate(target) {
  const A = vertexAreas(), sec = wallSectors(), d = doubleContrast(), m = targetMask(target, sec);
  let all = 0, dbl = 0;
  for (let v = 0; v < NMAIN * CM; v++) if (m[v]) { all += A[v]; dbl += A[v] * d[v]; }
  return { rate: all > 0 ? dbl / all * 100 : NaN, area: all };
}

/* ---- ② 体積 ---- */
function meshVolume() {   // Σ（輪の多角形の液面より下の面積 × dl）
  let V = 0;
  const P = [], H = [];
  for (let n = 0; n < NN; n++) {
    const L = lvl[n], b = n * CM;
    P.length = 0; H.length = 0;
    for (let j = 0; j < CM; j++) { const k = (b + j) * 3; P.push([pos[k], pos[k + 1], pos[k + 2]]); H.push(hArr[b + j]); }
    const poly = [];
    for (let j = 0; j < CM; j++) {   // 液面より下の部分を切り出す（Sutherland–Hodgman）
      const j2 = (j + 1) % CM, ha = H[j] - L, hb = H[j2] - L;
      if (ha <= 0) poly.push(P[j]);
      if ((ha <= 0) !== (hb <= 0)) { const t = ha / (ha - hb); poly.push(P[j].map((x, q) => x + (P[j2][q] - x) * t)); }
    }
    if (poly.length < 3) continue;
    let cx = 0, cy = 0, cz = 0;   // 多角形の面積（中心から扇形に分けた三角形の面積の和）
    const o = poly[0];
    for (let q = 1; q + 1 < poly.length; q++) {
      const ux = poly[q][0] - o[0], uy = poly[q][1] - o[1], uz = poly[q][2] - o[2];
      const vx = poly[q + 1][0] - o[0], vy = poly[q + 1][1] - o[1], vz = poly[q + 1][2] - o[2];
      cx += uy * vz - uz * vy; cy += uz * vx - ux * vz; cz += ux * vy - uy * vx;
    }
    V += Math.hypot(cx, cy, cz) / 2 * dl[n];
  }
  return V;
}

/* ---- ③ 透視像（撮影と同じ 520 × 650）---- */
const evalRT = new THREE.WebGLRenderTarget(capW, capH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
function evalXray() {
  setXcam(capW / capH);
  setXray(true);
  renderer.setScissorTest(false);
  renderer.setRenderTarget(evalRT);
  renderer.setClearColor(0x05080B, 1); renderer.clear();
  renderer.render(scene, xcam);
  const buf = new Uint8Array(capW * capH * 4);
  renderer.readRenderTargetPixels(evalRT, 0, 0, capW, capH, buf);
  renderer.setRenderTarget(null);
  setXray(false);
  return buf;
}

/* ---- ④ 描画時間と fps ---- */
function renderTime() {
  const gl = renderer.getContext(), px = new Uint8Array(4);
  let sum = 0;
  for (let k = 0; k < EVAL.timeReps; k++) {
    const t0 = performance.now();
    render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // GPU の完了を待つ
    sum += performance.now() - t0;
  }
  return sum / EVAL.timeReps;
}
function measureFps(sec) {   // 通常の描画ループを動かして数える
  return new Promise(done => {
    let n = 0, t0 = 0;
    renderer.setAnimationLoop(now => {
      loop(now);
      if (!t0) t0 = now; else n++;
      if (now - t0 >= sec * 1000) { renderer.setAnimationLoop(null); done(n * 1000 / (now - t0)); }
    });
  });
}
const nextFrame = () => new Promise(r => setTimeout(r, 0));

/* ---- 1 行ぶんの評価 ---- */
async function evalRow(row, report) {
  const tilt = +row.tilt, roll = +row.roll;
  const target = parseTarget(row.target);
  const res = { name: row.name || poseName(tilt, roll), tilt, roll, target: row.target };
  // ①②
  const p = evalPrepare(tilt, roll);
  res.simMs = p.simMs;
  if (target) { const d = depictionRate(target); res.rate = d.rate; res.area = d.area; } else { res.rate = NaN; res.area = NaN; }
  res.vRef = p.vRef; res.vMesh = meshVolume(); res.vModel = wVol.reduce((a, b) => a + b, 0);
  res.dVol = (res.vMesh - res.vRef) / res.vRef * 100;
  res.dVolModel = (res.vModel - res.vRef) / res.vRef * 100;
  // ④ 描画時間（①②と同じ状態で）
  applyCam(); res.renderMs = renderTime();
  report('再現性を確認中');
  await nextFrame();
  // ③
  let first = null, same = true, diffPx = 0;
  for (let k = 0; k < EVAL.repeat; k++) {
    evalPrepare(tilt, roll);
    const img = evalXray();
    if (!first) first = img;
    else for (let q = 0; q < img.length; q += 4)
      if (img[q] !== first[q] || img[q + 1] !== first[q + 1] || img[q + 2] !== first[q + 2] || img[q + 3] !== first[q + 3]) { same = false; diffPx++; }
    await nextFrame();
  }
  res.repro = same; res.diffPx = diffPx;
  // ④ fps
  if (EVAL.fpsSec > 0) {
    report('fps を計測中（' + EVAL.fpsSec + ' 秒）');
    evalPrepare(tilt, roll);
    res.fps = await measureFps(EVAL.fpsSec);
  } else res.fps = NaN;
  return res;
}

/* ================= 画面 ================= */
const evalStyle = document.createElement('style');
evalStyle.textContent = `
#evalPanel{position:fixed; inset:4vh 4vw; z-index:70; background:var(--panel); border:1px solid var(--line2); border-radius:4px;
  padding:14px 16px; overflow:auto; display:none; font-size:12.5px; color:var(--text)}
#evalPanel.on{display:block}
#evalPanel h2{font-size:14px; margin:0 0 6px}
#evalPanel p{margin:4px 0; color:var(--muted); line-height:1.6}
#evalPanel table{border-collapse:collapse; width:100%; margin:8px 0}
#evalPanel th,#evalPanel td{border:1px solid var(--line2); padding:4px 6px; text-align:left; white-space:nowrap}
#evalPanel input{background:#0D161D; color:var(--text); border:1px solid var(--line2); border-radius:3px; padding:3px 5px; font:inherit; width:100%}
#evalPanel input.num{width:70px}
#evalPanel .bad{border-color:#C0563A}
#evalPanel button{background:#13242F; color:var(--text); border:1px solid var(--line2); border-radius:3px; padding:5px 10px; font:inherit; cursor:pointer; margin-right:6px}
#evalPanel .row{display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin:6px 0}
#evalPanel .row label{display:flex; gap:6px; align-items:center}
#evalMsg{color:var(--teal)}`;
document.head.appendChild(evalStyle);

const evalPanel = document.createElement('div'); evalPanel.id = 'evalPanel';
evalPanel.innerHTML = `
<h2>評価モード</h2>
<p>条件：胃型 鉤状胃、バリウム ${EVAL.ml} mL、発泡剤 既定、圧迫なし、幽門閉。各体位で settle() のあと Δt = 1/60 秒で計算を進めてから測る。
定義は js/eval.js の先頭に書いてある。</p>
<p>目的部位の書き方：部位（${REGION_NAMES.join('・')}・胃全体）＋必要なら壁（${WALLS.join('・')}）。例「胃体部後壁」。複数は「+」でつなぐ。</p>
<div class="row">
  <label>計算を進める秒数<input class="num" id="evSim" type="number" min="0" step="1"></label>
  <label>再現性の回数<input class="num" id="evRep" type="number" min="2" step="1"></label>
  <label>fps の計測秒数<input class="num" id="evFps" type="number" min="0" step="1"></label>
</div>
<table id="evIn"><thead><tr><th>体位名</th><th>起倒角</th><th>回転角</th><th>目的部位（ラベル名）</th><th></th></tr></thead><tbody></tbody></table>
<div class="row"><button type="button" id="evAdd">行を足す</button><button type="button" id="evRun">評価する</button>
<button type="button" id="evCsv" disabled>CSV を保存</button><button type="button" id="evClose">閉じる</button><span id="evalMsg"></span></div>
<table id="evOut"></table>`;
document.body.appendChild(evalPanel);

const evalBtn = document.createElement('button');
evalBtn.type = 'button'; evalBtn.className = 'vrbtn'; evalBtn.textContent = '評価';
document.getElementById('bShot').before(evalBtn);
evalBtn.addEventListener('click', () => evalPanel.classList.add('on'));
document.getElementById('evClose').addEventListener('click', () => evalPanel.classList.remove('on'));

let evalRows = [{ name: '', tilt: '', roll: '', target: '' }];   // 目的部位は利用者がマニュアルから入れる（推測では埋めない）
try { const s = JSON.parse(localStorage.getItem(EVAL_KEY) || 'null'); if (s && s.rows && s.rows.length) evalRows = s.rows; if (s && s.p) Object.assign(EVAL, s.p); } catch (e) { }
const $e = id => document.getElementById(id);
$e('evSim').value = EVAL.simSec; $e('evRep').value = EVAL.repeat; $e('evFps').value = EVAL.fpsSec;
function evalPersist() {
  try { localStorage.setItem(EVAL_KEY, JSON.stringify({ rows: evalRows, p: { simSec: EVAL.simSec, repeat: EVAL.repeat, fpsSec: EVAL.fpsSec } })); } catch (e) { }
}
function drawInputs() {
  const tb = $e('evIn').querySelector('tbody'); tb.innerHTML = '';
  evalRows.forEach((r, i) => {
    const tr = document.createElement('tr');
    const cell = (key, cls, type) => {
      const td = document.createElement('td'), inp = document.createElement('input');
      inp.value = r[key]; if (cls) inp.className = cls; if (type) inp.type = type;
      const chk = () => { if (key === 'target') inp.classList.toggle('bad', !!r.target && !parseTarget(r.target)); };
      inp.addEventListener('input', () => { r[key] = inp.value; chk(); evalPersist(); });
      chk(); td.appendChild(inp); tr.appendChild(td);
    };
    cell('name'); cell('tilt', 'num', 'number'); cell('roll', 'num', 'number'); cell('target');
    const td = document.createElement('td'), del = document.createElement('button');
    del.type = 'button'; del.textContent = '削除';
    del.addEventListener('click', () => { evalRows.splice(i, 1); if (!evalRows.length) evalRows.push({ name: '', tilt: '', roll: '', target: '' }); evalPersist(); drawInputs(); });
    td.appendChild(del); tr.appendChild(td); tb.appendChild(tr);
  });
}
drawInputs();
$e('evAdd').addEventListener('click', () => { evalRows.push({ name: '', tilt: '', roll: '', target: '' }); evalPersist(); drawInputs(); });
for (const [id, key] of [['evSim', 'simSec'], ['evRep', 'repeat'], ['evFps', 'fpsSec']])
  $e(id).addEventListener('input', () => { const v = +$e(id).value; if (v >= 0) { EVAL[key] = v; evalPersist(); } });

const CSV_HEAD = ['体位名', '起倒角', '回転角', '目的部位', '描出率(%)', '体積変動率(%)', '再現性(一致/不一致)', '描画時間(ms)',
  '平均fps', '体積変動率_モデル(%)', '液量_メッシュ(mL)', '液量_投与(mL)', '目的部位の面積(cm2)', '計算時間(ms)', '不一致の画素数',
  '胃型', '計算を進めた秒数', '再現性の回数'];
let evalResults = [];
function resultRow(r) {
  const f = (x, d) => Number.isFinite(x) ? x.toFixed(d) : '';
  return [r.name, r.tilt, r.roll, r.target, f(r.rate, 2), f(r.dVol, 3), r.repro ? '一致' : '不一致', f(r.renderMs, 2),
    f(r.fps, 1), f(r.dVolModel, 5), f(r.vMesh, 2), f(r.vRef, 2), f(r.area, 2), f(r.simMs, 1), r.diffPx,
    TYPES[EVAL.type].name, EVAL.simSec, EVAL.repeat];
}
function drawResults() {
  const t = $e('evOut');
  t.innerHTML = '<thead><tr>' + CSV_HEAD.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    evalResults.map(r => '<tr>' + resultRow(r).map(c => '<td>' + String(c).replace(/[<>&]/g, '') + '</td>').join('') + '</tr>').join('') + '</tbody>';
}
$e('evRun').addEventListener('click', async () => {
  const rows = evalRows.filter(r => r.tilt !== '' && r.roll !== '');
  if (!rows.length) { $e('evalMsg').textContent = '起倒角と回転角を入れた行がありません'; return; }
  const bad = rows.find(r => r.target && !parseTarget(r.target));
  if (bad) { $e('evalMsg').textContent = '目的部位が読めない行があります：' + bad.target; return; }
  $e('evRun').disabled = true; $e('evCsv').disabled = true;
  renderer.setAnimationLoop(null);                 // 評価のあいだは通常の描画ループを止める
  const saved = evalSave();
  evalResults = [];
  try {
    for (let i = 0; i < rows.length; i++) {
      const msg = s => { $e('evalMsg').textContent = (i + 1) + ' / ' + rows.length + ' 行目：' + s; };
      msg('計算中'); await nextFrame();
      evalResults.push(await evalRow(rows[i], msg));
      drawResults();
    }
    $e('evalMsg').textContent = '終わりました（' + rows.length + ' 行）';
    $e('evCsv').disabled = false;
  } catch (e) {
    $e('evalMsg').textContent = 'エラー：' + e.message; console.error(e);
  } finally {
    evalRestore(saved);
    last = performance.now();
    renderer.setAnimationLoop(loop);
    $e('evRun').disabled = false;
  }
});
$e('evCsv').addEventListener('click', () => {
  const esc = v => { const s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [CSV_HEAD, ...evalResults.map(resultRow)].map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const d = new Date(), z = n => String(n).padStart(2, '0');
  a.download = 'stomach_eval_' + d.getFullYear() + z(d.getMonth() + 1) + z(d.getDate()) + '_' + z(d.getHours()) + z(d.getMinutes()) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
});
