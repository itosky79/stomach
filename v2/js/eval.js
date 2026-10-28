"use strict";
/* ================= 評価モード（URL に ?eval=1 を付けたときだけ読み込む）=================
   シミュレーションの妥当性を定量評価する。既存のシミュレーションの計算には手を加えず、
   同じ関数（settle / flowStep / levelOf / updateWet など）を決まった手順で呼んで測る。

   【評価の手順（各体位で共通。毎回同じ結果になるようにする）】
   1. 条件を固定する：胃型 = 評価画面で選んだ型（既定は鉤状胃）、バリウム量 = 120 mL（モデルの単位）、発泡剤 = 既定値（airLevel 0.6）、
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
     部位：胃の型のデータ（TYPES[型].regions）で、管の輪ごとに割り当てた部位（regionOf）と、
           それを分けた胃体上部・胃上部・噴門部など。言葉と定義は parseTarget の前のコメントにまとめた。
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

const EVAL = { type: 'bp3d', ml: 150 / Math.pow(BODY_SCALE, 3), gas: 250, air: 0.6, pylorus: false, twistMax: [30, 30], dt: 1 / 60, simSec: 10, repeat: 10, fpsSec: 10, timeReps: 30 };
const EVAL_KEY = 'stomach.v2.eval';
/* ---- 状態の控えと復元（評価のあとは元の画面に戻す）---- */
function evalSave() {
  return { curType, targetMl, gasMl, airLevel, compRegion, compAmt, pylorusOpen, tiltCur, tiltT, rollCur, rollT,
           administered, drained, wVol: wVol.slice(), aWet: aWet.slice() };
}
function evalRestore(s) {
  curType = s.curType; targetMl = s.targetMl; gasMl = s.gasMl; airLevel = s.airLevel; compRegion = s.compRegion; compAmt = s.compAmt;
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
  shapeStep(dt);
}
function evalPrepare(tilt, roll) {
  const changed = curType !== EVAL.type || airLevel !== EVAL.air || compAmt !== 0 || pylorusOpen !== EVAL.pylorus || gasMl !== EVAL.gas || targetMl !== EVAL.ml;
  curType = EVAL.type; targetMl = EVAL.ml; gasMl = EVAL.gas; airLevel = EVAL.air; compRegion = ''; compAmt = 0; pylorusOpen = EVAL.pylorus;   // 幽門は既定で閉じる
  if (changed) { rebuildAll(); buildLabels(); }
  tiltCur = tiltT = tilt; rollCur = rollT = roll;
  sagS.fill(0);   // たわみは毎回まっすぐの形から始める（前の体位の形を持ち越さない）
  settle();
  const vRef = wVol.reduce((a, b) => a + b, 0);
  const t0 = performance.now();
  const steps = Math.round(EVAL.simSec / EVAL.dt);
  for (let s = 0; s < steps; s++) evalStep(EVAL.dt);
  buildSurface();
  return { vRef, simMs: performance.now() - t0 };
}

/* ---- ① 部位と壁の判定、二重造影、描出率は measure.js（ミッションでも使うので常に読み込む）---- */

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
  const res = { name: row.name || poseName(tilt, roll), tilt, roll, target: row.target, targetOk: !!target };
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

/* ================= 国試の体位選択問題の再現 =================
   「○○に異常が疑われた場合、適切な撮影（体位）はどれか」という問題で、選択肢の体位ごとに設問の部位の描出率を求め、
   描出率の高い順に正答の数（1 つ、または「2 つ選べ」なら 2 つ）だけ選んだものが、
   厚生労働省の正答値表の正答と一致するかを見る。体位の角度は docs/positions.md の対応（アプリの体位の定義）による。
   部位の言葉の定義は parseTarget の前のコメント（噴門部は噴門から実寸 2 cm 以内）。 */
const KOKUSHI_POSES = { '右側臥位像': [0, 270], '背臥位正面像': [0, 0], '背臥位第1斜位像': [0, 45], '背臥位第2斜位像': [0, 315],
  '半立位第2斜位像': [45, 315], '再立位第1斜位像': [90, 45] };
const KOKUSHI_Q = [
  { src: '第71回 午前 第89問', target: '噴門部', choices: ['右側臥位像', '背臥位正面像', '背臥位第1斜位像', '背臥位第2斜位像', '半立位第2斜位像'], ans: ['右側臥位像', '半立位第2斜位像'] },
  { src: '第73回 午前 第83問', target: '胃角部', choices: ['右側臥位像', '背臥位正面像', '再立位第1斜位像', '背臥位第1斜位像', '半立位第2斜位像'], ans: ['背臥位正面像'] }
];
function evalKokushi() {   // 選んだ胃型で 2 問を評価する。行ごとに結果を返す
  return KOKUSHI_Q.map(q => {
    const r = q.choices.map(c => { evalPrepare(KOKUSHI_POSES[c][0], KOKUSHI_POSES[c][1]); return [c, depictionRate(parseTarget(q.target)).rate]; });
    const top = [...r].sort((a, b) => b[1] - a[1]).slice(0, q.ans.length).map(x => x[0]);
    return { src: q.src, target: q.target, rates: r, top, ans: q.ans, hit: q.ans.every(a => top.includes(a)) };
  });
}

/* ================= 条件を振った評価（胃型 × バリウム量 × 角度）=================
   基準撮影法Ⅱの表（data.js の SEQ2）から、食道（①）と圧迫（⑫）を除いた 10 体位と、その目的部位を使う。
   ・バリウム量：各体位・各胃型で、バリウム量だけを変えて描出率を求める。充填率 = バリウム量 ÷ 胃の容量（十二指腸球部を除く）。
   ・斜位の角度：斜位の体位（回転角が 45°・135°・225°・315°）について、起倒角はそのままで、回転角を
     斜位の両隣の正面・側面の間（例：45° なら 0〜90°）で 5° ずつ変え、描出率がいちばん高い回転角を求める。
   ・頭低位の角度：頭低位の体位（起倒角が負）について、回転角はそのままで、起倒角を 0〜−45° で 5° ずつ変える。
   それ以外の条件と手順は評価モードと同じ（settle のあと Δt = 1/60 秒で 10 秒）。 */
function seqRows() { return SEQ2.filter(q => !q.comp && q.tgt.indexOf('食道') < 0).map(q => ({ ...q, tgt: q.etgt || q.tgt })); }   // 評価には etgt（マニュアルの大弯側・小弯側まで書いたもの）を使う
function capacityNow() {   // 胃の容量（十二指腸球部を除く、模型の mL）
  let c = 0; for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] !== 'duode') c += cap[i]; return c;
}
async function sweepAll(types, mls, report) {
  const out = [], saveType = EVAL.type, saveMl = EVAL.ml;
  try {
    for (const type of types) {
      EVAL.type = type;
      // バリウム量
      for (const ml of mls) {
        EVAL.ml = ml;
        for (const q of seqRows()) {
          evalPrepare(q.tilt, q.roll);
          out.push({ kind: 'バリウム量', type, ml, fill: ml / capacityNow() * 100, pose: q.name, tilt: q.tilt, roll: q.roll, target: q.tgt,
                     rate: depictionRate(parseTarget(q.tgt)).rate });
        }
        report(TYPES[type].name + ' ' + ml + ' mL'); await nextFrame();
      }
      EVAL.ml = saveMl;
      // 角度
      for (const q of seqRows()) {
        const oblique = q.roll % 90 === 45, headDown = q.tilt < 0;
        if (oblique) for (let r = q.roll - 45; r <= q.roll + 45; r += 5) {
          evalPrepare(q.tilt, r);
          out.push({ kind: '回転角', type, ml: EVAL.ml, fill: EVAL.ml / capacityNow() * 100, pose: q.name, tilt: q.tilt, roll: r, target: q.tgt, rate: depictionRate(parseTarget(q.tgt)).rate });
        }
        if (headDown) for (let t = 0; t >= -45; t -= 5) {
          evalPrepare(t, q.roll);
          out.push({ kind: '起倒角', type, ml: EVAL.ml, fill: EVAL.ml / capacityNow() * 100, pose: q.name, tilt: t, roll: q.roll, target: q.tgt, rate: depictionRate(parseTarget(q.tgt)).rate });
        }
      }
      report(TYPES[type].name + ' 角度'); await nextFrame();
    }
  } finally { EVAL.type = saveType; EVAL.ml = saveMl; }
  return out;
}
const SWEEP_HEAD = ['種類', '胃型', 'バリウム量(模型mL)', '充填率(%)', '体位名', '起倒角', '回転角', '目的部位', '描出率(%)'];
function sweepCsv(rows) {
  const f = x => Number.isFinite(x) ? x.toFixed(2) : '';
  return '\uFEFF' + [SWEEP_HEAD, ...rows.map(r => [r.kind, TYPES[r.type].name, r.ml, f(r.fill), r.pose, r.tilt, r.roll, r.target, f(r.rate)])]
    .map(a => a.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n') + '\r\n';
}

/* ================= 教科書のバリウムの動きとの比較（TEXTBOOK_CHECK.md）=================
   教科書（胃X線検診 上部消化管検査必携テキスト，ぱーそん書房，2022）に書いてあるバリウムの位置を、
   シミュレーターが再現するかを判定する。判定の基準は TEXTBOOK_CHECK.md に計算の前に決めたもの。
   条件と手順は評価モードと同じ（settle のあと Δt = 1/60 秒で EVAL.simSec 秒）。流れの速さは実測と照合していないので、
   バリウムの動きが止まった状態だけを使う。秒数を変えても判定が変わらないことを別に確かめる。
     部位のバリウムの割合(%) = その部位の断面の水量の合計 ÷ 胃（十二指腸球部を除く）の水量の合計 × 100
     幽門前庭部 = 前庭部 + 幽門部
     噴門部が沈んでいる割合(%) = 噴門部（噴門から実寸 2 cm 以内の壁）の面積のうち、液面より下にある面積の割合
     「残らない」= 5% 以下 */
function regionShares() {
  const v = {}; let tot = 0;
  for (let i = 0; i < NMAIN; i++) {
    const k = regionList[regionOf[i]][0]; if (k === 'duode') continue;
    v[k] = (v[k] || 0) + wVol[i]; tot += wVol[i];
  }
  const sh = {}; for (const k of Object.keys(v)) sh[k] = tot > 0 ? v[k] / tot * 100 : 0;
  sh.antPyl = (sh.antrum || 0) + (sh.pylorus || 0);
  return { sh, vol: v, tot };
}
function cardiaSubmerged() {
  const A = vertexAreas(), m = targetMask(parseTarget('噴門部'), wallSectors());
  let all = 0, sub = 0;
  for (let v = 0; v < NMAIN * CM; v++) if (m[v]) { all += A[v]; if (hArr[v] <= lvl[(v / CM) | 0]) sub += A[v]; }
  return all > 0 ? sub / all * 100 : NaN;
}
/* 教科書の目印から回転角を求める（天板に垂直な X 線の投影で比べる。起倒角によらない）
   rollCardiaRightEdge：背臥位第2斜位の側（回転角 360° → 270°）へ 1° ずつ回し、噴門（BP3D.meta.cardia）が
     椎体（噴門の高さの BP3D.meta.spine の行。椎体の前後左右の 4 隅を投影した範囲）の右縁に初めて重なる回転角。
   rollRightLateral：右側臥位（270°）の前後 ±30° を 1° ずつ見て、噴門が胃上部（ringsOf('胃上部') の輪）の
     投影の腹背方向の幅のちょうど中央（0.5）にいちばん近い回転角。 */
function projAxis(roll, axis) {   // その回転角で、透視像の横方向（axis を天板に垂直な向きに直交させたもの）
  tiltCur = 0; rollCur = roll; applyPose(); tiltGroup.updateMatrixWorld(true);
  const u = upLocal(new THREE.Vector3());
  return axis.clone().addScaledVector(u, -axis.dot(u)).normalize();
}
function rollCardiaRightEdge() {
  const c = new THREE.Vector3(...BP3D.meta.cardia);
  const row = BP3D.meta.spine.reduce((a, b) => Math.abs(b[0] - c.y) < Math.abs(a[0] - c.y) ? b : a);
  const corners = [[row[1], row[3]], [row[1], row[4]], [row[2], row[3]], [row[2], row[4]]].map(([x, z]) => new THREE.Vector3(x, c.y, z));
  for (let r = 360; r >= 280; r--) {
    const L = projAxis(r % 360, new THREE.Vector3(1, 0, 0));   // 患者の左が +
    if (c.dot(L) >= Math.min(...corners.map(p => p.dot(L)))) continue;   // まだ椎体の右縁より左
    return r + 1;
  }
  return null;
}
function rightLateralRoll() {   // 右側臥位の角度：ねじれの表で決めた角度があればそれ（calibrateTwist）、なければ目印から求める
  const k = (TYPES[curType].twist || []).find(x => String(x.items || '').startsWith('6'));
  return k ? k.roll : rollRightLateral();
}
function rollRightLateral() {   // ねじれる前の胃の形で求める（ねじれで角度が変わらないように）
  const PP = twistBase ? twistBase.pos : pos, CC = twistBase ? twistBase.centers : centers;
  const e = (NN - 1) * 3, c = new THREE.Vector3(CC[e], CC[e + 1], CC[e + 2]), rr = ringsOf('胃上部');
  let best = 270, bd = 1e9;
  for (let r = 240; r <= 300; r++) {
    const L = projAxis(r, new THREE.Vector3(0, 0, 1));   // 側臥位の像の横方向（腹側が +）
    let lo = 1e9, hi = -1e9;
    for (let i = rr[0]; i <= rr[1]; i++) for (let j = 0; j < CM; j++) {
      const v = (i * CM + j) * 3, d = PP[v] * L.x + PP[v + 1] * L.y + PP[v + 2] * L.z;
      if (d < lo) lo = d; if (d > hi) hi = d;
    }
    const t = Math.abs((c.dot(L) - lo) / (hi - lo) - 0.5);
    if (t < bd) { bd = t; best = r; }
  }
  return best;
}
/* 解剖モデルを決まった内腔の容積（実寸 mL）にした型を作る（TEXTBOOK_CHECK.md「解剖モデル」）。
   BodyParts3D のままの太さ rad0 に同じ倍率 k を掛け、胃（十二指腸球部を除く）の容量 × 1.2³ が目標になる k を二分法で求める */
function makeLumenType(ml, baseKey = 'bp3d', key = baseKey + '_' + ml) {   // 胃の中身を ml（実寸）にする：ガス = ml − バリウム
  const base = TYPES[baseKey], S3 = Math.pow(BODY_SCALE, 3);
  TYPES[key] = { ...base, name: base.name + '（内腔 ' + ml + ' mL）' };
  EVAL.gas = ml - EVAL.ml * S3; gasMl = EVAL.gas; curType = key; rebuildAll();
  TYPES[key].k = lumenK;
  return key;
}
let TB_TYPES = ['hook', 'horn', 'casc', 'ptos'];
/* 体位ごとの胃のねじれを決める（TEXTBOOK_CHECK.md「ねじれ」）。
   基準撮影法の体位ごとに、その体位の教科書の項目を、ねじれなしで満たしていればそのまま（0）にする。
   満たしていなければ、x・y・z のまわりを 0・±10・±20・±30・±40° で組み合わせた回転を、回転の大きさの小さい順に試し、
   その体位の項目を満たす最初の回転にする（必要最小限の回転）。項目 4 は腹臥位の水平と頭低位を比べるので、頭低位の側を回す。 */
function twistKeys(rl) {
  const sh = () => regionShares().sh;
  return [
    { tilt: 0, roll: 0, items: '2・5a', ok: () => { const r = sh(); const big = Object.keys(r).filter(k => k !== 'antPyl').sort((a, b) => r[b] - r[a])[0]; return big === 'fundus' && r.antPyl <= 5; } },
    { tilt: 0, roll: 35, items: '5b', ok: () => sh().antPyl <= 5 },
    { tilt: -30, roll: 307, items: '5c', ok: () => sh().antPyl <= 5 },
    { tilt: -30, roll: 180, items: '4', ok: () => { const r = sh(); const t = TYPES[curType].twist, save = t.slice(); TYPES[curType].twist = t.filter(k => !(k.tilt === -30 && k.roll === 180));
        evalPrepare(0, 180); const r0 = sh(); TYPES[curType].twist = save; twistCur = [NaN, 0]; evalPrepare(-30, 180); return r.antPyl < r0.antPyl && r.fundus + r.body > 50; } },
    { tilt: -30, roll: 155, items: '5d', ok: () => sh().antPyl <= 5 },
    { tilt: 25, roll: 225, items: '8', ok: () => cardiaSubmerged() <= 5 },
    { tilt: 0, roll: rl, items: '6', ok: () => cardiaSubmerged() <= 5 },
    { tilt: 25, roll: 307, items: '7', ok: () => sh().fundus <= 5 },
    { tilt: 0, roll: 315, items: '3', ok: () => { const r = sh(); return r.fundus >= 10 && r.antPyl >= 10 && r.body < r.fundus && r.body < r.antPyl; } }
  ];
}
function calibrateTwist(report) {
  /* ねじれの決め方（TEXTBOOK_CHECK.md「ねじれ」）：
     1. 回転は教科書に書いてある 2 つの動きだけ：α = 噴門と幽門を結ぶ線のまわり（p.90）、β = 前後の軸のまわりの正面での振れ（p.94）。
        α は −90〜90°、β は −40〜40°（10° 刻み）
     2. 基準撮影法の体位ごとに、その体位の項目を満たす (α, β) をすべて挙げる（ねじれなしで満たす体位は 0 に固定）。
        右側臥位は、教科書が目印で角度を合わせる体位なので、回転角 270°（真横）〜目印の角度の間も候補にする
     3. 挙げた中から、Σ|回転|² + λ Σ w_ij |回転_i − 回転_j|² がいちばん小さくなる組を選ぶ
        （w_ij は 2 つの体位の重力の向きが近いほど大きい。近い体位どうしで向きが急に変わらないようにする）
     4. 補間は表の体位でちょうど表の値になるので、選んだ組で全体位を確かめ直す */
  const T = TYPES[EVAL.type];
  T.twist = []; twistCur = [NaN, 0];
  evalPrepare(0, 270); const rl = rollRightLateral();
  const AB = [], LIM = EVAL.twistMax || [90, 40];   // 見た目が胃らしく保てる範囲に絞るときは EVAL.twistMax = [α, β]
  for (let a = -LIM[0]; a <= LIM[0]; a += 10) for (let b = -LIM[1]; b <= LIM[1]; b += 10) AB.push([a, b]);
  const keys = twistKeys(rl).map(K => ({ K, tilt: K.tilt, roll: K.roll, items: K.items, list: null,
    rolls: K.items === '6' ? [270, 275, 280, 285, rl].filter((v, i, a) => a.indexOf(v) === i) : [K.roll] }));
  const extra = [{ tilt: 90, roll: 45, items: '立位第1斜位（項目なし）' }, { tilt: 0, roll: 90, items: '左側臥位（項目なし）' }];
  const zeroKey = k => ({ tilt: k.tilt, roll: k.roll, ab: [0, 0], items: k.items });
  const check = (k, roll, ab) => {
    T.twist = keys.filter(x => x !== k).map(zeroKey).concat(extra.map(zeroKey), [{ tilt: k.tilt, roll, ab, items: k.items }]);
    twistCur = [NaN, 0]; evalPrepare(k.tilt, roll); return k.K.ok();
  };
  for (const k of keys) {
    if (check(k, k.roll, [0, 0])) { k.list = [{ roll: k.roll, ab: [0, 0], rot: [0, 0] }]; continue; }
    k.list = [];
    for (const roll of k.rolls) for (const ab of AB) if (check(k, roll, ab)) k.list.push({ roll, ab, rot: ab });
    if (report) report(k.items + '：満たす組 ' + k.list.length);
  }
  // 3. なめらかさで選ぶ（座標ごとの降下を収まるまで）
  const all = keys.concat(extra.map(x => ({ ...x, list: [{ roll: x.roll, ab: [0, 0], rot: [0, 0] }] })));
  const LAMBDA = 4, d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
  const cost = () => {
    const U = all.map(k => upOf(k.tilt, k.pick.roll)); let J = 0;
    all.forEach((k, i) => { J += d2(k.pick.rot, [0, 0]); all.forEach((m, j) => { if (j > i) J += LAMBDA * Math.exp(-0.5 * (angDeg(U[i], U[j]) / TWIST_SIG) ** 2) * d2(k.pick.rot, m.pick.rot); }); });
    return J;
  };
  all.forEach(k => { k.pick = k.list.length ? k.list.slice().sort((p, q) => d2(p.rot, [0, 0]) - d2(q.rot, [0, 0]))[0] : { roll: k.roll, ab: [0, 0], rot: [0, 0] }; });
  for (let it = 0; it < 30; it++) {
    let moved = false;
    for (const k of all) {
      if (k.list.length < 2) continue;
      let best = k.pick, bJ = cost();
      for (const c of k.list) { k.pick = c; const J = cost(); if (J < bJ - 1e-9) { bJ = J; best = c; } }
      if (best !== k.pick) moved = true;
      k.pick = best;
    }
    if (!moved) break;
  }
  T.twist = all.map(k => ({ tilt: k.tilt, roll: k.pick.roll, ab: k.pick.ab, items: k.items }));
  twistCur = [NaN, 0];
  return keys.map(k => { twistCur = [NaN, 0]; evalPrepare(k.tilt, k.pick.roll); return { tilt: k.tilt, roll: k.pick.roll, items: k.items, ab: k.pick.ab, n: k.list.length, ok: k.K.ok() }; });
}

const TB_DRAIN = { hook: [30, 60, '半立位（30〜60°）'], horn: [60, 90, '立位（60〜90°）'], casc: [null, null, '90° でも流れ出さない'] };
function textbookCheck(opt = {}) {   // opt.skipDrain：項目 1（台を起こしていく計算）を飛ばす
  const out = [], saveType = EVAL.type;
  const f1 = x => Number.isFinite(x) ? x.toFixed(1) : '';
  const add = (no, type, pose, tilt, roll, what, value, crit, ok) =>
    out.push({ no, type, pose, tilt, roll, what, value, crit, judge: ok === null ? '記載なし' : ok ? '一致' : '不一致' });
  try {
    for (const type of TB_TYPES) {
      EVAL.type = type;
      // 項目 1：背臥位正面位から台を 5° ずつ起こし、胃底部のバリウムが背臥位の半分以下になった最初の角度
      if (!opt.skipDrain) {
      evalPrepare(0, 0);
      const f0 = regionShares().vol.fundus || 0;
      let drain = null;
      const trace = [];
      for (let t = 5; t <= 90; t += 5) {
        tiltCur = tiltT = t;
        const steps = Math.round(EVAL.simSec / EVAL.dt);
        for (let s = 0; s < steps; s++) evalStep(EVAL.dt);
        const fv = regionShares().vol.fundus || 0;
        trace.push(t + '°:' + f1(f0 > 0 ? fv / f0 * 100 : NaN));
        if (drain === null && fv <= f0 * 0.5) drain = t;
      }
      const d = TB_DRAIN[type];
      const ok1 = !d ? null : d[0] === null ? drain === null : drain !== null && drain >= d[0] && drain <= d[1];
      add('1', type, '背臥位正面位から起こす', '0→90', 0, '胃底部のバリウムが背臥位の半分以下になった角度（°）',
          drain === null ? '90° でも流れ出さない' : drain, d ? d[2] : '（記載なし）', ok1);
      add('1（経過）', type, '背臥位正面位から起こす', '0→90', 0, '胃底部のバリウム（背臥位を 100%）', trace.join(' '), '', null);
      }
      // 項目 2：背臥位では穹窿部にたまる
      evalPrepare(0, 0);
      let r = regionShares().sh;
      const big = Object.keys(r).filter(k => k !== 'antPyl').sort((a, b) => r[b] - r[a])[0];
      add('2', type, '背臥位正面位', 0, 0, '胃底部の割合（%）／一番多い部位', f1(r.fundus) + '／' + (regionList.find(x => x[0] === big) || [0, big])[1],
          '胃底部が一番多い', big === 'fundus');
      // 項目 5a
      add('5a', type, '背臥位正面位', 0, 0, '幽門前庭部の割合（%）', f1(r.antPyl), '5% 以下', r.antPyl <= 5);
      // 項目 3：振り分け
      evalPrepare(0, 315); r = regionShares().sh;
      add('3', type, '背臥位第2斜位（振り分け）', 0, 315, '胃底部／幽門前庭部／胃体部の割合（%）', f1(r.fundus) + '／' + f1(r.antPyl) + '／' + f1(r.body),
          '胃底部と幽門前庭部が 10% 以上、胃体部がその両方より少ない', r.fundus >= 10 && r.antPyl >= 10 && r.body < r.fundus && r.body < r.antPyl);
      // 項目 4：腹臥位頭低位で胃下部から上部へ流れ去る
      evalPrepare(0, 180); const r0 = regionShares().sh;
      evalPrepare(-30, 180); r = regionShares().sh;
      add('4', type, '腹臥位正面位 水平→頭低位', '0→−30', 180, '幽門前庭部の割合 水平→頭低位（%）／頭低位の胃底部＋胃体部（%）',
          f1(r0.antPyl) + '→' + f1(r.antPyl) + '／' + f1(r.fundus + r.body), '頭低位で幽門前庭部が減り、胃底部＋胃体部が 50% 超',
          r.antPyl < r0.antPyl && r.fundus + r.body > 50);
      // 項目 5b〜5d：幽門前庭部に残らない
      const r2 = rollCardiaRightEdge();
      for (const [no, pose, t, ro] of [['5b', '背臥位第1斜位', 0, 35], ['5c', '背臥位第2斜位（頭低位）', -30, r2], ['5d', '腹臥位第2斜位（頭低位）', -30, 155]]) {
        evalPrepare(t, ro); r = regionShares().sh;
        add(no, type, pose, t, ro, '幽門前庭部の割合（%）', f1(r.antPyl), '5% 以下', r.antPyl <= 5);
      }
      // 項目 6：右側臥位で噴門部に停留がない
      evalPrepare(0, 270); const rl = rightLateralRoll();
      evalPrepare(0, rl); let c = cardiaSubmerged();
      add('6', type, '右側臥位', 0, rl, '噴門部が沈んでいる割合（%）', f1(c), '5% 以下', c <= 5);
      // 項目 7：半臥位第2斜位で穹窿部に残存がない
      evalPrepare(25, r2); r = regionShares().sh;
      add('7', type, '半臥位第2斜位', 25, r2, '胃底部の割合（%）', f1(r.fundus), '5% 以下', r.fundus <= 5);
      // 項目 8：腹臥位第1斜位（半臥位）で噴門部に残留がない
      evalPrepare(25, 225); c = cardiaSubmerged();
      add('8', type, '腹臥位第1斜位（半臥位）', 25, 225, '噴門部が沈んでいる割合（%）', f1(c), '5% 以下', c <= 5);
    }
  } finally { EVAL.type = saveType; }
  return out;
}
/* 改良 2：基準撮影法Ⅱを教科書の順番と体位変換の経路で通して計算する（TEXTBOOK_CHECK.md「改良 2」）。
   経路は [起倒角, 回転角] の点の並び。回転角は 360° を超えてよい（回す向きを表すため）。
   点から点へ 5° ずつ動かし、1 段ごとに dwell 秒流す。撮影の体位に着いたら EVAL.simSec 秒流してから測る。 */
function pathMove(points, dwell) {
  const n = Math.round(dwell / EVAL.dt);
  for (const [t1, r1] of points) {
    const t0 = tiltCur, r0 = rollCur, k = Math.max(1, Math.ceil(Math.max(Math.abs(t1 - t0), Math.abs(r1 - r0)) / 5));
    for (let i = 1; i <= k; i++) {
      tiltCur = tiltT = t0 + (t1 - t0) * i / k; rollCur = rollT = r0 + (r1 - r0) * i / k;
      for (let s = 0; s < n; s++) evalStep(EVAL.dt);
    }
  }
}
function pathShoot() { const n = Math.round(EVAL.simSec / EVAL.dt); for (let s = 0; s < n; s++) evalStep(EVAL.dt); }
function textbookPath(dwell) {
  const out = [], saveType = EVAL.type;
  const f1 = x => Number.isFinite(x) ? x.toFixed(1) : '';
  const add = (no, type, pose, what, value, crit, ok) =>
    out.push({ no, type, pose, tilt: Math.round(tiltCur), roll: Math.round(((rollCur % 360) + 360) % 360), what, value, crit, judge: ok ? '一致' : '不一致' });
  const anal = () => regionShares().sh;
  try {
    for (const type of TB_TYPES) {
      EVAL.type = type;
      evalPrepare(90, 45);                                         // ① 立位第1斜位（食道）
      const r2 = rollCardiaRightEdge() - 360;                      // 第2斜位の角度（例 307 → −53）
      evalPrepare(90, 45); rollCur = rollT = 45; tiltCur = tiltT = 90;
      // ② 第1斜位のまま台を倒し、水平で右方向に 360° を 3 回
      pathMove([[0, 45], [0, 0], [0, -1080]], dwell); rollCur = rollT = 0; pathShoot();
      let r = anal();
      const big = Object.keys(r).filter(k => k !== 'antPyl').sort((a, b) => r[b] - r[a])[0];
      add('2', type, '② 背臥位正面位', '胃底部の割合（%）／一番多い部位', f1(r.fundus) + '／' + (regionList.find(x => x[0] === big) || [0, big])[1], '胃底部が一番多い', big === 'fundus');
      add('5a', type, '② 背臥位正面位', '幽門前庭部の割合（%）', f1(r.antPyl), '5% 以下', r.antPyl <= 5);
      // ③ 右方向に 360° 回転し、第1斜位 35°
      pathMove([[0, -360], [0, -325]], dwell); rollCur = rollT = 35; pathShoot();
      r = anal(); add('5b', type, '③ 背臥位第1斜位', '幽門前庭部の割合（%）', f1(r.antPyl), '5% 以下', r.antPyl <= 5);
      // ④ 背臥位に戻し、右方向に 360° 回転して第2斜位、頭低位 −30°
      pathMove([[0, 0], [0, -360], [0, -360 + r2], [-30, -360 + r2]], dwell); rollCur = rollT = 360 + r2; pathShoot();
      r = anal(); add('5c', type, '④ 背臥位第2斜位（頭低位）', '幽門前庭部の割合（%）', f1(r.antPyl), '5% 以下', r.antPyl <= 5);
      // ⑤ 背臥位に戻し、右回転で腹臥位、半臥位 25°（フトンを入れる）、頭低位 −30°
      pathMove([[0, 360 + r2], [0, 360], [0, 180]], dwell); rollCur = rollT = 180; pathShoot();
      const r0 = anal();
      pathMove([[25, 180], [-30, 180]], dwell); pathShoot();
      r = anal();
      add('4', type, '⑤ 腹臥位正面位 水平→頭低位', '幽門前庭部の割合 水平→頭低位（%）／頭低位の胃底部＋胃体部（%）',
          f1(r0.antPyl) + '→' + f1(r.antPyl) + '／' + f1(r.fundus + r.body), '頭低位で幽門前庭部が減り、胃底部＋胃体部が 50% 超',
          r.antPyl < r0.antPyl && r.fundus + r.body > 50);
      // ⑥ 台を水平に戻して第2斜位 25°、再び頭低位
      pathMove([[0, 180], [0, 155], [-30, 155]], dwell); pathShoot();
      r = anal(); add('5d', type, '⑥ 腹臥位第2斜位（頭低位）', '幽門前庭部の割合（%）', f1(r.antPyl), '5% 以下', r.antPyl <= 5);
      // ⑦ 台を水平に戻し、右回りに 360° 回転して第1斜位 45°、半臥位 25°
      pathMove([[0, 155], [0, -205], [0, -135], [25, -135]], dwell); rollCur = rollT = 225; pathShoot();
      let c = cardiaSubmerged(); add('8', type, '⑦ 腹臥位第1斜位（半臥位）', '噴門部が沈んでいる割合（%）', f1(c), '5% 以下', c <= 5);
      // ⑧ 水平で、腹臥位から左側臥位を経て背臥位、素早く右側臥位
      const rl = (() => { const t = tiltCur, ro = rollCur; const v = rightLateralRoll(); tiltCur = tiltT = t; rollCur = rollT = ro; return v; })();
      pathMove([[0, 225], [0, 180], [0, 90], [0, 0], [0, rl - 360]], dwell); rollCur = rollT = rl; pathShoot();
      c = cardiaSubmerged(); add('6', type, '⑧ 右側臥位', '噴門部が沈んでいる割合（%）', f1(c), '5% 以下', c <= 5);
      // ⑨ 水平で左右の交互体位変換（背臥位から左側臥位・右側臥位まで 1 回ずつ）、半臥位 25° で右側臥位から第2斜位へ
      pathMove([[0, 360], [0, 450], [0, 270], [25, 270], [25, 360 + r2]], dwell); pathShoot();
      r = anal(); add('7', type, '⑨ 半臥位第2斜位', '胃底部の割合（%）', f1(r.fundus), '5% 以下', r.fundus <= 5);
      // ⑩ 水平で背臥位から左右の交互体位変換をしたあと、軽い第2斜位（表の 45°）
      pathMove([[0, 360 + r2], [0, 360], [0, 450], [0, 270], [0, 360], [0, 315]], dwell); pathShoot();
      r = anal(); add('3', type, '⑩ 背臥位第2斜位（振り分け）', '胃底部／幽門前庭部／胃体部の割合（%）', f1(r.fundus) + '／' + f1(r.antPyl) + '／' + f1(r.body),
          '胃底部と幽門前庭部が 10% 以上、胃体部がその両方より少ない', r.fundus >= 10 && r.antPyl >= 10 && r.body < r.fundus && r.body < r.antPyl);
    }
  } finally { EVAL.type = saveType; }
  return out;
}
/* 基準撮影法Ⅱを教科書の順番と経路で通して計算し、各撮影の体位で、10 体位すべての目的部位の描出率を測る。
   経路は textbookPath と同じ（②〜⑩）。⑪ 立位第1斜位は、⑩ のあと水平で背臥位を経て第1斜位（45°）にし、台を立位まで起こす
   （本の経路の記載を確かめていないので仮の経路）。① と ⑫ は対象外（seqRows と同じ）。
   各体位で入れ直す evalPrepare と違い、前の体位から流れてきたバリウムと付着がそのまま残る。
   返り値：shots[k] = { name, tilt, roll, rates[j] }（j は seqRows の順の目的部位）。 */
function depictionPath(dwell) {
  const rows = seqRows(), T = rows.map(q => parseTarget(q.tgt)), shots = [];
  const shoot = name => { pathShoot(); buildSurface(); shots.push({ name, tilt: Math.round(tiltCur), roll: Math.round(((rollCur % 360) + 360) % 360), rates: T.map(t => depictionRate(t).rate) }); };
  evalPrepare(90, 45);
  const r2 = rollCardiaRightEdge() - 360;
  evalPrepare(90, 45); rollCur = rollT = 45; tiltCur = tiltT = 90;
  pathMove([[0, 45], [0, 0], [0, -1080]], dwell); rollCur = rollT = 0; shoot(rows[0].name);
  pathMove([[0, -360], [0, -325]], dwell); rollCur = rollT = 35; shoot(rows[1].name);
  pathMove([[0, 0], [0, -360], [0, -360 + r2], [-30, -360 + r2]], dwell); rollCur = rollT = 360 + r2; shoot(rows[2].name);
  pathMove([[0, 360 + r2], [0, 360], [0, 180]], dwell); rollCur = rollT = 180;
  pathMove([[25, 180], [-30, 180]], dwell); shoot(rows[3].name);
  pathMove([[0, 180], [0, 155], [-30, 155]], dwell); shoot(rows[4].name);
  pathMove([[0, 155], [0, -205], [0, -135], [25, -135]], dwell); rollCur = rollT = 225; shoot(rows[5].name);
  const rl = (() => { const t = tiltCur, ro = rollCur; const v = rightLateralRoll(); tiltCur = tiltT = t; rollCur = rollT = ro; return v; })();
  pathMove([[0, 225], [0, 180], [0, 90], [0, 0], [0, rl - 360]], dwell); rollCur = rollT = rl; shoot(rows[6].name);
  pathMove([[0, 360], [0, 450], [0, 270], [25, 270], [25, 360 + r2]], dwell); shoot(rows[7].name);
  pathMove([[0, 360 + r2], [0, 360], [0, 450], [0, 270], [0, 360], [0, 315]], dwell); shoot(rows[8].name);
  pathMove([[0, 315], [0, 360], [0, 405], [90, 405]], dwell); rollCur = rollT = 45; shoot(rows[9].name);
  return { targets: rows.map(q => q.tgt), shots };
}
const TB_HEAD = ['項目', '胃型', '体位', '起倒角', '回転角', '測ったもの', '値', '教科書の記載・基準', '判定', '計算を進めた秒数', '手順'];
function textbookCsv(rows) {
  return '﻿' + [TB_HEAD, ...rows.map(r => [r.no, TYPES[r.type].name, r.pose, r.tilt, r.roll, r.what, r.value, r.crit, r.judge, r.sec, r.proto])]
    .map(a => a.map(v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n') + '\r\n';
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
#evalPanel select{background:#0D161D; color:var(--text); border:1px solid var(--line2); border-radius:3px; padding:3px 5px; font:inherit}
#evalPanel .bad{border-color:#C0563A}
#evalPanel button{background:#13242F; color:var(--text); border:1px solid var(--line2); border-radius:3px; padding:5px 10px; font:inherit; cursor:pointer; margin-right:6px}
#evalPanel .row{display:flex; gap:14px; flex-wrap:wrap; align-items:center; margin:6px 0}
#evalPanel .row label{display:flex; gap:6px; align-items:center}
#evalMsg{color:var(--teal)}`;
document.head.appendChild(evalStyle);

const evalPanel = document.createElement('div'); evalPanel.id = 'evalPanel';
evalPanel.innerHTML = `
<h2>評価モード</h2>
<p>条件：胃型 下で選んだ型（既定は解剖モデル）、バリウム 150 mL（実寸。模型の単位では ${EVAL.ml.toFixed(1)}）、発泡剤 既定、圧迫なし、幽門閉。各体位で settle() のあと Δt = 1/60 秒で計算を進めてから測る。
定義は js/eval.js の先頭に書いてある。</p>
<p>目的部位の書き方：部位（${REGION_WORDS.join('・')}・${SUB_WORDS.join('・')}・穹窿部・体部・十二指腸）＋必要なら壁（${WALLS.join('・')}・${HALF_WALLS.join('・')}）。例「胃体部後壁」「胃角部〜前庭部後壁」「穹窿部・噴門部」。括弧書きは無視する。食道は対象外。</p>
<div class="row">
  <label>胃型<select id="evType"></select></label>
  <label>計算を進める秒数<input class="num" id="evSim" type="number" min="0" step="1"></label>
  <label>再現性の回数<input class="num" id="evRep" type="number" min="2" step="1"></label>
  <label>fps の計測秒数<input class="num" id="evFps" type="number" min="0" step="1"></label>
</div>
<table id="evIn"><thead><tr><th>体位名</th><th>起倒角</th><th>回転角</th><th>目的部位（ラベル名）</th><th></th></tr></thead><tbody></tbody></table>
<div class="row"><button type="button" id="evSeq1">基準撮影法Ⅰを読み込む</button><button type="button" id="evSeq2">基準撮影法Ⅱを読み込む</button>
<span>（data.js の撮影手順の表から。順序は日本消化器がん検診学会のマニュアル 表1-Ⅱ-1、目的部位と角度は「胃X線検診 上部消化管検査必携テキスト」pp.76-84）</span></div>
<div class="row"><button type="button" id="evAdd">行を足す</button><button type="button" id="evRun">評価する</button>
<button type="button" id="evCsv" disabled>CSV を保存</button><button type="button" id="evKok">国試の体位問題を評価</button><button type="button" id="evSweep">条件を振って評価</button><button type="button" id="evBook">教科書と比べる</button><button type="button" id="evBook2">解剖モデルで教科書と比べる</button><button type="button" id="evTwist">ねじれを求め直す</button><button type="button" id="evClose">閉じる</button><span id="evalMsg"></span></div>
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
for (const k of Object.keys(TYPES)) { const o = document.createElement('option'); o.value = k; o.textContent = TYPES[k].name; $e('evType').appendChild(o); }
$e('evType').value = TYPES[EVAL.type] ? EVAL.type : 'hook';
$e('evType').addEventListener('change', () => { EVAL.type = $e('evType').value; evalPersist(); });
$e('evSim').value = EVAL.simSec; $e('evRep').value = EVAL.repeat; $e('evFps').value = EVAL.fpsSec;
function evalPersist() {
  try { localStorage.setItem(EVAL_KEY, JSON.stringify({ rows: evalRows, p: { type: EVAL.type, simSec: EVAL.simSec, repeat: EVAL.repeat, fpsSec: EVAL.fpsSec } })); } catch (e) { }
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
function loadSeq(list, label) {   // 撮影手順の表の体位名・角度・目的部位をそのまま入れる（圧迫の行は印を付ける）
  evalRows = list.map((q, i) => ({ name: label + NOS[i] + ' ' + q.name + (q.comp ? '（圧迫：評価は圧迫なし）' : ''),
    tilt: String(q.tilt), roll: String(q.roll), target: q.etgt || q.tgt }));
  evalPersist(); drawInputs();
}
$e('evSeq1').addEventListener('click', () => loadSeq(SEQ1, 'Ⅰ'));
$e('evSeq2').addEventListener('click', () => loadSeq(SEQ2, 'Ⅱ'));
$e('evAdd').addEventListener('click', () => { evalRows.push({ name: '', tilt: '', roll: '', target: '' }); evalPersist(); drawInputs(); });
for (const [id, key] of [['evSim', 'simSec'], ['evRep', 'repeat'], ['evFps', 'fpsSec']])
  $e(id).addEventListener('input', () => { const v = +$e(id).value; if (v >= 0) { EVAL[key] = v; evalPersist(); } });

const CSV_HEAD = ['体位名', '起倒角', '回転角', '目的部位', '描出率(%)', '体積変動率(%)', '再現性(一致/不一致)', '描画時間(ms)',
  '平均fps', '体積変動率_モデル(%)', '液量_メッシュ(mL)', '液量_投与(mL)', '目的部位の面積(cm2)', '計算時間(ms)', '不一致の画素数',
  '胃型', '計算を進めた秒数', '再現性の回数', '目的部位の判定'];
let evalResults = [];
function resultRow(r) {
  const f = (x, d) => Number.isFinite(x) ? x.toFixed(d) : '';
  return [r.name, r.tilt, r.roll, r.target, f(r.rate, 2), f(r.dVol, 3), r.repro ? '一致' : '不一致', f(r.renderMs, 2),
    f(r.fps, 1), f(r.dVolModel, 5), f(r.vMesh, 2), f(r.vRef, 2), f(r.area, 2), f(r.simMs, 1), r.diffPx,
    TYPES[EVAL.type].name, EVAL.simSec, EVAL.repeat, r.targetOk ? '可' : '対象外（読めない言葉・食道など）'];
}
function drawResults() {
  const t = $e('evOut');
  t.innerHTML = '<thead><tr>' + CSV_HEAD.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
    evalResults.map(r => '<tr>' + resultRow(r).map(c => '<td>' + String(c).replace(/[<>&]/g, '') + '</td>').join('') + '</tr>').join('') + '</tbody>';
}
$e('evRun').addEventListener('click', async () => {
  const rows = evalRows.filter(r => r.tilt !== '' && r.roll !== '');
  if (!rows.length) { $e('evalMsg').textContent = '起倒角と回転角を入れた行がありません'; return; }
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
$e('evKok').addEventListener('click', async () => {
  renderer.setAnimationLoop(null);
  const saved = evalSave();
  $e('evalMsg').textContent = '国試の体位問題を評価中'; await nextFrame();
  let res = [];
  try { res = evalKokushi(); } finally { evalRestore(saved); last = performance.now(); renderer.setAnimationLoop(loop); }
  $e('evalMsg').textContent = '国試の体位問題：' + res.filter(r => r.hit).length + ' / ' + res.length + ' 問で正答と一致（' + TYPES[EVAL.type].name + '）';
  $e('evOut').innerHTML = '<thead><tr><th>問題</th><th>部位</th><th>選択肢ごとの描出率(%)</th><th>描出率で選んだ体位</th><th>正答</th><th>一致</th></tr></thead><tbody>' +
    res.map(r => '<tr><td>' + r.src + '</td><td>' + r.target + '</td><td>' + r.rates.map(([c, v]) => c + ' ' + v.toFixed(1)).join(' / ') +
      '</td><td>' + r.top.join('・') + '</td><td>' + r.ans.join('・') + '</td><td>' + (r.hit ? '一致' : '不一致') + '</td></tr>').join('') + '</tbody>';
});
$e('evSweep').addEventListener('click', async () => {
  renderer.setAnimationLoop(null);
  const saved = evalSave();
  let rows = [];
  try { rows = await sweepAll(['hook', 'horn', 'casc', 'ptos'], [60, 90, 120, 150, 180, 240], m => { $e('evalMsg').textContent = '条件を振って評価中：' + m; }); }
  finally { evalRestore(saved); last = performance.now(); renderer.setAnimationLoop(loop); }
  window.SWEEP_ROWS = rows;
  $e('evalMsg').textContent = '条件を振った評価：' + rows.length + ' 件。CSV を保存しました';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([sweepCsv(rows)], { type: 'text/csv' }));
  a.download = 'stomach_sweep.csv'; document.body.appendChild(a); a.click(); a.remove();
});
$e('evBook').addEventListener('click', async () => {
  renderer.setAnimationLoop(null);
  const saved = evalSave(), saveSec = EVAL.simSec, saveMl = EVAL.ml;
  let rows = [];
  EVAL.ml = 120;   // 手で作った 4 つの型の比較は、最初の計算（2026-10-27）と同じ模型の 120 mL で行う
  try {   // 決めた秒数（既定 10 秒）と 30 秒の 2 通りで計算し、秒数で判定が変わらないかを見る
    for (const sec of [saveSec, 30]) {
      EVAL.simSec = sec; $e('evalMsg').textContent = '教科書と比べています（' + sec + ' 秒）'; await nextFrame();
      rows = rows.concat(textbookCheck().map(r => ({ ...r, sec, proto: '各体位で入れ直し' })));
    }
    EVAL.simSec = saveSec;
    for (const dw of [0.1, 0.5, 2]) {   // 改良 2：教科書の経路で通して計算（1 段 5° あたりの時間を 3 通り）
      $e('evalMsg').textContent = '教科書の経路で計算しています（5° あたり ' + dw + ' 秒）'; await nextFrame();
      rows = rows.concat(textbookPath(dw).map(r => ({ ...r, sec: saveSec, proto: '教科書の経路 5°あたり' + dw + '秒' })));
    }
  } finally { EVAL.simSec = saveSec; EVAL.ml = saveMl; evalRestore(saved); last = performance.now(); renderer.setAnimationLoop(loop); }
  window.TEXTBOOK_ROWS = rows;
  const main = rows.filter(r => r.sec === saveSec && r.proto === '各体位で入れ直し' && r.judge !== '記載なし');
  $e('evalMsg').textContent = '教科書との比較：' + main.filter(r => r.judge === '一致').length + ' / ' + main.length + ' で一致。CSV を保存しました';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([textbookCsv(rows)], { type: 'text/csv' }));
  a.download = 'stomach_textbook.csv'; document.body.appendChild(a); a.click(); a.remove();
});
$e('evBook2').addEventListener('click', async () => {
  renderer.setAnimationLoop(null);
  const saved = evalSave(), saveTypes = TB_TYPES, saveMl = EVAL.ml, saveSec = EVAL.simSec, saveType = EVAL.type;
  let rows = [];
  try {
    EVAL.ml = 150 / Math.pow(BODY_SCALE, 3);   // バリウム 150 mL（実寸）
    TB_TYPES = ['bp3d'];                        // 解剖モデル（内腔 400 mL、体位によるねじれあり）
    for (const sec of [10, 30]) {
      EVAL.simSec = sec; $e('evalMsg').textContent = '解剖モデルで教科書と比べています（' + sec + ' 秒）'; await nextFrame();
      rows = rows.concat(textbookCheck().map(r => ({ ...r, sec, proto: '各体位で入れ直し' })));
      for (const dw of [0.1, 0.5, 2]) rows = rows.concat(textbookPath(dw).map(r => ({ ...r, sec, proto: '教科書の経路 5°あたり' + dw + '秒' })));
    }
  } finally { TB_TYPES = saveTypes; EVAL.ml = saveMl; EVAL.simSec = saveSec; EVAL.type = saveType; evalRestore(saved); last = performance.now(); renderer.setAnimationLoop(loop); }
  window.TEXTBOOK_BP3D_ROWS = rows;
  const main = rows.filter(r => r.sec === 10 && r.proto === '各体位で入れ直し' && r.judge !== '記載なし');
  $e('evalMsg').textContent = '解剖モデル：' + main.filter(r => r.judge === '一致').length + ' / ' + main.length + ' で一致（各体位で入れ直し、10 秒）。CSV を保存しました';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([textbookCsv(rows)], { type: 'text/csv' }));
  a.download = 'stomach_textbook_bp3d.csv'; document.body.appendChild(a); a.click(); a.remove();
});
$e('evTwist').addEventListener('click', async () => {   // 体位ごとのねじれを求め直す（data.js の twist と同じ値になるはず）
  renderer.setAnimationLoop(null);
  const saved = evalSave(), saveMl = EVAL.ml, saveType = EVAL.type, keep = TYPES.bp3d.twist;
  let res = [];
  try { EVAL.type = 'bp3d'; EVAL.ml = 150 / Math.pow(BODY_SCALE, 3); res = calibrateTwist(m => { $e('evalMsg').textContent = 'ねじれを探しています：' + m; }); }
  finally { const found = TYPES.bp3d.twist; TYPES.bp3d.twist = keep; window.TWIST_FOUND = found; EVAL.ml = saveMl; EVAL.type = saveType; evalRestore(saved); last = performance.now(); renderer.setAnimationLoop(loop); }
  $e('evalMsg').textContent = 'ねじれ：' + res.filter(r => r.ok).length + ' / ' + res.length + ' 体位で項目を満たす。' + JSON.stringify(window.TWIST_FOUND.map(k => [k.tilt, k.roll, k.ab]));
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
