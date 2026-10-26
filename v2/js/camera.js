"use strict";
/* ================= カメラ ================= */
// 台の座標系の軸：AZ=管球の方向、AY=頭側（フィルムの上）、AX=フィルムの右
const AX = new THREE.Vector3(0, 0, -1), AY = new THREE.Vector3(-1, 0, 0), AZ = new THREE.Vector3(0, 1, 0);
const ctrl = { theta: 0.62, phi: 1.16, dist: 46, base: 46, target: new THREE.Vector3(0, 0, 0) };
const VIEWS = { room: [0.62, 1.02, 2.90, -2], oblique: [1.05, 1.26, 1.45, -1] };
let viewPreset = 'room';
const _dir = new THREE.Vector3(), _qt = new THREE.Quaternion();
function applyCam() {
  if (viewPreset === 'tube') {                     // 管球は台といっしょに傾く
    _qt.setFromAxisAngle(Zax, -tiltCur * Math.PI / 180);
    _dir.copy(AZ).applyQuaternion(_qt);
    camera.up.copy(AY).applyQuaternion(_qt);
  } else {                                         // 室内の定位置。体位を変えても動かない
    const sp = Math.sin(ctrl.phi);
    _dir.set(sp * Math.sin(ctrl.theta), Math.cos(ctrl.phi), sp * Math.cos(ctrl.theta));
    camera.up.set(0, 1, 0);
  }
  camera.position.copy(ctrl.target).addScaledVector(_dir, ctrl.dist);
  camera.lookAt(ctrl.target);
  camera.updateMatrixWorld();
  const rt = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const uv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  arrow.position.copy(ctrl.target).addScaledVector(rt, -ctrl.dist * 0.40).addScaledVector(uv, ctrl.dist * 0.10);
  arrow.setDirection(gWorld);
  arrow.visible = Math.abs(gWorld.dot(_dir)) < 0.93;
}
function setView(p) {
  viewPreset = p;
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
function fitCam() {
  ctrl.base = bsRadius / Math.sin(camera.fov * Math.PI / 360) * 1.10;
  setView(VIEWS[viewPreset] ? viewPreset : 'room');
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
  if (drag.pan) {
    const s = ctrl.dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    ctrl.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  } else {
    if (viewPreset === 'tube') viewPreset = 'free';
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
canvas.addEventListener('dblclick', fitCam);          // 視点を戻す
function zoomTo(d) {   // 寄るほど注視点を胃（原点）へ近づける。引けば元に戻る
  const nd = Math.max(bsRadius * 0.5, Math.min(bsRadius * 24, d));
  ctrl.target.multiplyScalar(nd / ctrl.dist);
  ctrl.dist = nd;
  applyCam();
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomTo(ctrl.dist * (1 + Math.sign(e.deltaY) * 0.10));
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) zoomTo(ctrl.dist * pinch / d);
    pinch = d; drag = null;
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { pinch = 0; });
