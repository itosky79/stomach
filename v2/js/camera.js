"use strict";
/* ================= カメラ ================= */
// 台の座標系の軸：AZ=管球の方向、AY=頭側（フィルムの上）、AX=フィルムの右
const AX = new THREE.Vector3(0, 0, -1), AY = new THREE.Vector3(-1, 0, 0), AZ = new THREE.Vector3(0, 1, 0);
const ctrl = { theta: 0.62, phi: 1.16, dist: 46, base: 46, target: new THREE.Vector3(0, 0, 0) };
const VIEWS = { room: [0.62, 1.02, 2.90, -2], oblique: [1.05, 1.26, 1.45, -1] };
let viewPreset = 'room';
const FPS = { x: 0, z: 0, eye: 128, yaw: 0, pitch: 0, fov: 60 };   // fov：拡大（画角。小さいほど大きく見える）
const _dir = new THREE.Vector3(), _qt = new THREE.Quaternion(), _look = new THREE.Vector3();
function applyCam() {
  if (viewPreset === 'fps') { applyFpsCam(); return; }
  if (viewPreset === 'tube') {                     // 管球は台といっしょに傾く
    _qt.setFromAxisAngle(Zax, -tiltCur * Math.PI / 180);
    _dir.copy(AZ).applyQuaternion(_qt);
    camera.up.copy(AY).applyQuaternion(_qt);
  } else {                                         // 室内の定位置。体位を変えても動かない
    const sp = Math.sin(ctrl.phi);
    _dir.set(sp * Math.sin(ctrl.theta), Math.cos(ctrl.phi), sp * Math.cos(ctrl.theta));
    camera.up.set(0, 1, 0);
  }
  // 台は回転軸を中心に起倒し、胃は部屋の中を動く。画面では注視点を胃に合わせて追いかけ、
  // 「体位を変えても胃は画面の同じところにある」を保つ
  _look.copy(ctrl.target).add(tiltGroup.position);
  const fov = 32;
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.position.copy(_look).addScaledVector(_dir, ctrl.dist);
  camera.lookAt(_look);
  camera.updateMatrixWorld();
  const rt = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const uv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const ad = ctrl.dist;
  arrow.position.copy(_look).addScaledVector(rt, -ad * 0.40).addScaledVector(uv, ad * 0.10);
  arrow.setDirection(gWorld);
  arrow.visible = Math.abs(gWorld.dot(_dir)) < 0.93;
}
function setView(p) {
  viewPreset = p;
  syncViewBtns();
  if (VIEWS[p]) { ctrl.theta = VIEWS[p][0]; ctrl.phi = VIEWS[p][1]; ctrl.dist = ctrl.base * VIEWS[p][2]; ctrl.target.set(0, VIEWS[p][3], 0); }
  if (p === 'tube') { ctrl.dist = ctrl.base; ctrl.target.set(0, 0, 0); }
  if (p === 'room') {   // 横長・縦長どちらの画面でも寝台の全体が入るように
    const need = 60 / (Math.tan(camera.fov * Math.PI / 360) * Math.max(0.5, camera.aspect));
    ctrl.dist = Math.max(ctrl.dist, need);
  }
  const seg = document.getElementById('viewpt');
  if (seg) [...seg.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.p === p));
  applyCam();
}
/* 視点の切り替え（外から／一人称）。一人称は術者の目で、操作室の席に座って見回す。以前あった「術者」（席から見るだけの固定の視点）は、一人称と同じなので消した */
const camSeg = document.getElementById('camSeg'), fpsPad = document.getElementById('fpsPad');
function syncViewBtns() {
  [...camSeg.children].forEach(b => b.setAttribute('aria-pressed', (b.dataset.c === 'fps') === (viewPreset === 'fps')));
  const was = !fpsPad.hidden;
  fpsPad.hidden = viewPreset !== 'fps';
  if (viewPreset === 'fps' && !was) {   // 入ったときだけ操作の説明を出し、8 秒で消す
    const tip = document.getElementById('fpsTip');
    tip.textContent = 'ドラッグで見回す ／ ホイール（2 本指）で拡大 ／ ダブルクリックで胃のほうを向く';
    tip.classList.remove('off'); clearTimeout(syncViewBtns.t);
    syncViewBtns.t = setTimeout(() => tip.classList.add('off'), 8000);
  }
}
const syncOpBtn = syncViewBtns;
camSeg.addEventListener('click', e => {
  const b = e.target.closest('button[data-c]'); if (!b) return;
  if (b.dataset.c === 'fps') { if (viewPreset !== 'fps') { fpsSeat(); setView('fps'); } }
  else if (viewPreset === 'fps') setView('room');
});
function fitCam() {
  ctrl.base = bsRadius * BODY_SCALE / Math.sin(camera.fov * Math.PI / 360) * 1.10;
  setView(VIEWS[viewPreset] || viewPreset === 'fps' ? viewPreset : 'room');
}

/* ---- 一人称視点：術者の目で見回す ----
   いつも操作室の席に座った目の位置（OPERATOR_EYE）にいて、見回すだけ（歩いたり立ったりはしない）。
   座標は部屋（scene）の cm。y = 床からの高さ。視線は yaw（鉛直軸まわり。0 で −z、つまり操作室から透視室の向き）と pitch（上下） */
const _fd = new THREE.Vector3();
function fpsLookAt(v) {   // 目から点 v を向く
  _fd.set(v.x - FPS.x, v.y - FPS.eye, v.z - FPS.z).normalize();
  FPS.yaw = Math.atan2(-_fd.x, -_fd.z); FPS.pitch = Math.asin(Math.max(-1, Math.min(1, _fd.y)));
}
function fpsSeat() {   // 席に座り、胃（tiltGroup の原点）のほうを向く。拡大も戻す
  FPS.fov = 60;
  FPS.x = OPERATOR_EYE.x; FPS.z = OPERATOR_EYE.z; FPS.eye = OPERATOR_EYE.y;
  fpsLookAt(tiltGroup.position.clone());
}
/* 一人称の拡大：画角を 8°〜75° の間で変える（席からは動かない）。見回す速さも画角に合わせて変える */
function fpsZoom(k) { FPS.fov = Math.max(8, Math.min(75, FPS.fov * k)); applyCam(); }
function applyFpsCam() {
  if (camera.fov !== FPS.fov) { camera.fov = FPS.fov; camera.updateProjectionMatrix(); }
  camera.position.set(FPS.x, FPS.eye, FPS.z);
  camera.up.set(0, 1, 0);
  const cp = Math.cos(FPS.pitch);
  _fd.set(-Math.sin(FPS.yaw) * cp, Math.sin(FPS.pitch), -Math.cos(FPS.yaw) * cp);
  camera.lookAt(camera.position.x + _fd.x, camera.position.y + _fd.y, camera.position.z + _fd.z);
  camera.updateMatrixWorld();
  arrow.visible = false;
}
let drag = null, pinch = 0;
canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (viewPreset === 'fps') {   // 一人称：見回す（ドラッグした向きを見る）
    const k = 0.004 * FPS.fov / 60;   // 拡大しているときはゆっくり回す
    FPS.yaw -= dx * k;
    FPS.pitch = Math.max(-1.4, Math.min(1.4, FPS.pitch - dy * k));
  } else if (drag.pan) {
    const s = ctrl.dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    ctrl.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  } else {
    if (viewPreset === 'tube') { viewPreset = 'free'; syncOpBtn(); }
    ctrl.theta -= dx * 0.008;
    ctrl.phi = Math.max(0.14, Math.min(Math.PI - 0.14, ctrl.phi - dy * 0.008));
    const seg = document.getElementById('viewpt');
    if (seg) [...seg.children].forEach(b => b.setAttribute('aria-pressed', false));
  }
  applyCam();
});
const endDrag = () => { drag = null; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('dblclick', () => { if (viewPreset === 'fps') { fpsSeat(); applyCam(); } else fitCam(); });   // 視点を戻す（一人称では胃のほうを向く）
function zoomTo(d) {   // 寄るほど注視点を胃（原点）へ近づける。引けば元に戻る
  const r = bsRadius * BODY_SCALE, nd = Math.max(r * 0.5, Math.min(r * 24, d));
  ctrl.target.multiplyScalar(nd / ctrl.dist);
  ctrl.dist = nd;
  applyCam();
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (viewPreset === 'fps') { fpsZoom(1 + Math.sign(e.deltaY) * 0.10); return; }   // 一人称：席に座ったまま拡大・縮小する
  zoomTo(ctrl.dist * (1 + Math.sign(e.deltaY) * 0.10));
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) { if (viewPreset === 'fps') fpsZoom(pinch / d); else zoomTo(ctrl.dist * pinch / d); }
    pinch = d; drag = null;
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { pinch = 0; });
