"use strict";
/* ================= 学習：回転法（右回り回転法・左右交互法） =================
   台を水平にして、決まった順に体を回す。体の向き（rollT）を一定の速さで動かすだけで、
   バリウムの流れと壁への付き方は、いつもの流れの計算（sim.js）がそのまま決める。

   教科書（G：必携テキスト pp.76-84）に書いてあること
   - 右回り：背臥位正面位の前に、水平で右方向に 360° 回転を 3 回（p.77）。背臥位第1斜位・第2斜位、腹臥位第1斜位の前にも右回りに 360°（p.79、p.81）
   - 左右交互：半臥位第2斜位と背臥位第2斜位（振り分け）の前に、水平で左右の交互体位変換（pp.82-83）
   本に書いていないので、このアプリで決めたこと
   - 「右方向」は 背臥位 → 右側臥位 → 腹臥位 → 左側臥位 → 背臥位 の向き（回転角を減らす向き。評価モードと同じ）
   - 回る速さ：1 回転 5 秒（72°/秒）
   - 左右交互の振れ幅と回数：背臥位 → 左側臥位（90°）→ 右側臥位（−90°）→ 背臥位 を 1 往復（評価モードと同じ）
*/
const ROT_SPEED = 72;                 // °/秒
const ROT_SRC_G = '教科書：中谷・木曽・西川「実際の撮影」（『胃X線検診 上部消化管検査必携テキスト』ぱーそん書房 2022）';
const ROT_SRC_W = '技師の解説記事：「認定技師が教える胃バリウム検査！回転の意味、飲み方、コツ」（radiographica.com）';
const ROT_METHODS = [
  null,
  { name: '右回り回転法', n: 3,
    route: [[0, '背臥位'], [-90, '右側臥位'], [-180, '腹臥位'], [-270, '左側臥位'], [-360, '背臥位']],
    lead: '台を水平にして、背臥位から右へ 360° ずつ回ります。バリウムを胃の中で転がして、胃の壁全体に付けます。',
    book: '基準撮影法では、背臥位正面位を撮る前に右回りに 3 回まわります（p.77）。背臥位の第1斜位・第2斜位（p.79）や腹臥位第1斜位（p.81）の前にも 1 回まわります。',
    tip: '右側臥位で止まると、バリウムが十二指腸へ流れやすくなります。止まらずに回ります。',
    tipSrc: ROT_SRC_W,
    own: '回る速さは本に書いていないので、1 回転 5 秒にしました。「右へ」は、背臥位 → 右側臥位 → 腹臥位 → 左側臥位 → 背臥位 の向きにしました。' },
  { name: '左右交互法', n: 1,
    route: [[0, '背臥位'], [90, '左側臥位'], [-90, '右側臥位'], [0, '背臥位']],
    lead: '台を水平にして、背臥位から左右の側臥位へ、交互に体を傾けます。',
    book: '基準撮影法では、半臥位第2斜位と、背臥位第2斜位（振り分け）を撮る前に、水平で左右の交互体位変換をします（pp.82-83）。',
    tip: '', tipSrc: '',
    own: 'どこまで傾けるか・何回するかは本に書いていないので、左側臥位 → 右側臥位 → 背臥位 を 1 往復としました。速さは右回り回転法と同じ（90° を 1.25 秒）です。何のためにするかの説明は、確かめた資料に無かったので書いていません。' }
];

const ROT = { kind: 1, plan: null, i: 0, base: 0, lap: 0, step: 0, done: false, n: [0, 3, 1] };

const learnSeg = document.getElementById('learnSeg');
function setLearn(k) {
  rotStop();
  ROT.kind = k;
  [...learnSeg.children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.l === k));
  document.getElementById('learnPose').hidden = k !== 0;
  document.getElementById('learnRot').hidden = k === 0;
  if (k) rotBuild();
}
learnSeg.addEventListener('click', e => { const b = e.target.closest('button[data-l]'); if (b) setLearn(+b.dataset.l); });

function rotBuild() {
  const M = ROT_METHODS[ROT.kind];
  document.getElementById('rotLead').textContent = M.lead;
  document.getElementById('rotBook').textContent = M.book;
  const tip = document.getElementById('rotTip'); tip.hidden = !M.tip;
  tip.innerHTML = M.tip ? M.tip + '<span class="rotsrc">出典：' + M.tipSrc + '</span>' : '';
  document.getElementById('rotOwn').textContent = M.own;
  document.getElementById('rotSrc').textContent = '出典：' + ROT_SRC_G + (M.tipSrc ? '／' + M.tipSrc : '');
  const ol = document.getElementById('rotRoute'); ol.innerHTML = '';
  M.route.forEach(([, nm], i) => {
    if (i) { const a = document.createElement('li'); a.className = 'arw'; a.textContent = '→'; a.setAttribute('aria-hidden', 'true'); ol.appendChild(a); }
    const li = document.createElement('li'); li.className = 'stp'; li.textContent = nm; ol.appendChild(li);
  });
  const cnt = document.getElementById('rotCount');
  [...cnt.children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.n === ROT.n[ROT.kind]));
  rotShow();
}
document.getElementById('rotCount').addEventListener('click', e => {
  const b = e.target.closest('button[data-n]'); if (!b) return;
  ROT.n[ROT.kind] = +b.dataset.n; rotStop(); rotBuild();
});
document.getElementById('bRot').addEventListener('click', () => { if (ROT.plan) rotStop(); else rotStart(); });

function rotStart() {
  playing = false;
  const M = ROT_METHODS[ROT.kind];
  // まず水平・背臥位へ（台を倒しきってから回り始める）。そのあと、経路の点を順にたどる
  const plan = [{ tilt: 0, back: true }];
  for (let k = 0; k < ROT.n[ROT.kind]; k++)
    M.route.forEach(([r], i) => { if (i) plan.push({ roll: r + (ROT.kind === 1 ? -360 * k : 0), lap: k, step: i }); });   // 右回りは 1 回ごとに 360° ずつ先へ
  ROT.plan = plan; ROT.i = 0; ROT.lap = 0; ROT.step = 0; ROT.done = false;
  rotShow();
}
function rotStop() {
  if (!ROT.plan) return;
  ROT.plan = null; rollT = rollCur; rotShow();
}
// 1 コマごとに呼ぶ（main.js）。体の向きを一定の速さで目標へ動かす
function rotStep(dt) {
  if (!ROT.plan) return;
  const P = ROT.plan[ROT.i];
  if (P.back) {
    // 背臥位（回転角 0 の倍数）のいちばん近い向きへ。台を水平に倒す
    if (!P.started) { P.started = true; ROT.base = Math.round(rollCur / 360) * 360; tiltT = 0; }
    const d = ROT.base - rollT; rollT += Math.sign(d) * Math.min(Math.abs(d), ROT_SPEED * dt);
    if (Math.abs(tiltCur) < 0.05 && Math.abs(rollCur - ROT.base) < 1) ROT.i++;
  } else {
    const goal = ROT.base + P.roll;
    const d = goal - rollT; rollT += Math.sign(d) * Math.min(Math.abs(d), ROT_SPEED * dt);
    ROT.lap = P.lap; ROT.step = P.step;
    if (Math.abs(goal - rollCur) < 6) ROT.i++;    // 次の点へ（少し手前で切り替えて、止まらずに回る）
  }
  if (ROT.i >= ROT.plan.length) { ROT.plan = null; ROT.done = true; }
  ROT.ui = (ROT.ui || 0) + dt;
  if (ROT.ui > 0.1 || !ROT.plan) { ROT.ui = 0; updateNotes(); }   // 体位の名前と角度の表示（0.1 秒ごと）
  rotShow();
}
let rotLastTxt = '';
function rotShow() {
  const M = ROT_METHODS[ROT.kind]; if (!M) return;
  const run = !!ROT.plan, n = ROT.n[ROT.kind];
  const b = document.getElementById('bRot');
  b.textContent = run ? '止める' : (n > 1 ? n + ' 回 ' : '') + (ROT.kind === 1 ? '回す' : '左右に動かす');
  let cur = -1;
  if (run) cur = ROT.plan[ROT.i] && ROT.plan[ROT.i].back ? 0 : ROT.step;
  const lis = [...document.getElementById('rotRoute').querySelectorAll('.stp')];
  lis.forEach((li, i) => li.classList.toggle('on', run && i === cur));   // いま向かっている体位
  const txt = run ? (ROT.plan[ROT.i].back ? '台を水平にして、背臥位にしています' : (n > 1 ? (ROT.lap + 1) + ' 回目：' : '') + M.route[ROT.step][1] + 'へ')
                  : (ROT.done ? '終わりました。「3D + 透視」や「X線像」で、バリウムが付いた所を見てみましょう' : '');
  if (txt !== rotLastTxt) { document.getElementById('rotNow').textContent = txt; rotLastTxt = txt; }
}
setLearn(0);
