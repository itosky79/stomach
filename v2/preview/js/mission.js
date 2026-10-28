"use strict";
/* ================= ミッション =================
   「前庭部後壁を二重造影せよ。体位変換は 3 回まで」のような課題を、制限時間と体位変換の回数の中で達成する。
   判定は評価モードと同じ描出率（measure.js の depictionRate）で、目的部位の描出率が基準以上の状態を MS_HOLD 秒続けたら達成。
   基準は、立位から画面と同じ動きで体位を変えて 10 秒待ったときの各体位の描出率を測り、
   正解の体位で届き、ほかの多くの体位では届かない値にした（2026-10-28、解剖モデル、バリウム 150 mL、ガス 250 mL）。
   開始の体位では、どのミッションも描出率は 0〜2%。正解の操作のあと、バリウムが流れ終わるまで十数秒かかる。
   前庭部前壁は順番で結果が変わる（腹臥位第2斜位→頭低位で 77%、頭低位→腹臥位第2斜位で 11%）。
   星：★ 達成、★★ 最少の体位変換で達成、★★★ さらに制限時間の半分以内で達成。 */
const MISSIONS = [
  { title: '前庭部後壁を二重造影せよ', target: '前庭部後壁', start: [90, 0], thr: 60, moves: 3, best: 1, time: 60,
    why: '背臥位では後壁が床側になる。前庭部のバリウムは背側の胃底部へ流れ去り，後壁に薄い膜が残ったところへガスが上から広がる（基準撮影法：背臥位正面位）。' },
  { title: '腹臥位から胃角部後壁を二重造影せよ', target: '胃角部後壁', start: [0, 180], thr: 55, moves: 3, best: 1, time: 60,
    why: '腹臥位では前壁が床側で，後壁は写らない。背臥位に戻すと後壁が床側になり，胃角部の後壁が二重造影される。' },
  { title: '前庭部前壁を二重造影せよ（順番に注意）', target: '前庭部前壁', start: [90, 0], thr: 50, moves: 3, best: 2, time: 90,
    why: '前壁を写すには腹臥位にする。先に腹臥位第2斜位まで回してから頭低位にすると，前庭部のバリウムが胃底部へ流れ去る。先に頭低位にしてから回すと，バリウムが前庭部に残ってしまう（基準撮影法：腹臥位にしてから頭低位，腹臥位第2斜位）。' },
  { title: '噴門部を二重造影せよ', target: '噴門部', start: [0, 0], thr: 40, moves: 3, best: 1, time: 90,
    why: '噴門部は胃の上部の背側にあり，背臥位ではバリウムに沈む。腹臥位第1斜位にするとバリウムが噴門部から離れ，前壁側が二重造影される（基準撮影法：腹臥位第1斜位）。' },
  { title: '胃体上部を二重造影せよ', target: '胃体上部', start: [0, 0], thr: 35, moves: 2, best: 1, time: 60,
    why: '立位にするとバリウムは胃の下部へ落ち，ガスが胃の上部に集まって胃体上部が広がる（基準撮影法：立位第1斜位）。' }
];
const MS_HOLD = 1.5;   // 秒
const MS_KEY = 'stomach.v2p.mission';
let msBest = {};
try { msBest = JSON.parse(localStorage.getItem(MS_KEY) || '{}'); } catch (e) { msBest = {}; }
let ms = null;   // 実行中のミッションの状態

const $m = id => document.getElementById(id);
const msTilt = $m('msTilt'), msRoll = $m('msRoll');
TILTS.forEach(([v, n]) => addOpt(msTilt, v, n, TILT_ICON[v], () => msMove(v, rollT)));
ROLLS.forEach(([v, n]) => addOpt(msRoll, v, n, rollIcon(v), () => msMove(tiltT, v)));

function msStars(n) { return '★'.repeat(n) + '☆'.repeat(3 - n); }
function msDrawList() {
  const box = $m('msList'); box.innerHTML = '';
  MISSIONS.forEach((M, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'act wide ms-item';
    b.innerHTML = '<span>' + (i + 1) + '. ' + M.title + '</span><small>体位変換 ' + M.moves + ' 回まで・' + M.time + ' 秒　' + msStars(msBest[i] || 0) + '</small>';
    b.addEventListener('click', () => msStart(i));
    box.appendChild(b);
  });
}
function msSync() {
  const r = ((rollT % 360) + 360) % 360;
  [...msTilt.children].forEach(b => b.setAttribute('aria-pressed', Math.abs(+b.dataset.v - tiltT) < 8));
  [...msRoll.children].forEach(b => b.setAttribute('aria-pressed', dAng(+b.dataset.v, r) < 8));
  $m('msPose').textContent = poseLabel(tiltT, rollT);
}
function msStart(i) {
  const M = MISSIONS[i];
  playing = false;
  tiltCur = tiltT = M.start[0]; rollCur = rollT = M.start[1];
  applyPose(); settle();
  ms = { i, M, t0: performance.now(), moves: 0, hold: 0, done: false, last: performance.now() };
  $m('msList').hidden = true; $m('msRun').hidden = false; $m('msResult').hidden = true;
  $m('msTitle').textContent = M.title;
  $m('msRule').textContent = '体位変換は ' + M.moves + ' 回まで。制限時間 ' + M.time + ' 秒。目的部位の描出率 ' + M.thr + '% 以上を ' + MS_HOLD + ' 秒保てば達成。';
  $m('msThr').style.left = M.thr + '%';
  msSync(); syncPose(); updateNotes();
}
function msMove(t, r) {
  if (!ms || ms.done) return;
  const same = Math.abs(t - tiltT) < 1 && dAng(r, ((rollT % 360) + 360) % 360) < 1;
  if (same) return;
  ms.moves++;
  goPose(t, r); msSync(); syncPose(); updateNotes();
  if (ms.moves > ms.M.moves) msEnd(false, '体位変換の回数（' + ms.M.moves + ' 回）を超えました。');
}
function msEnd(ok, msg) {
  ms.done = true;
  const sec = (performance.now() - ms.t0) / 1000;
  let stars = 0;
  if (ok) {
    stars = 1 + (ms.moves <= ms.M.best ? 1 : 0) + (ms.moves <= ms.M.best && sec <= ms.M.time / 2 ? 1 : 0);
    if (stars > (msBest[ms.i] || 0)) { msBest[ms.i] = stars; try { localStorage.setItem(MS_KEY, JSON.stringify(msBest)); } catch (e) { } }
  }
  $m('msResult').hidden = false;
  $m('msResult').className = 'ms-result ' + (ok ? 'ok' : 'ng');
  $m('msResultHead').textContent = ok ? '達成　' + msStars(stars) : '失敗';
  $m('msResultMsg').textContent = ok
    ? sec.toFixed(1) + ' 秒・体位変換 ' + ms.moves + ' 回（最少 ' + ms.M.best + ' 回）。' + ms.M.why
    : msg + ' ' + ms.M.why;
}
function msTick() {
  if (!ms || ms.done || curMode !== 4) return;
  const now = performance.now(), dt = (now - ms.last) / 1000; ms.last = now;
  const left = ms.M.time - (now - ms.t0) / 1000;
  $m('msTime').textContent = Math.max(0, left).toFixed(1) + ' 秒';
  $m('msMoves').textContent = '体位変換 ' + ms.moves + ' / ' + ms.M.moves;
  const rate = depictionRate(parseTarget(ms.M.target)).rate || 0;
  $m('msFill').style.width = Math.min(100, rate) + '%';
  $m('msRate').textContent = $m('msHint').checked ? rate.toFixed(0) + '%' : '―';
  $m('msMeter').classList.toggle('hide', !$m('msHint').checked);
  if (rate >= ms.M.thr) { ms.hold += dt; if (ms.hold >= MS_HOLD) return msEnd(true); } else ms.hold = 0;
  if (left <= 0) msEnd(false, '時間切れです。');
}
setInterval(msTick, 200);
$m('msBack').addEventListener('click', () => { ms = null; $m('msRun').hidden = true; $m('msList').hidden = false; msDrawList(); });
$m('msRetry').addEventListener('click', () => { if (ms) msStart(ms.i); });
msDrawList();
