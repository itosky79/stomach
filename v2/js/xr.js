"use strict";
/* ================= VR（WebXR）=================
   VR が使えるブラウザ（Quest のブラウザ、または ?xr=emulate のエミュレーター）でだけ
   「VR」ボタンを出す。VR の中では、床を現実の床に合わせ、透視台を目の前に置く。
   画面のときは「体位を変えてもカメラは動かさない」ために床のほうを上下させていたが、
   VR では立っている床が動くと酔うので、床を固定して台と患者のほうを上下させる。 */
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const XR_SCALE = 0.016;   // 1 単位を何 m にするか。人体がおよそ 1.7 m になる仮の値（第 0 段階の 4 で寸法を決め直す）
const XR_AHEAD = 1.3;     // 回転軸（胃の高さ）を立ち位置の何 m 前に置くか
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
  scene.scale.setScalar(1); scene.position.set(0, 0, 0);
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
  perfPanel.quaternion.copy(_xq);
  perfPanel.scale.setScalar(1 / XR_SCALE);
  perfPanel.visible = true;
}

function renderXR() {
  setXray(false);
  roomProps.visible = true; tableProps.visible = true;   // VR では装置をいつも出す
  guides.visible = false; arrow.visible = false;         // 画面用の目印は出さない
  // 床（台を起こした分だけ下げてある）を現実の床 y = 0 に合わせる
  const d = floorDrop(tiltCur);
  scene.scale.setScalar(XR_SCALE);
  scene.position.set(0, -(FLOOR_Y - d) * XR_SCALE, -XR_AHEAD);
  if (perfPanel) placePerfPanel();
  renderer.setScissorTest(false);
  renderer.setClearColor(0x0A0F14, 1);
  renderer.render(scene, camera);
}
