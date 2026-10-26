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
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  layoutFilm();
}
new ResizeObserver(resize).observe(stage);

const tiltRot = document.getElementById('tiltRot'), tiltTxt = document.getElementById('tiltTxt');
let last = performance.now(), acc = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;

  if (playing) {
    playT += dt;
    if (playT > 3.4) { playT = 0; if (seqIdx >= SEQ.length - 1) { playing = false; document.getElementById('bPlay').textContent = '順に再生'; } else gotoStep(seqIdx + 1); }
  }
  const k = 1 - Math.exp(-dt * 3.6);
  tiltCur += (tiltT - tiltCur) * k;
  rollCur += (rollT - rollCur) * k;
  if (autoSpin) ctrl.az += dt * 0.28;
  applyPose(); applyCam();

  tiltGroup.updateMatrixWorld(true);
  upLocal(uUp.value);

  computeHeights();
  dose(dt);
  flowStep(dt);
  for (let n = 0; n < NN; n++) lvl[n] = levelOf(n);
  updateWet(dt);
  buildSurface();
  updateLabels();
  if (viewMode !== 0) fluoroTime += dt;

  acc += dt;
  if (acc > 0.16) {
    acc = 0; updateFilmLabels();
    tiltRot.setAttribute('transform', 'rotate(' + tiltCur.toFixed(1) + ' 54 44)');
    tiltTxt.textContent = Math.round(tiltCur) + '°';
  }
  render();
}

matSkin.uniforms.uO.value = skinOpacity;
loadExam();
matSkin.uniforms.uO.value = skinOpacity;
rebuildAll(); buildLabels(); settle();
setPreset('stand'); tiltCur = tiltT; rollCur = rollT;
updateNotes(); applyRail(); resize(); fitCam(); layoutFilm(); renderStrip();
requestAnimationFrame(loop);
