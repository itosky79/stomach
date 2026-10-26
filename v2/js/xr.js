"use strict";
/* ================= VR（WebXR）=================
   VR が使えるブラウザ（Quest のブラウザ、または ?xr=emulate のエミュレーター）でだけ
   「VR」ボタンを出す。VR の中では、部屋の床を現実の床に合わせ、透視台の窓の側（操作室の側）に立つ。
   部屋と床は動かず、台が起倒して患者が動くのを見る（立っている床が動くと酔うため）。 */
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const XR_SCALE = 0.01;    // 1 単位 = 1 cm（DIMENSIONS.md）
const XR_STAND = 130;     // 立つ位置：回転軸から窓の側（+z）へ何 cm 離れるか
const XR_NEAR = 0.05;     // VR では手元まで見えるよう、近くの切り捨てを短くする

const bVR = document.getElementById('bVR');
let xrSession = null, camSaved = null;
if (navigator.xr && navigator.xr.isSessionSupported) {
  navigator.xr.isSessionSupported('immersive-vr').then(ok => { bVR.hidden = !ok; }).catch(() => { });
}
bVR.addEventListener('click', async () => {
  if (xrSession) { xrSession.end(); return; }
  try {
    const s = await navigator.xr.requestSession('immersive-vr',
      { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    xrSession = s;
    s.addEventListener('end', onXREnd);
    renderer.autoClear = true;
    // VR 中は three.js がゴーグルに合わせて camera の視野角なども書き換えるので、控えておく
    camSaved = { near: camera.near, fov: camera.fov };
    camera.near = XR_NEAR; camera.updateProjectionMatrix();
    await renderer.xr.setSession(s);
    bVR.textContent = 'VR 終了';
  } catch (e) {
    console.warn('VR を開始できませんでした', e);
    xrSession = null; renderer.autoClear = false;
  }
});
function onXREnd() {
  xrSession = null;
  renderer.autoClear = false;
  scene.scale.setScalar(1); scene.position.set(0, 0, 0); scene.rotation.set(0, 0, 0);
  if (perfPanel) perfPanel.visible = false;
  bVR.textContent = 'VR';
  // three.js の後始末が済んでから、画面用のカメラを元に戻す
  setTimeout(() => {
    if (camSaved) { camera.near = camSaved.near; camera.fov = camSaved.fov; }
    resize(); applyCam();
  }, 0);
}

/* ---- VR の中の重さ表示（?perf=1）：視線の少し下に板を浮かべる ---- */
let perfPanel = null, perfCx = null, perfTex = null, perfShown = '';
if (PERF_ON) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 176;
  perfCx = cv.getContext('2d');
  perfTex = new THREE.CanvasTexture(cv);
  perfPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.40, 0.1375),
    new THREE.MeshBasicMaterial({ map: perfTex, transparent: true, depthTest: false, depthWrite: false }));
  perfPanel.renderOrder = 999; perfPanel.visible = false;
  scene.add(perfPanel);
}
const _xp = new THREE.Vector3(), _xq = new THREE.Quaternion(), _xs = new THREE.Vector3(), _xo = new THREE.Vector3();
function placePerfPanel() {
  if (perf.text !== perfShown) {
    perfShown = perf.text;
    perfCx.fillStyle = 'rgba(5,8,11,0.86)'; perfCx.fillRect(0, 0, 512, 176);
    perfCx.fillStyle = '#CFE8EF'; perfCx.font = '28px monospace';
    perfShown.split('\n').forEach((l, i) => perfCx.fillText(l, 18, 40 + i * 38));
    perfTex.needsUpdate = true;
  }
  // 前のフレームの頭の位置から、0.8 m 前・0.25 m 下に置く（scene は縮めてあるので逆に戻す）
  renderer.xr.getCamera().matrixWorld.decompose(_xp, _xq, _xs);
  _xo.set(0, -0.25, -0.8).applyQuaternion(_xq).add(_xp);
  scene.updateMatrixWorld();
  scene.worldToLocal(_xo);
  perfPanel.position.copy(_xo);
  perfPanel.quaternion.copy(scene.quaternion).invert().multiply(_xq);
  perfPanel.scale.setScalar(1 / XR_SCALE);
  perfPanel.visible = true;
}

function renderXR() {
  setXray(false);
  roomProps.visible = true; tableProps.visible = true; cradle.visible = true; partition.visible = true;   // VR では装置をいつも出す
  guides.visible = false; arrow.visible = false;         // 画面用の目印は出さない
  // 部屋の床（y = 0）を現実の床に合わせ、立つ位置を (0, 0, XR_STAND) にして台のほう（−z）を向く
  scene.scale.setScalar(XR_SCALE);
  scene.position.set(0, 0, -XR_STAND * XR_SCALE);
  if (perfPanel) placePerfPanel();
  renderer.setScissorTest(false);
  renderer.setClearColor(0x0A0F14, 1);
  renderer.render(scene, camera);
}
