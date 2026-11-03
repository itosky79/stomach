"use strict";
/* ================= カメラ ================= */
// 台の座標系の軸：AZ=管球の方向、AY=頭側（フィルムの上）、AX=フィルムの右
const AX = new THREE.Vector3(0, 0, -1), AY = new THREE.Vector3(-1, 0, 0), AZ = new THREE.Vector3(0, 1, 0);
const ctrl = { theta: 0.62, phi: 1.16, dist: 46, base: 46, target: new THREE.Vector3(0, 0, 0) };
const VIEWS = { room: [0.62, 1.02, 2.90, -2], oblique: [1.05, 1.26, 1.45, -1] };
let viewPreset = 'room';
const FPS = { x: 0, z: 0, eye: 118, eyeT: 118, yaw: 0, pitch: 0, keys: new Set(), pad: new Set() };
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
  const fov = viewPreset === 'operator' ? 50 : 32;          // 術者視点は窓越しに広く見る
  if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (viewPreset === 'operator') { camera.position.copy(OPERATOR_EYE); camera.up.set(0, 1, 0); }
  else camera.position.copy(_look).addScaledVector(_dir, ctrl.dist);
  camera.lookAt(_look);
  camera.updateMatrixWorld();
  const rt = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const uv = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
  const ad = viewPreset === 'operator' ? camera.position.distanceTo(_look) : ctrl.dist;
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
/* 術者視点：操作室の机の前に座り、鉛ガラスの窓越しに胃のほうを見る。ドラッグすると普段の視点に戻る */
const bOp = document.getElementById('bOp'), bFps = document.getElementById('bFps'), fpsPad = document.getElementById('fpsPad');
function syncViewBtns() {
  bOp.setAttribute('aria-pressed', viewPreset === 'operator');
  bFps.setAttribute('aria-pressed', viewPreset === 'fps');
  const was = !fpsPad.hidden;
  fpsPad.hidden = viewPreset !== 'fps';
  if (viewPreset !== 'fps') { FPS.keys.clear(); FPS.pad.clear(); }
  else if (!was) {   // 入ったときだけ操作の説明を出し、8 秒で消す
    const tip = document.getElementById('fpsTip');
    tip.textContent = matchMedia('(pointer: coarse)').matches
      ? 'ドラッグで見回す ／ ボタンで歩く'
      : 'ドラッグで見回す ／ W A S D・矢印キーで歩く（Shift で速く）／ ホイールで前後 ／ ダブルクリックで席に戻る';
    tip.classList.remove('off'); clearTimeout(syncViewBtns.t);
    syncViewBtns.t = setTimeout(() => tip.classList.add('off'), 8000);
  }
}
const syncOpBtn = syncViewBtns;
bOp.addEventListener('click', () => setView(viewPreset === 'operator' ? 'room' : 'operator'));
bFps.addEventListener('click', () => { if (viewPreset === 'fps') setView('room'); else { fpsSeat(); setView('fps'); } });
function fitCam() {
  ctrl.base = bsRadius * BODY_SCALE / Math.sin(camera.fov * Math.PI / 360) * 1.10;
  setView(VIEWS[viewPreset] || viewPreset === 'operator' || viewPreset === 'fps' ? viewPreset : 'room');
}

/* ---- 一人称視点：術者の目で見回し、部屋の中を歩く ----
   座標は部屋（scene）の cm。y = 床からの高さ。視線は yaw（鉛直軸まわり。0 で −z、つまり操作室から透視室の向き）と pitch（上下）。
   操作室の席に座った目の位置（OPERATOR_EYE）から始める。歩き出すと立ち上がる（目の高さ 160 cm）。
   壁・仕切り壁（扉の開口だけ通れる）・寝台・机・近接操作卓は通り抜けない。体の半径 FPS_R */
const FPS_R = 22, FPS_STAND = 160, FPS_SPEED = 120;
const _fd = new THREE.Vector3();
function fpsLookAt(v) {   // 目から点 v を向く
  _fd.set(v.x - FPS.x, v.y - FPS.eye, v.z - FPS.z).normalize();
  FPS.yaw = Math.atan2(-_fd.x, -_fd.z); FPS.pitch = Math.asin(Math.max(-1, Math.min(1, _fd.y)));
}
function fpsSeat() {
  FPS.x = OPERATOR_EYE.x; FPS.z = OPERATOR_EYE.z; FPS.eye = FPS.eyeT = OPERATOR_EYE.y;
  fpsLookAt(tiltGroup.position.clone());   // 胃（tiltGroup の原点）を見る
}
function fpsBlocked(x, z) {
  const R = FPS_R;
  if (x < -250 + R || x > 250 - R || z < -350 + R || z > 550 - R) return true;                        // 部屋の壁
  if (Math.abs(z - ROOM_Z0) < R + 8 && !(x > DOOR[0] + R && x < DOOR[1] - R)) return true;            // 仕切り壁（扉の開口だけ通れる）
  if (Math.abs(x) < TB.len / 2 + 20 + R && Math.abs(z) < TB.w / 2 + 25 + R) return true;               // 寝台と X 線管の支柱
  if (Math.abs(x) < 90 + 8 && z > ROOM_Z0 + 15 && z < ROOM_Z0 + 85 + 8) return true;                     // 操作室の机
  if (Math.hypot(x + 150, z - 70) < 25 + R) return true;                                                 // 近接操作卓
  return false;
}
function fpsMove(dx, dz) {   // x と z を別々に動かし、壁に沿って滑れるようにする
  if (!fpsBlocked(FPS.x + dx, FPS.z)) FPS.x += dx;
  if (!fpsBlocked(FPS.x, FPS.z + dz)) FPS.z += dz;
}
function fpsStep(dt) {
  if (viewPreset !== 'fps') return;
  let f = 0, s = 0;
  const K = FPS.keys, P = FPS.pad;
  if (K.has('KeyW') || K.has('ArrowUp') || P.has('f')) f += 1;
  if (K.has('KeyS') || K.has('ArrowDown') || P.has('b')) f -= 1;
  if (K.has('KeyD') || K.has('ArrowRight') || P.has('r')) s += 1;
  if (K.has('KeyA') || K.has('ArrowLeft') || P.has('l')) s -= 1;
  if (f || s) {
    FPS.eyeT = FPS_STAND;
    const v = FPS_SPEED * (K.has('ShiftLeft') || K.has('ShiftRight') ? 2 : 1) * dt / Math.hypot(f, s);
    const fx = -Math.sin(FPS.yaw), fz = -Math.cos(FPS.yaw);   // 前（水平）
    fpsMove((fx * f - fz * s) * v, (fz * f + fx * s) * v);
  }
  FPS.eye += (FPS.eyeT - FPS.eye) * (1 - Math.exp(-dt * 4));
}
function applyFpsCam() {
  if (camera.fov !== 60) { camera.fov = 60; camera.updateProjectionMatrix(); }
  camera.position.set(FPS.x, FPS.eye, FPS.z);
  camera.up.set(0, 1, 0);
  const cp = Math.cos(FPS.pitch);
  _fd.set(-Math.sin(FPS.yaw) * cp, Math.sin(FPS.pitch), -Math.cos(FPS.yaw) * cp);
  camera.lookAt(camera.position.x + _fd.x, camera.position.y + _fd.y, camera.position.z + _fd.z);
  camera.updateMatrixWorld();
  arrow.visible = false;
}
const FPS_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
function fpsKeyTarget(e) {   // 入力欄やスライダーなど、矢印キーを自分で使う部品にいるときは歩かない
  const t = e.target;
  return !(t && t.closest && t.closest('input, select, textarea, [role="slider"], [tabindex]:not(canvas), #stick, #split'));
}
addEventListener('keydown', e => {
  if (viewPreset !== 'fps' || !FPS_KEYS.has(e.code) || !fpsKeyTarget(e) || e.ctrlKey || e.metaKey || e.altKey) return;
  FPS.keys.add(e.code); e.preventDefault();
});
addEventListener('keyup', e => { FPS.keys.delete(e.code); });
addEventListener('blur', () => { FPS.keys.clear(); FPS.pad.clear(); });
document.addEventListener('visibilitychange', () => { FPS.keys.clear(); FPS.pad.clear(); });
fpsPad.querySelectorAll('[data-mv]').forEach(b => {
  const mv = b.dataset.mv;
  b.addEventListener('pointerdown', e => { e.preventDefault(); b.setPointerCapture(e.pointerId); FPS.pad.add(mv); });
  const up = () => FPS.pad.delete(mv);
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', e => e.preventDefault());
});
document.getElementById('bSeat').addEventListener('click', () => { fpsSeat(); applyCam(); });
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
    FPS.yaw -= dx * 0.004;
    FPS.pitch = Math.max(-1.4, Math.min(1.4, FPS.pitch - dy * 0.004));
  } else if (drag.pan) {
    const s = ctrl.dist * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
    ctrl.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
  } else {
    if (viewPreset === 'tube' || viewPreset === 'operator') { viewPreset = 'free'; syncOpBtn(); }
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
canvas.addEventListener('dblclick', () => { if (viewPreset === 'fps') { fpsSeat(); applyCam(); } else fitCam(); });   // 視点を戻す（一人称では席に戻る）
function zoomTo(d) {   // 寄るほど注視点を胃（原点）へ近づける。引けば元に戻る
  const r = bsRadius * BODY_SCALE, nd = Math.max(r * 0.5, Math.min(r * 24, d));
  ctrl.target.multiplyScalar(nd / ctrl.dist);
  ctrl.dist = nd;
  applyCam();
}
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  if (viewPreset === 'fps') {   // 一人称：前後に歩く
    FPS.eyeT = FPS_STAND;
    const v = -Math.sign(e.deltaY) * 25;
    fpsMove(-Math.sin(FPS.yaw) * v, -Math.cos(FPS.yaw) * v); applyCam(); return;
  }
  zoomTo(ctrl.dist * (1 + Math.sign(e.deltaY) * 0.10));
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch && viewPreset !== 'fps') zoomTo(ctrl.dist * pinch / d);
    pinch = d; drag = null;
  }
}, { passive: true });
canvas.addEventListener('touchend', () => { pinch = 0; });
