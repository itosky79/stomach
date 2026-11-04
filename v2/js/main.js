"use strict";
/* ================= 初期化とループ ================= */
function settle() {
  for (let n = 0; n < NN; n++) wVol[n] = 0;
  let sc = 0;
  for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] !== 'duode') sc += cap[i];
  const v = Math.min(targetMl, sc * 0.92);
  for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] !== 'duode') wVol[i] = cap[i] / sc * v;
  administered = targetMl; drained = 0;
  applyPose();
  upLocal(uUp.value);
  computeHeights();
  for (let s = 0; s < 150; s++) flowStep(1 / 60);
  for (let n = 0; n < NN; n++) lvl[n] = levelOf(n);
  for (let i = 0; i < NMAIN; i++) {
    const on = regionList[regionOf[i]][0] === 'duode' ? 0 : 1;
    for (let j = 0; j < CM; j++) aWet[i * CM + j] = on;
  }
  for (let i = NMAIN * CM; i < NV; i++) aWet[i] = 0;
}
function resize() {
  if (renderer.xr.isPresenting) return;   // VR 中の大きさはゴーグルが決める
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  layoutFilm();
}
new ResizeObserver(resize).observe(stage);

const tiltRot = document.getElementById('tiltRot'), tiltTxt = document.getElementById('tiltTxt');
let last = performance.now(), acc = 0;
function loop(now) {
  perfBegin(now);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;

  if (playing) {
    playT += dt;
    if (playT > 3.4 && tiltCur === tiltT) { playT = 0; if (seqIdx >= SEQ.length - 1) { playing = false; document.getElementById('bPlay').textContent = '順に再生'; } else gotoStep(seqIdx + 1); }
  }
  if (renderer.xr.isPresenting) xrInput(dt);   // VR のスティックとレバー
  const k = 1 - Math.exp(-dt * 3.6);
  // 起倒は、最高 TILT_MAX °/秒、加速度 TILT_ACC °/秒² で動かす（実機のように、なめらかに動き出して止まる）。
  // 以前は目標との差に比例して動かしていて、動き出しが 1 秒に 300° 以上の速さになっていた
  {
    const err = tiltT - tiltCur;
    const want = Math.sign(err) * Math.min(TILT_MAX, Math.sqrt(2 * TILT_ACC * Math.abs(err)));
    tiltV += Math.max(-TILT_ACC * dt, Math.min(TILT_ACC * dt, want - tiltV));
    const next = tiltCur + tiltV * dt;
    if ((tiltT - next) * err <= 0 || (Math.abs(err) < 0.05 && Math.abs(tiltV) < 1)) { tiltCur = tiltT; tiltV = 0; }   // 行き過ぎない
    else tiltCur = next;
  }
  rollCur += (rollT - rollCur) * k;
  if (autoSpin) ctrl.az += dt * 0.28;
  applyPose(); applyCam();
  updateCompress();

  tiltGroup.updateMatrixWorld(true);
  upLocal(uUp.value);

  // 流れの計算は 1/60 秒以下の刻みに分けて進める。描画が遅く 1 コマが長くなる（毎秒 20 コマ以下で dt = 0.05 秒）と、
  // 1 回で進める時間が長すぎてバリウムが流れなくなるため（評価モードはいつも 1/60 秒で計算している）
  const nSub = Math.max(1, Math.ceil(dt * 60 - 1e-6)), h = dt / nSub;
  for (let s = 0; s < nSub; s++) {
    computeHeights();
    dose(h);
    flowStep(h);
    for (let n = 0; n < NN; n++) lvl[n] = levelOf(n);
    updateWet(h);
    drawPourTrail();
    shapeStep(h);
  }
  updateThickness();
  buildSurface();
  updatePour();
  updateLabels();
  if (viewMode !== 0) fluoroTime += dt;

  acc += dt;
  if (acc > 0.16) {
    acc = 0; updateFilmLabels();
    tiltRot.setAttribute('transform', 'rotate(' + tiltCur.toFixed(1) + ' 54 44)');
    tiltTxt.textContent = Math.round(tiltCur) + '°';
  }
  render();
  perfEnd();
}

{ // 開発用：?type=bp3d などで最初の胃の型を選ぶ（画面には型を選ぶボタンがない）
  const qt = new URLSearchParams(location.search).get('type');
  if (qt && TYPES[qt]) curType = qt;
}
matSkin.uniforms.uO.value = skinOpacity;
loadExam();
matSkin.uniforms.uO.value = skinOpacity;
rebuildAll(); buildLabels(); settle();
setPreset('stand'); tiltCur = tiltT; rollCur = rollT;
updateNotes(); applyRail(); resize(); fitCam(); layoutFilm(); renderStrip();
renderer.setAnimationLoop(loop);   // VR に入ってもこのループがそのまま回る
