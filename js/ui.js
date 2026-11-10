"use strict";
/* ================= UI ================= */
// 頭低位は 2 種類（2026-11-10）：弱い頭低位 −30°（虎の巻 p.92 ④「弱めの頭低位」、資料 C・F の −30〜−45° の浅い端）、強い頭低位 −45°（虎の巻 p.93 ⑤⑥「最大 −45 度」）
const TILTS = [[90, '立位'], [45, '半立位'], [25, '半臥位'], [0, '水平'], [-25, '弱い頭低位'], [-30, '強い頭低位']];   // 立位 60〜90°、半立位 30〜60°、半臥位 1〜30°（必携テキスト p.76）
// 体軸回転のボタン（4 列 × 2 段）。上の段は背臥位の仲間（左上が正面位、右上が右側臥位）、下の段は腹臥位の仲間（左下が腹臥位、右下が左側臥位）
const ROLLS = [[0, '正面位'], [45, '第1斜位'], [315, '第2斜位'], [270, '右側臥位'],
               [180, '腹臥位'], [225, '腹臥位 第1斜位'], [135, '腹臥位 第2斜位'], [90, '左側臥位']];
const tiltGrid = document.getElementById('tiltGrid'), rollGrid = document.getElementById('rollGrid');
function addOpt(grid, v, label, svg, fn) {
  const b = document.createElement('button');
  b.className = 'opt'; b.type = 'button'; b.dataset.v = v;
  b.innerHTML = '<svg width="44" height="26" viewBox="0 0 44 26" fill="currentColor" stroke="currentColor" stroke-linecap="round" aria-hidden="true">' + svg + '</svg>' + label;
  b.addEventListener('click', fn);
  grid.appendChild(b);
}
TILTS.forEach(([v, n]) => addOpt(tiltGrid, v, n, TILT_ICON[v], () => { playing = false; goPose(v, rollT); syncFree(); updateNotes(); }));
ROLLS.forEach(([v, n]) => addOpt(rollGrid, v, n, rollIcon(v), () => { playing = false; goPose(tiltT, v); syncFree(); updateNotes(); }));

const dAng = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
function poseLabel(t, r) {                    // よく知られた別名があれば添える
  const n = poseName(t, r);
  // シャツキー位＝半立位第2斜位（radiological.site「上部消化管造影検査」、第74回 午後 第93問の解説）
  return n.startsWith('半立位第2斜位') ? n + '（シャツキー位）' : n;
}
function syncPose() {
  const r = ((rollT % 360) + 360) % 360;
  [...tiltGrid.children].forEach(b => b.setAttribute('aria-pressed', Math.abs(+b.dataset.v - tiltT) < 8));
  [...rollGrid.children].forEach(b => b.setAttribute('aria-pressed', dAng(+b.dataset.v, r) < 8));
  document.getElementById('poseNow').textContent = poseLabel(tiltT, rollT);
  document.getElementById('poseAng').textContent = Math.round(tiltT) + '° / ' + Math.round(r) + '°';
}

function setPreset(key) {
  curPose = key; playing = false;
  goPose(POSES[key].tilt, POSES[key].roll);
  syncFree(); updateNotes();
}
function setType(key) {
  curType = key;
  rebuildAll(); buildLabels(); settle(); fitCam(); layoutFilm(); updateNotes();
}

/* --- モードタブ --- */
const tabs = document.getElementById('modeTabs');
[...tabs.children].forEach(b => b.addEventListener('click', () => setMode(+b.dataset.m)));
function setMode(m) {
  curMode = m; playing = false;
  [...tabs.children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.m === m));
  for (let i = 0; i < 5; i++) document.getElementById('pane' + i).hidden = (i !== m);
  document.body.classList.toggle('quiz', m === 3);          // スマホでは問題タブだけ3Dを固定しない
  if (m === 1 && seqIdx < 0) gotoStep(0);
  if (m === 2) syncFree();
  if (m === 3) { if (EXAM.length && !curQ) showQ(0); else if (!EXAM.length) qView('empty'); }
  updateNotes();
}

/* --- 撮影手順 --- */
const seqList = document.getElementById('seqList'), seqSeg = document.getElementById('seqSeg');
function buildSeq() {
  seqList.innerHTML = '';
  SEQ.forEach((S, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button'; b.dataset.i = i;
    b.innerHTML = '<span class="no">' + (S.no || NOS[i]) + '</span><span>' + S.name + '<span class="tg2">' + S.tgt + '</span></span>';
    b.addEventListener('click', () => { playing = false; gotoStep(i); });
    li.appendChild(b); seqList.appendChild(li);
  });
}
buildSeq();
[...seqSeg.children].forEach(b => b.addEventListener('click', () => {
  [...seqSeg.children].forEach(x => x.setAttribute('aria-pressed', x === b));
  SEQ = SEQSET[+b.dataset.s]; playing = false; buildSeq(); gotoStep(0);
}));
function gotoStep(i) {
  const prevIdx = seqIdx;
  seqIdx = Math.max(0, Math.min(SEQ.length - 1, i));
  const S = SEQ[seqIdx];
  [...seqList.querySelectorAll('button')].forEach(b => {
    if (+b.dataset.i === seqIdx) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  // 1 つ先へ進むとき（次へ・順に再生）は、本に書いてある体位変換の経路をたどる（data.js の SEQ1_ROUTES・SEQ2_ROUTES）。番号で飛んだときはまっすぐその体位へ
  const R = (SEQ === SEQ2 ? SEQ2_ROUTES : SEQ === SEQ1 ? SEQ1_ROUTES : [])[seqIdx] || null, follow = R && seqIdx === prevIdx + 1;
  if (follow) seqPathStart(R); else goPose(S.tilt, S.roll);
  setComp(S.comp || '', S.comp ? 0.7 : 0);
  syncFree(); updateNotes();
}
document.getElementById('bPrev').addEventListener('click', () => { playing = false; gotoStep(seqIdx - 1); });
document.getElementById('bNext').addEventListener('click', () => { playing = false; gotoStep(seqIdx + 1); });
document.getElementById('bPlay').addEventListener('click', e => {
  playing = !playing; playT = 0;
  e.target.textContent = playing ? '一時停止' : '順に再生';
  if (playing && seqIdx < 0) gotoStep(0);
});

/* --- 操作卓：スティックとレバー --- */
const stick = document.getElementById('stick'), knob = document.getElementById('knob');
const lever = document.getElementById('lever'), lhandle = document.getElementById('lhandle');
const selComp = document.getElementById('selComp');
function knobTo(nx, ny) { knob.style.left = (50 + nx * 44) + '%'; knob.style.top = (50 - ny * 44) + '%'; }

/* ---- 国試に出た体位。スティックを合わせると何の問題で出たかを出す ---- */
const EXAMPOSE = [
  { t: 90, r:   0, n: '立位正面位',
    d: '立位圧迫で体部・胃角部・幽門前庭部・幽門部をみる。隆起や陥凹の形の観察に向く。',
    q: ['第72回 午前 第90問'] },
  { t: 45, r: 315, n: '半立位第2斜位（シャツキー位）',
    d: '噴門部・穹窿部の観察。基準撮影法Ⅱの⑨は、台を 30° 未満にした半臥位第2斜位で、角度が違う。',
    q: ['第74回 午後 第93問', '第71回 午前 第89問'] },
  { t:  0, r:   0, n: '背臥位正面位',
    d: '体部から幽門前部の後壁。二重造影の基本となる体位。',
    q: ['第76回 午後 第85問', '第73回 午前 第83問'] },
  { t:  0, r:  45, n: '背臥位第1斜位',
    d: '体部の大弯寄り後壁から幽門前部の小弯寄り後壁。十二指腸球部も見える。',
    q: ['第75回 午前 第91問'] },
  { t:  0, r: 180, n: '腹臥位正面位',
    d: '体中部から幽門前部の前壁。背臥位では撮れない面。',
    q: ['第65回 午後 第81問'] },
  { t:  0, r: 270, n: '右側臥位',
    d: '噴門部小弯を中心とした前後壁。幽門側が低くなりバリウムが十二指腸へ流れる。',
    q: ['第71回 午前 第89問'] },
  { t:  0, r:  90, n: '左側臥位',
    d: '胃底部が低くなる。腹部単純では遊離ガスの検出に使う。',
    q: ['第70回 午後 第88問'] },
  { t: 25, r: 225, n: '腹臥位第1斜位（半臥位）',
    d: '噴門部から胃上部（体上部と穹窿部）の前壁。基準撮影法Ⅰの⑤。',
    q: [] },
  { t:-30, r: 135, n: '腹臥位第2斜位（頭低位）',
    d: '体中部の大弯寄り前壁から幽門前部の小弯寄り前壁。基準撮影法Ⅱの⑥。',
    q: [] }
];
const epins = EXAMPOSE.map(e => {
  let r = ((e.r % 360) + 360) % 360; if (r > 180) r -= 360;
  const d = document.createElement('div');
  d.className = 'epin';
  d.style.left = (50 + (r / 180) * 44) + '%';
  d.style.top = (50 - (e.t / 90) * 44) + '%';
  stick.appendChild(d);
  return d;
});
const ePose = document.getElementById('ePose');
function syncExamPose() {
  const r = ((rollT % 360) + 360) % 360;
  let hit = -1;
  EXAMPOSE.forEach((e, i) => {
    const dr = Math.abs(((e.r - r) % 360 + 540) % 360 - 180);
    const on = Math.abs(e.t - tiltT) < 9 && dr < 9;
    epins[i].classList.toggle('hit', on);
    if (on && hit < 0) hit = i;
  });
  ePose.hidden = hit < 0;
  if (hit < 0) return;
  const e = EXAMPOSE[hit];
  document.getElementById('epName').textContent = e.n;
  document.getElementById('epDesc').textContent = e.d;
  document.getElementById('epQ').textContent = e.q.join('　/　');
  document.getElementById('epQ').hidden = !e.q.length;
  ePose.querySelector('.ep-h span').textContent = e.q.length ? '国試に出ています' : '基準撮影法の体位';
}
function syncFree() {
  let r = ((rollT % 360) + 360) % 360; if (r > 180) r -= 360;
  knobTo(r / 180, tiltT / 90);
  lhandle.style.top = (100 - compAmt * 100) + '%';
  document.getElementById('freePos').textContent = poseName(tiltT, rollT);
  document.getElementById('freeAng').textContent = Math.round(tiltT) + '° / ' + Math.round(((rollT % 360) + 360) % 360) + '°';
  syncExamPose();
}
function setFree(tilt, roll) {
  playing = false;
  tiltT = Math.max(-90, Math.min(90, tilt));   // 起倒は立位 +90° 〜 逆傾斜 −90°（DIMENSIONS.md）
  rollT = rollCur + (((roll - rollCur) % 360 + 540) % 360 - 180);
  syncFree(); updateNotes();
}
let sdrag = false;
function stickAt(e) {
  const b = stick.getBoundingClientRect();
  const nx = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width) * 2 - 1));
  const ny = Math.max(-1, Math.min(1, 1 - ((e.clientY - b.top) / b.height) * 2));
  setFree(ny * 90, nx * 180);
  knobTo(nx, ny);
}
function snap(v, list, tol) { for (const t of list) if (Math.abs(v - t) < tol) return t; return v; }
stick.addEventListener('pointerdown', e => { sdrag = true; stick.setPointerCapture(e.pointerId); stickAt(e); });
stick.addEventListener('pointermove', e => { if (sdrag) stickAt(e); });
stick.addEventListener('pointerup', () => {
  if (!sdrag) return; sdrag = false;
  let r = ((rollT % 360) + 360) % 360; if (r > 180) r -= 360;
  setFree(snap(tiltT, [-90, -30, 0, 45, 90], 7), snap(r, [-180, -135, -90, -45, 0, 45, 90, 135, 180], 9));
});
stick.addEventListener('pointercancel', () => { sdrag = false; });
stick.addEventListener('keydown', e => {
  const K = { ArrowUp: [5, 0], ArrowDown: [-5, 0], ArrowLeft: [0, -5], ArrowRight: [0, 5] }[e.key];
  if (!K) return;
  e.preventDefault();
  let r = ((rollT % 360) + 360) % 360; if (r > 180) r -= 360;
  setFree(tiltT + K[0], r + K[1]);
});
let ldrag = false;
function leverAt(e) {
  const b = lever.getBoundingClientRect();
  const v = Math.max(0, Math.min(1, 1 - (e.clientY - b.top) / b.height));
  if (v > 0.02 && !compRegion) { selComp.value = 'antrum'; }
  setComp(selComp.value, v);
}
lever.addEventListener('pointerdown', e => { ldrag = true; lever.setPointerCapture(e.pointerId); leverAt(e); });
lever.addEventListener('pointermove', e => { if (ldrag) leverAt(e); });
lever.addEventListener('pointerup', () => { ldrag = false; });
lever.addEventListener('pointercancel', () => { ldrag = false; });
selComp.addEventListener('change', () => setComp(selComp.value, selComp.value ? Math.max(compAmt, 0.65) : 0));
function setComp(region, amt) {
  const r2 = region || '', a2 = r2 ? amt : 0;
  if (r2 === compRegion && Math.abs(a2 - compAmt) < 0.004) return;
  compRegion = r2; compAmt = a2;
  selComp.value = r2;
  lhandle.style.top = (100 - a2 * 100) + '%';
  setCompAxis();
  rebuildAll();
}

/* --- 問題（過去問を貼り付けて使う）--- */
const QKEY = 'stomach.v2.exam';   // v1 と保存内容を分ける
let EXAM = [], qIdx = 0, curQ = null, qLocked = false;
const qText = document.getElementById('qText'), qChoices = document.getElementById('qChoices');
const qExp = document.getElementById('qExp'), qSrc = document.getElementById('qSrc');
const qEmpty = document.getElementById('qEmpty'), qBox = document.getElementById('qBox');
const qFig = document.getElementById('qFig'), qFigWrap = document.getElementById('qFigWrap');
const qFigBox = document.getElementById('qFigBox'), qAnns = document.getElementById('qAnns');
const bAnn = document.getElementById('bAnn'), lbBox = document.getElementById('lbBox');
const lbAnns = document.getElementById('lbAnns');
/* 図の上に置く解剖の名札。ann は [左からの%, 上からの%, 名前] の並び */
function annHTML(list) {
  return (list || []).map(a =>
    '<div class="ann' + (a[0] > 55 ? ' l' : '') + '" style="left:' + a[0] + '%;top:' + a[1] + '%">' +
    '<i></i><span>' + a[2] + '</span></div>').join('');
}
function showAnn(on) {
  qFigBox.classList.toggle('on', on);
  lbBox.classList.toggle('on', on);
  bAnn.setAttribute('aria-pressed', on ? 'true' : 'false');
  document.getElementById('qAnnNote').hidden = !on;
}
bAnn.addEventListener('click', e => { e.stopPropagation(); showAnn(!qFigBox.classList.contains('on')); });
const qBody = document.getElementById('qBody');
qFig.addEventListener('click', () => {
  if (!qFig.src) return;
  lbAnns.innerHTML = qAnns.innerHTML;
  document.getElementById('lbImg').src = qFig.src;
  document.getElementById('lbCap').textContent = (curQ && curQ.src) ? curQ.src : '';
  document.getElementById('lightbox').classList.add('on');
});
const qImport = document.getElementById('qImport'), qPaste = document.getElementById('qPaste');
const TYPEBYNAME = { '鉤状胃': 'hook', '牛角胃': 'horn', '瀑状胃': 'casc', '下垂胃': 'ptos' };

function parseExam(txt) {
  const out = [];
  //  先頭に「第75回 午前」のような見出しがあれば、全問の出典の接頭辞にする
  let head = '';
  txt = txt.replace(/^[ \t]*(第\s*\d+\s*回[^\n]*?(?:午前|午後))[ \t]*$/m, (m0, m1) => { head = m1.replace(/\s+/g, ' ').trim(); return ''; });
  txt.split(/^[ \t]*-{3,}[ \t]*$/m).forEach(block => {
    const q = { c: [] };
    let m;
    block.split(/\r?\n/).forEach(line => {
      const t = line.trim(); if (!t) return;
      if ((m = t.match(/^出典[:：]\s*(.+)$/))) q.src = m[1];
      else if ((m = t.match(/^問題[:：]\s*(.+)$/))) q.q = m[1];
      else if ((m = t.match(/^問題\s*(\d+)[ \t.、．]*(.*)$/))) { q.no = m[1]; if (m[2]) q.q = m[2]; }
      else if ((m = t.match(/^([1-9])\s*[.:：)、]\s*(.+)$/))) q.c.push(m[2]);
      else if ((m = t.match(/^(?:答え|解答|正解)[:：]?\s*([1-9][\s,，、・]*[1-9]?[\s,，、・]*[1-9]?)/))) q.a = m[1].split(/[^1-9]+/).filter(Boolean).map(Number);
      else if ((m = t.match(/^解説[:：]\s*(.+)$/))) q.e = m[1];
      else if ((m = t.match(/^体位[:：]\s*(-?\d+)\s*[,，]\s*(-?\d+)/))) q.set = [+m[1], +m[2]];
      else if ((m = t.match(/^胃型[:：]\s*(\S+)/))) q.type = TYPEBYNAME[m[1]] || m[1];
      else if (!q.q) q.q = t;
    });
    if (!q.src && q.no) q.src = (head ? head + ' ' : '') + '問題' + q.no;
    else if (!q.src && head) q.src = head;
    if (q.q && q.c.length >= 2 && q.a && q.a.length && q.a.every(x => x >= 1 && x <= q.c.length)) out.push(q);
  });
  return out;
}
function saveExam() { try { localStorage.setItem(QKEY, JSON.stringify(EXAM)); } catch (e) { } }
function shuffle(a) {                       // 出題順は開くたびに入れ替える
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function loadExam() {
  EXAM = EXAM_DEFAULT.slice();
  try { const v = localStorage.getItem(QKEY); const j = v && JSON.parse(v); if (j && j.length) EXAM = j; } catch (e) { }
  shuffle(EXAM);
}
function qView(which) {
  qEmpty.hidden = which !== 'empty'; qBox.hidden = which !== 'quiz'; qImport.hidden = which !== 'import';
}
/* 出典：「第76回 午後 第85問」→「第76回 診療放射線技師国家試験 午後 第85問（厚生労働省 公表の問題・正答）」 */
function srcFull(src) {
  const m = /^第(\d+)回\s*(午前|午後)\s*第(\d+)問$/.exec(src);
  return m ? '第' + m[1] + '回 診療放射線技師国家試験 ' + m[2] + ' 第' + m[3] + '問（厚生労働省 公表の問題・正答）' : src;
}
function showQ(i) {
  if (!EXAM.length) { qView('empty'); return; }
  qIdx = (i + EXAM.length) % EXAM.length;
  curQ = EXAM[qIdx];
  document.getElementById('qNo').textContent = '問 ' + (qIdx + 1) + ' / ' + EXAM.length;
  if (curQ.type && TYPES[curQ.type] && curQ.type !== curType) setType(curQ.type);
  if (curQ.set) goPose(curQ.set[0], curQ.set[1]);
  setComp('', 0); syncFree();
  renderQ();
}
let picked = [];
function renderQ() {
  qLocked = false; picked = []; qView('quiz');
  qText.textContent = curQ.q;
  qSrc.innerHTML = curQ.src ? '<b>出典</b> ' + srcFull(curQ.src) : '';
  qFigWrap.hidden = !curQ.img;
  if (curQ.img) qFig.src = curQ.img; else qFig.removeAttribute('src');
  qAnns.innerHTML = annHTML(curQ.ann);
  bAnn.hidden = !(curQ.ann && curQ.ann.length);
  showAnn(false);                      // 答えるまでは伏せておく
  qBody.classList.toggle('wide', !!curQ.img && rail.clientWidth >= 540);
  qExp.hidden = true; qExp.textContent = curQ.e || '';
  qChoices.innerHTML = '';
  curQ.c.forEach((t, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button'); b.type = 'button';
    b.innerHTML = '<span class="n">' + (i + 1) + '</span><span>' + t + '</span>';
    b.addEventListener('click', () => answerQ(i));
    li.appendChild(b); qChoices.appendChild(li);
  });
}
function answerQ(i) {
  if (qLocked) return;
  const btns = [...qChoices.querySelectorAll('button')];
  const need = curQ.a.length;
  if (need > 1) {                       // 「2つ選べ」は必要数そろうまで選択を続ける
    const k = picked.indexOf(i);
    if (k >= 0) picked.splice(k, 1); else picked.push(i);
    btns.forEach((b, j) => b.classList.toggle('sel', picked.indexOf(j) >= 0));
    if (picked.length < need) return;
  } else picked = [i];
  qLocked = true;
  btns.forEach((b, j) => {
    b.disabled = true; b.classList.remove('sel');
    if (curQ.a.indexOf(j + 1) >= 0) b.classList.add('ok');
    else if (picked.indexOf(j) >= 0) b.classList.add('ng');
  });
  if (curQ.e) qExp.hidden = false;
  if (curQ.ann && curQ.ann.length) showAnn(true);   // 答えたら名前を出す
  if (curQ.set) goPose(curQ.set[0], curQ.set[1]);
}
document.getElementById('bQPrev').addEventListener('click', () => showQ(qIdx - 1));
document.getElementById('bQNext').addEventListener('click', () => showQ(qIdx + 1));
const openImport = () => { qPaste.value = ''; qView('import'); qPaste.focus(); };
document.getElementById('bLoadOpen').addEventListener('click', openImport);
document.getElementById('bLoadOpen2').addEventListener('click', openImport);
document.getElementById('bImportCancel').addEventListener('click', () => { qView(EXAM.length ? 'quiz' : 'empty'); });
document.getElementById('bRestore').addEventListener('click', () => {
  try { localStorage.removeItem(QKEY); } catch (e) { }
  EXAM = shuffle(EXAM_DEFAULT.slice()); showQ(0);
});
document.getElementById('bImport').addEventListener('click', () => {
  const got = parseExam(qPaste.value);
  if (!got.length) { qPaste.value = '読み取れませんでした。書式を確認してください。\n\n' + qPaste.value; return; }
  EXAM = got; saveExam(); shuffle(EXAM); showQ(0);
});
document.getElementById('bReadQ').addEventListener('click', () => {
  const keys = POSE_ORDER.slice();
  const ans = keys[Math.floor(Math.random() * keys.length)];
  const others = keys.filter(k => k !== ans).sort(() => Math.random() - 0.5).slice(0, 4);
  const cs = [ans].concat(others).sort(() => Math.random() - 0.5);
  curQ = { q: '表示されている透視像の体位はどれか。', c: cs.map(k => POSES[k].name), a: [cs.indexOf(ans) + 1],
           src: '読影練習（シミュレーターの生成像／国家試験の問題ではありません）', img: null, set: null,
           e: POSES[ans].name + '。' + POSES[ans].lead.replace(/<\/?em>/g, '') };
  document.getElementById('qNo').textContent = '読影練習';
  goPose(POSES[ans].tilt, POSES[ans].roll);
  setComp('', 0); syncFree();
  viewMode = 2; syncViewSeg(); layoutFilm();
  renderQ();
});

/* --- 共通 --- */
const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('change', e => fn(e.target.checked)); };   // 古いキャッシュとの食い違いで要素がなくても止めない
bind('tBone', v => { showBone = v; });
bind('tPyl', v => { pylorusOpen = v; rebuildAll(); });
{ // 胃の中身：バリウム（120〜150 mL）と発泡剤のガス（100〜400 mL）。胃の大きさは合計に合わせる（model.js の rebuild）
  const S3 = Math.pow(BODY_SCALE, 3), rBa = document.getElementById('rBa'), rGas = document.getElementById('rGas');
  rBa.addEventListener('input', () => { targetMl = +rBa.value / S3; document.getElementById('oBa').textContent = rBa.value + ' mL'; rebuildAll(); buildLabels(); });
  rGas.addEventListener('input', () => { gasMl = +rGas.value; document.getElementById('oGas').textContent = rGas.value + ' mL'; rebuildAll(); buildLabels(); });
}
{ // バリウムの性質：濃度（w/v%）・粘度・降伏値。壁に残る膜の厚さと流れ落ち方が変わる（sim.js の updateWet）
  const B = [['rBaC', 'oBaC', 'C', v => v + ' w/v%'], ['rBaMu', 'oBaMu', 'mu', v => v + ' mPa·s'], ['rBaTy', 'oBaTy', 'ty', v => (+v).toFixed(2) + ' Pa']];
  for (const [r, o, k, f] of B) {
    const el = document.getElementById(r);
    el.addEventListener('input', () => { BA[k] = +el.value; document.getElementById(o).textContent = f(el.value); });
  }
}
// 膜のようす（0.5 秒ごと）：液面より上の胃の壁の、膜の厚さの中央値と、粘液が取れた割合
setInterval(() => {
  const el = document.getElementById('baInfo'); if (!el || el.offsetParent === null) return;
  const hs = [], ms = [];
  for (let v = 0; v < NMAIN * CM; v++) if (hArr[v] > aLevel[v] && regionList[regionOf[(v / CM) | 0]][0] !== 'duode') { hs.push(filmH[v]); ms.push(mucus[v]); }
  if (!hs.length) { el.textContent = ''; return; }
  hs.sort((a, b) => a - b); const med = hs[hs.length >> 1] * 1e6;
  const wash = 1 - ms.reduce((a, b) => a + b, 0) / ms.length;
  el.textContent = '液面より上の壁の膜：厚さ（中央値）' + med.toFixed(0) + ' µm／粘液が取れた割合 ' + Math.round(wash * 100) + ' %／バリウムの密度 ' + (baRho() / 1000).toFixed(2) + ' g/mL';
}, 500);
document.getElementById('bDrink').addEventListener('click', () => {
  for (let n = 0; n < NN; n++) wVol[n] = 0;
  for (let i = 0; i < NV; i++) { aWet[i] = 0; aLevel[i] = -1e3; }
  resetFilm(() => false, 1);   // 飲み直し：膜なし、粘液は全部残る
  administered = 0; drained = 0;
});
document.getElementById('bClear').addEventListener('click', () => { films = []; shotCount = 0; renderStrip(); });
document.getElementById('bShot').addEventListener('click', capture);
const viewSeg = document.getElementById('viewSeg');
function syncViewSeg() { [...viewSeg.children].forEach(x => x.setAttribute('aria-pressed', +x.dataset.v === viewMode)); }
[...viewSeg.children].forEach(b => b.addEventListener('click', () => { viewMode = +b.dataset.v; syncViewSeg(); layoutFilm(); }));
const labSeg = document.getElementById('labSeg');
[...labSeg.children].forEach(b => b.addEventListener('click', () => {
  labelMode = +b.dataset.l;
  [...labSeg.children].forEach(x => x.setAttribute('aria-pressed', +x.dataset.l === labelMode));
}));
/* --- コンソールの幅とドッキング --- */
const rail = document.getElementById('rail'), split = document.getElementById('split');
const railbar = document.getElementById('railbar'), bDetach = document.getElementById('bDetach');
const RKEY = 'stomach.v2.rail';
let rst = { w: 322, det: false, x: 0, y: 0, pw: 330, ph: 480 };
try { Object.assign(rst, JSON.parse(localStorage.getItem(RKEY) || '{}')); } catch (e) { }
function saveRail() { try { localStorage.setItem(RKEY, JSON.stringify(rst)); } catch (e) { } }
const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;
function railMax() {                 // 3Dが必ず残るようにコンソールの上限幅を決める
  const wk = document.querySelector('.work').getBoundingClientRect().width || innerWidth;
  return Math.max(250, Math.min(620, Math.round(wk * 0.55)));
}
function applyRail() {
  // 画面が狭いときはツマミ（結合ボタン）が隠れて戻せなくなるので、必ず結合しておく
  const det = !!rst.det && innerWidth > 900;
  rst.w = num(rst.w, 322);
  document.documentElement.style.setProperty('--railw', Math.max(250, Math.min(rst.w, railMax())) + 'px');
  document.body.classList.toggle('detached', det);
  bDetach.textContent = det ? '結合' : '分離';
  if (det) {
    rst.pw = Math.max(250, Math.min(num(rst.pw, 330), Math.round(innerWidth * 0.55)));
    rst.ph = Math.max(220, Math.min(num(rst.ph, 480), Math.round(innerHeight * 0.78)));
    rail.style.width = rst.pw + 'px'; rail.style.height = rst.ph + 'px';
    rail.style.left = Math.min(Math.max(8, num(rst.x, 0)), Math.max(8, innerWidth - rst.pw - 8)) + 'px';
    rail.style.top = Math.min(Math.max(8, num(rst.y, 0)), Math.max(8, innerHeight - 80)) + 'px';
  } else {
    // 浮かせている間に resize で付いたインラインの寸法を必ず捨てる
    rail.style.width = rail.style.height = rail.style.left = rail.style.top = '';
  }
  resize();
}
addEventListener('resize', applyRail);
let sdragging = false;
split.addEventListener('pointerdown', e => { sdragging = true; split.setPointerCapture(e.pointerId); e.preventDefault(); });
split.addEventListener('pointermove', e => {
  if (!sdragging) return;
  const r = document.querySelector('.work').getBoundingClientRect();
  rst.w = Math.round(Math.max(250, Math.min(railMax(), r.right - e.clientX - 4)));
  applyRail();
});
split.addEventListener('pointerup', () => { if (sdragging) { sdragging = false; saveRail(); } });
split.addEventListener('keydown', e => {
  const d = e.key === 'ArrowLeft' ? 20 : e.key === 'ArrowRight' ? -20 : 0;
  if (!d) return; e.preventDefault();
  rst.w = Math.max(250, Math.min(railMax(), rst.w + d)); applyRail(); saveRail();
});
bDetach.addEventListener('click', () => {
  if (!rst.det) {                      // 分離：現在の見た目に近い大きさで浮かせる
    const r = rail.getBoundingClientRect(), st = stage.getBoundingClientRect();
    rst.pw = Math.round(Math.min(r.width || 330, 420));
    rst.ph = Math.round(Math.min(Math.max(r.height || 480, 300), innerHeight * 0.85));
    rst.x = Math.max(8, Math.round(st.right - rst.pw - 10));
    rst.y = Math.max(8, Math.round(st.top + 10));
  }
  rst.det = !rst.det;
  applyRail(); saveRail();
});
let rdrag = null;
railbar.addEventListener('pointerdown', e => {
  if (!rst.det || e.target === bDetach) return;
  rdrag = { dx: e.clientX - rail.getBoundingClientRect().left, dy: e.clientY - rail.getBoundingClientRect().top };
  railbar.setPointerCapture(e.pointerId); e.preventDefault();
});
railbar.addEventListener('pointermove', e => {
  if (!rdrag) return;
  rst.x = e.clientX - rdrag.dx; rst.y = e.clientY - rdrag.dy; applyRail();
});
railbar.addEventListener('pointerup', () => { if (rdrag) { rdrag = null; saveRail(); } });
new ResizeObserver(() => {          // 浮かせたパネルの手動リサイズを覚える
  if (!rst.det) return;
  const r = rail.getBoundingClientRect();
  if (Math.abs(r.width - rst.pw) > 1 || Math.abs(r.height - rst.ph) > 1) {
    rst.pw = Math.round(r.width); rst.ph = Math.round(r.height); saveRail();
  }
}).observe(rail);

/* ---- 開くたびに出す操作案内。端末に合わせて中身を変える ---- */
{
  const touch = matchMedia('(pointer:coarse)').matches || innerWidth <= 900;
  const gd = document.getElementById('guide');
  document.getElementById('gTip').innerHTML = touch
    ? '<b>1 本指でドラッグ</b>すると回ります。<br>2 本指で拡大縮小、ダブルタップで視点が戻ります。'
    : '<b>ドラッグ</b>すると回ります。<br>ホイールで拡大縮小、ダブルクリックで視点が戻ります。';
  const openGuide = () => gd.classList.add('on');
  const closeGuide = () => gd.classList.remove('on');
  document.getElementById('gClose').addEventListener('click', closeGuide);
  gd.addEventListener('click', e => { if (e.target === gd) closeGuide(); });
  document.getElementById('bGuide').addEventListener('click', openGuide);
  openGuide();
}

const lb = document.getElementById('lightbox');
document.getElementById('lbClose').addEventListener('click', () => lb.classList.remove('on'));
lb.addEventListener('click', e => { if (e.target === lb) lb.classList.remove('on'); });
addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  const gd = document.getElementById('guide');
  if (gd.classList.contains('on')) { document.getElementById('gClose').click(); return; }
  if (lb.classList.contains('on')) { lb.classList.remove('on'); return; }
  if (rst.det) { rst.det = false; applyRail(); saveRail(); }
});

/* ================= 学習：回転法（右回り回転変換法・左右交互変換法） =================
   台を水平にして、決まった順に体を回す。体の向き（rollT）を一定の速さで動かすだけで、
   バリウムの流れと壁への付き方は、いつもの流れの計算（sim.js）がそのまま決める。

   本に書いてあること
   - O：『胃癌をしっかり表そう！ 胃X線撮影法 虎の巻』第3章 2「基準撮影法の実際」pp.91-96（名前はこの本に合わせた）
     - 右回り回転変換法：背臥位正面位の前に 3 回転ほど。回ったあと胃の中の洗浄・付着の状態を透視ですばやく確かめ、
       洗浄不足で泡が残っていれば体位変換を足す（p.91）。背臥位第一斜位・頭低位第二斜位・腹臥位第一斜位の前に 1 回転ずつ足す（pp.92, 94）。
       腹臥位正面位へは水平位で右回り（p.93）
     - 左右交互変換法：半臥位第二斜位の前に、水平位で数回しながら透視で観察し、異常所見の有無を確かめる（p.95）。
       背臥位第二斜位（振り分け）の前にもして、バリウムを U 領域と L 領域にできるだけ均等に振り分ける。
       後半をゆっくりめにすると流れを観察しやすく、異常所見に気づきやすい（p.95）
   - G：必携テキスト pp.77-83 も同じ順番（右方向に 360° を 3 回、左右の交互体位変換）
   本に書いていないので、このアプリで決めたこと
   - 「右回り」は 背臥位 → 右側臥位 → 腹臥位 → 左側臥位 → 背臥位 の向き（回転角を減らす向き。評価モードと同じ）
   - 回る速さ：1 回転 5 秒（72°/秒）
   - 左右交互の振れ幅：左右の側臥位まで。「数回」は 3 回。「後半はゆっくりめ」は、後ろ半分の往復を半分の速さにする
*/
const ROT_SPEED = 72;                 // °/秒
const ROT_SRC_O = '『胃癌をしっかり表そう！ 胃X線撮影法 虎の巻』第3章 2「基準撮影法の実際」';
const ROT_SRC_G = '中谷・木曽・西川「実際の撮影」（『胃X線検診 上部消化管検査必携テキスト』ぱーそん書房 2022）';
const ROT_SRC_W = '技師の解説記事：「認定技師が教える胃バリウム検査！回転の意味、飲み方、コツ」（radiographica.com）';
const ROT_METHODS = [
  null,
  { name: '右回り回転変換法', n: 3,
    route: [[0, '背臥位'], [-90, '右側臥位'], [-180, '腹臥位'], [-270, '左側臥位'], [-360, '背臥位']],
    lead: '台を水平にして、背臥位から右へ 360° ずつ回ります。バリウムで胃の中を洗い、壁全体に付けます。',
    book: '背臥位正面位を撮る前に 3 回転ほど回ります。回ったあと、胃の中の洗浄・付着の状態を透視ですばやく確かめ、洗浄不足で泡が残っていれば体位変換を足します（虎の巻 p.91）。背臥位第一斜位・頭低位第二斜位・腹臥位第一斜位の前にも 1 回転ずつ足します（pp.92, 94）。必携テキストも同じです（pp.77, 79, 81）。',
    tip: '右側臥位で止まると、バリウムが十二指腸へ流れやすくなります。止まらずに回ります。',
    tipSrc: ROT_SRC_W,
    own: '回る速さは本に書いていないので、1 回転 5 秒にしました。「右回り」は、背臥位 → 右側臥位 → 腹臥位 → 左側臥位 → 背臥位 の向きにしました。' },
  { name: '左右交互変換法', n: 3,
    route: [[0, '背臥位'], [90, '左側臥位'], [-90, '右側臥位'], [0, '背臥位']],
    lead: '台を水平にして、背臥位から左右の側臥位へ、交互に体を傾けます。バリウムを左右に流して、透視で見ます。',
    book: '半臥位第二斜位の前に、水平位で数回しながら透視で観察し、異常所見がないかを確かめます。背臥位第二斜位（振り分け）の前にもして、バリウムを U 領域と L 領域にできるだけ均等に振り分けます。後半をゆっくりめにすると、バリウムの流れを観察しやすく、異常所見に気づきやすくなります（虎の巻 p.95）。必携テキストにも同じ順番があります（pp.82-83）。',
    tip: '', tipSrc: '',
    own: 'どこまで傾けるかは本に書いていないので、左右の側臥位までにしました。「数回」は 3 回にしました。「後半はゆっくりめ」は、後ろ半分の往復を半分の速さ（90° を 2.5 秒）にしました。' }
];

const ROT = { kind: 1, plan: null, i: 0, base: 0, lap: 0, step: 0, done: false, n: [0, 3, 3] };

// 学習タブの「起倒角」「体軸の回転」の下にある「回転法」。2 つの方法を切り替える
const rotSeg = document.getElementById('rotSeg');
function setRotKind(k) {
  rotStop();
  ROT.kind = k;
  [...rotSeg.children].forEach(b => b.setAttribute('aria-pressed', +b.dataset.k === k));
  rotBuild();
}
rotSeg.addEventListener('click', e => { const b = e.target.closest('button[data-k]'); if (b) setRotKind(+b.dataset.k); });

function rotBuild() {
  const M = ROT_METHODS[ROT.kind];
  document.getElementById('rotLead').textContent = M.lead;
  document.getElementById('rotBook').textContent = M.book;
  const tip = document.getElementById('rotTip'); tip.hidden = !M.tip;
  tip.innerHTML = M.tip ? M.tip + '<span class="rotsrc">出典：' + M.tipSrc + '</span>' : '';
  document.getElementById('rotOwn').textContent = M.own;
  document.getElementById('rotSrc').textContent = '出典：' + ROT_SRC_O + '／' + ROT_SRC_G + (M.tipSrc ? '／' + M.tipSrc : '');
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

/* 回転の動かし方（回転法・手順の経路で共通）：人が台の上で寝返りを打つような、つながった動きにする。
   経路の点を、同じ向きに続けて回る区間にまとめ、区間の中は止まらずに回る（側臥位・腹臥位で止めない）。
   - 速さは体の向きで滑らかに変える：起き上がる側（背臥位・腹臥位 → 側臥位）は遅く、倒れる側（側臥位 → 背臥位・腹臥位）は速い。
     速さ ＝ 基本の速さ × (1 − ROLL_B × 向き × sin 2θ) × (1 − ROLL_P × (1 − cos θ) ÷ 2)（θ は回転角。後ろの項は腹臥位のあたりを少し遅くする：腕で押し上げる分）
   - 動き出しは加速度 ROLL_ACC で少しずつ速くし、止まる前は同じ加速度で少しずつ遅くする（急に動いたり止まったりしない）
   - 速さが変わるときも加速度の範囲で変える（速さが急に跳ばない）
   値は一般的な寝返りの速さを想定した仮の値（実測や動画から測ったものではない）。「ゆっくり」は基本の速さが半分。
   向きが変わる所（左右交互の折り返し）や起倒角が変わる所で区間を分けるので、そこでは滑らかに止まってから次へ。
   wps：[{ tilt, roll（ぐるっと回る分も含めた角度）, slow }]。起倒は台の動き（main.js）にまかせ、区間の終わりで台が着くのを待つ */
const ROLL_V = 78, ROLL_B = 0.35, ROLL_P = 0.15, ROLL_ACC = 110;   // 基本の速さ °/秒、起き上がり／倒れの差、腹臥位で遅くする割合、加速度 °/秒²
function rollSpeed(th, dir, slow) {
  const r = th * Math.PI / 180;
  return ROLL_V * (slow ? 0.5 : 1) * (1 - ROLL_B * dir * Math.sin(2 * r)) * (1 - ROLL_P * (1 - Math.cos(r)) / 2);
}
function motionBuild(wps, r0) {
  const segs = []; let cur = r0, sg = null;
  wps.forEach((w, i) => {
    const dir = Math.sign(w.roll - cur);
    if (sg && dir !== 0 && dir === sg.dir && w.tilt === sg.tilt && !!w.slow === sg.slow) { sg.r1 = w.roll; sg.last = i; }
    else { sg = { tilt: w.tilt, r0: cur, r1: w.roll, dir, slow: !!w.slow, first: i, last: i }; segs.push(sg); }
    cur = w.roll;
  });
  // 横や腹臥位を通る区間は、回り始める前に腕を挙げきる（腕が急に跳ね上がらないように。sim.js の updateArms）
  for (const g of segs) { g.arms = 0; for (let i = g.first; i <= g.last; i++) g.arms = Math.max(g.arms, armAngle(wps[i].tilt, wps[i].roll)); }
  return { wps, segs, si: 0, th: r0, v: 0, wi: 0 };
}
// 1 コマ進める。終わったら false。M.wi は、いま向かっている経路の点
function motionStep(M, dt) {
  const g = M.segs[M.si]; if (!g) return false;
  tiltT = g.tilt;
  rollDriven = true;                                     // main.js：体の向きを rollT にそのまま合わせる
  if (M.segStart !== M.si) { M.segStart = M.si; M.th = g.r0; M.v = 0; }
  const rem = (g.r1 - M.th) * g.dir;
  const waitArms = M.v === 0 && g.arms > 0.05 && armCur < 0.9 * g.arms;   // 腕を挙げている途中は、まだ回り始めない
  if (rem > 0.02 && !waitArms) {
    const want = Math.min(rollSpeed(M.th, g.dir, g.slow), Math.sqrt(2 * ROLL_ACC * rem));   // 止まる前は滑らかに遅く
    M.v += Math.max(-ROLL_ACC * dt, Math.min(ROLL_ACC * dt, want - M.v));
    M.v = Math.max(M.v, Math.min(want, 2));             // ごく遅いまま止まりきらないのを防ぐ
    M.th += g.dir * Math.min(M.v * dt, rem);
  } else if (!waitArms) { M.th = g.r1; M.v = 0; }   // 着いた（腕を待っている間は、その場で止まったまま）
  rollT = M.th;
  let wi = g.first;
  while (wi < g.last && (M.wps[wi].roll - rollT) * g.dir <= 0.5) wi++;
  M.wi = wi;
  if (Math.abs(M.th - g.r1) < 1e-6 && Math.abs(tiltCur - tiltT) < 0.05) { M.si++; M.wi = g.last + 1; }
  return M.si < M.segs.length;
}
function rotStart() {
  playing = false; seqPathStop();
  const M = ROT_METHODS[ROT.kind];
  // まず水平・背臥位へ（いちばん近い背臥位の向き）。そのあと、経路の点を順にたどる
  ROT.base = Math.round(rollCur / 360) * 360;
  const plan = [{ tilt: 0, roll: ROT.base, back: true }];
  for (let k = 0; k < ROT.n[ROT.kind]; k++)
    M.route.forEach(([r], i) => { if (i) plan.push({ tilt: 0, roll: ROT.base + r + (ROT.kind === 1 ? -360 * k : 0), lap: k, step: i,
      slow: ROT.kind === 2 && ROT.n[2] > 1 && k >= ROT.n[2] / 2 }); });   // 右回りは 1 回ごとに 360° ずつ先へ。左右交互は後ろ半分をゆっくり
  ROT.plan = plan; ROT.mo = motionBuild(plan, rollCur); ROT.i = 0; ROT.lap = 0; ROT.step = 0; ROT.done = false;
  rotShow();
}
function rotStop() {
  if (!ROT.plan) return;
  ROT.plan = null; ROT.mo = null; rollT = rollCur; rotShow();
}
// 1 コマごとに呼ぶ（main.js）
function rotStep(dt) {
  rollDriven = false;
  seqPathStep(dt);                                // 手順タブの経路（下の seqPathStep）
  if (!ROT.plan) return;
  const going = motionStep(ROT.mo, dt);
  ROT.i = Math.min(ROT.mo.wi, ROT.plan.length - 1);
  const P = ROT.plan[ROT.i]; if (!P.back) { ROT.lap = P.lap; ROT.step = P.step; }
  if (!going) { ROT.plan = null; ROT.mo = null; ROT.done = true; }
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
  const txt = run ? (ROT.plan[ROT.i].back ? '台を水平にして、背臥位にしています' : (n > 1 ? (ROT.lap + 1) + ' 回目：' : '') + M.route[ROT.step][1] + 'へ' + (ROT.plan[ROT.i].slow ? '（ゆっくり）' : ''))
                  : (ROT.done ? '終わりました。「3D + 透視」や「X線像」で、バリウムが付いた所を見てみましょう' : '');
  if (txt !== rotLastTxt) { document.getElementById('rotNow').textContent = txt; rotLastTxt = txt; }
}
setRotKind(1);

/* ================= 手順タブ：前の撮影からの体位変換の経路をたどる =================
   経路の点（data.js の SEQ2_ROUTES）を順に、起倒は台の動き（main.js）、回転は回転法と同じ速さ（72°/秒、ゆっくりは半分）で動かす */
const SP = { mo: null };
function seqPathStart(R) {
  rotStop();
  const p0 = R.pts[0], base = Math.round((rollCur - p0[1]) / 360) * 360;   // 最初の点を、いまの向きに合わせる（360° の何周目か）
  SP.mo = motionBuild(R.pts.slice(1).map(([t, r, sl]) => ({ tilt: t, roll: base + r, slow: !!sl })), rollCur);
}
function seqPathStop() { if (SP.mo) { SP.mo = null; rollT = rollCur; } }
function seqPathStep(dt) {
  if (!SP.mo) return;
  if (!motionStep(SP.mo, dt)) SP.mo = null;
  SP.ui = (SP.ui || 0) + dt;
  if (SP.ui > 0.1 || !SP.mo) { SP.ui = 0; updateNotes(); }
}
