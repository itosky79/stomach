"use strict";
/* ================= VR（WebXR）=================
   VR が使えるブラウザ（Quest のブラウザ、または ?xr=emulate のエミュレーター）でだけ
   「VR」ボタンを出す。VR の中では、部屋の床を現実の床に合わせ、透視台の窓の側（操作室の側）に立つ。
   部屋と床は動かず、台が起倒して患者が動くのを見る（立っている床が動くと酔うため）。
   部屋は cm で作ってあるので、VR の間だけ部屋全体を xrWorld に入れて 0.01 倍にする。
   コントローラーと重さの板は xrWorld の外（m の世界）に置く。 */
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const XR_SCALE = 0.01;    // 1 単位 = 1 cm（DIMENSIONS.md）
const XR_STAND = 130;     // 立つ位置：回転軸から窓の側（+z）へ何 cm 離れるか
const XR_NEAR = 0.05;     // VR では手元まで見えるよう、近くの切り捨てを短くする
const TILT_RATE = 20;     // スティックやレバーをいっぱいに倒したときの起倒の速さ（°/秒）
const ROLL_RATE = 60;     // 体軸回転の速さ（°/秒）

const xrWorld = new THREE.Group();
const xrOwn = [];         // m の世界に置くもの（xrWorld の外）
const bVR = document.getElementById('bVR');
let xrSession = null, camSaved = null, moved = [];
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
    // 部屋の中身を xrWorld に移して縮め、立つ位置 (0, 0, XR_STAND) が現実の原点に来るようにする
    moved = scene.children.filter(o => o !== xrWorld && !xrOwn.includes(o));
    moved.forEach(o => xrWorld.add(o));
    scene.add(xrWorld);
    xrWorld.scale.setScalar(XR_SCALE);
    xrWorld.position.set(0, 0, -XR_STAND * XR_SCALE);
    await renderer.xr.setSession(s);
    bVR.textContent = 'VR 終了';
  } catch (e) {
    console.warn('VR を開始できませんでした', e);
    onXREnd();
  }
});
function onXREnd() {
  xrSession = null;
  renderer.autoClear = false;
  moved.forEach(o => scene.add(o)); moved = [];
  scene.remove(xrWorld);
  if (perfPanel) perfPanel.visible = false;
  grab = null;
  bVR.textContent = 'VR';
  // three.js の後始末が済んでから、画面用のカメラを元に戻す
  setTimeout(() => {
    if (camSaved) { camera.near = camSaved.near; camera.fov = camSaved.fov; }
    resize(); applyCam();
  }, 0);
}

/* ---- コントローラー：先に小さな印を付ける ---- */
const ctrlMat = new THREE.MeshBasicMaterial({ color: 0x52B8CE });
const ctrls = [0, 1].map(i => {
  const c = renderer.xr.getController(i);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.05, 12), ctrlMat);
  tip.rotation.x = -Math.PI / 2; tip.position.z = -0.03; c.add(tip);
  scene.add(c); xrOwn.push(c);
  c.addEventListener('squeezestart', () => tryGrab(c));
  c.addEventListener('squeezeend', () => { if (grab && grab.c === c) grab = null; });
  return c;
});

/* ---- 近接操作卓のレバー：握って（グリップ）奥へ倒すと台が起き、手前へ倒すと倒れる ---- */
const LEVER_AT = new THREE.Vector3(-150, 105, 70);   // 近接操作卓の上（scene.js の卓と同じ位置）
const bedLever = new THREE.Group(); bedLever.position.copy(LEVER_AT); roomProps.add(bedLever);
{
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 12, 12), matGear); stick.position.y = 6; bedLever.add(stick);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(2.4, 16, 12), new THREE.MeshBasicMaterial({ color: 0xF3C173 }));
  knob.position.y = 12.5; bedLever.add(knob);
}
let grab = null, leverAmt = 0;
const _cp = new THREE.Vector3(), _knob = new THREE.Vector3();
function ctrlRoomPos(c, out) { c.getWorldPosition(out); return xrWorld.worldToLocal(out); }   // コントローラーの位置（部屋の cm）
function tryGrab(c) {
  ctrlRoomPos(c, _cp);
  _knob.set(0, 12.5, 0).applyQuaternion(bedLever.quaternion).add(LEVER_AT);
  if (_cp.distanceTo(_knob) < 15) grab = { c, z0: _cp.z };
}

/* ---- VR の操作：右でも左でも、スティックの前後で起倒、左右で体軸回転 ---- */
let xrSync = 0;
function xrInput(dt) {
  let tr = 0, rr = 0;
  for (const src of (xrSession ? xrSession.inputSources : [])) {
    const ax = src.gamepad && src.gamepad.axes;
    if (!ax || ax.length < 4) continue;
    const sx = Math.abs(ax[2]) > 0.2 ? ax[2] : 0, sy = Math.abs(ax[3]) > 0.2 ? ax[3] : 0;
    tr += -sy * TILT_RATE;      // スティックを前に倒すと台が起きる
    rr += sx * ROLL_RATE;
  }
  if (grab) {
    ctrlRoomPos(grab.c, _cp);
    leverAmt = Math.max(-1, Math.min(1, (grab.z0 - _cp.z) / 10));   // 握ったところから 10 cm 動かすといっぱい
    tr += leverAmt * TILT_RATE;
  } else leverAmt *= 0.8;
  bedLever.rotation.x = -leverAmt * 0.45;
  if (tr || rr) {
    playing = false;
    tiltT = Math.max(-90, Math.min(90, tiltT + tr * dt));
    rollT += rr * dt;
    xrSync += dt;
    if (xrSync > 0.25) { xrSync = 0; syncFree(); updateNotes(); }   // 画面の表示はときどき合わせる
  } else if (xrSync > 0) { xrSync = 0; syncFree(); updateNotes(); }
}

/* ---- VR の中の重さ表示（?perf=1）：視線の少し下に板を浮かべる（m の世界）---- */
let perfPanel = null, perfCx = null, perfTex = null, perfShown = '';
if (PERF_ON) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 176;
  perfCx = cv.getContext('2d');
  perfTex = new THREE.CanvasTexture(cv);
  perfPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.40, 0.1375),
    new THREE.MeshBasicMaterial({ map: perfTex, transparent: true, depthTest: false, depthWrite: false }));
  perfPanel.renderOrder = 999; perfPanel.visible = false;
  scene.add(perfPanel); xrOwn.push(perfPanel);
}
const _xp = new THREE.Vector3(), _xq = new THREE.Quaternion(), _xs = new THREE.Vector3();
function placePerfPanel() {
  if (perf.text !== perfShown) {
    perfShown = perf.text;
    perfCx.fillStyle = 'rgba(5,8,11,0.86)'; perfCx.fillRect(0, 0, 512, 176);
    perfCx.fillStyle = '#CFE8EF'; perfCx.font = '28px monospace';
    perfShown.split('\n').forEach((l, i) => perfCx.fillText(l, 18, 40 + i * 38));
    perfTex.needsUpdate = true;
  }
  // 前のフレームの頭の位置から、0.8 m 前・0.25 m 下に置く
  renderer.xr.getCamera().matrixWorld.decompose(_xp, _xq, _xs);
  perfPanel.position.set(0, -0.25, -0.8).applyQuaternion(_xq).add(_xp);
  perfPanel.quaternion.copy(_xq);
  perfPanel.visible = true;
}

function renderXR() {
  roomProps.visible = true; tableProps.visible = true; cradle.visible = true; partition.visible = true;   // VR では装置をいつも出す
  renderFluoro();
  setXray(false);
  roomProps.visible = true; tableProps.visible = true; cradle.visible = true; partition.visible = true;
  guides.visible = false; arrow.visible = false;         // 画面用の目印は出さない
  if (perfPanel) placePerfPanel();
  renderer.setScissorTest(false);
  renderer.setClearColor(0x0A0F14, 1);
  renderer.render(scene, camera);
}
