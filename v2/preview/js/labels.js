"use strict";
/* ================= ラベル ================= */
const labelBox = document.getElementById('labels');
let labels = [], regionRange = [];
const tmpV = new THREE.Vector3(), camL = new THREE.Vector3();
function mkLabel(text, cls) {
  const el = document.createElement('div');
  el.className = 'lab' + (cls ? ' ' + cls : ''); el.textContent = text;
  labelBox.appendChild(el); return el;
}
function surfAnchor(n, push) {
  const cx = centers[n * 3], cy = centers[n * 3 + 1], cz = centers[n * 3 + 2];
  let bi = 0, bd = -1e9;
  for (let j = 0; j < CM; j++) {
    const k = (n * CM + j) * 3;
    const d = (pos[k] - cx) * (camL.x - cx) + (pos[k + 1] - cy) * (camL.y - cy) + (pos[k + 2] - cz) * (camL.z - cz);
    if (d > bd) { bd = d; bi = j; }
  }
  const k = (n * CM + bi) * 3, e = push || 0.22;
  return tmpV.set(pos[k] + (pos[k] - cx) * e, pos[k + 1] + (pos[k + 1] - cy) * e, pos[k + 2] + (pos[k + 2] - cz) * e);
}
function curvAnchor(n, sign) {
  const a = Math.max(0, n - 12) * 3, b = Math.min(NMAIN - 1, n + 12) * 3, c = n * 3;
  const v = new THREE.Vector3(centers[a] + centers[b] - 2 * centers[c],
    centers[a + 1] + centers[b + 1] - 2 * centers[c + 1],
    centers[a + 2] + centers[b + 2] - 2 * centers[c + 2]);
  if (v.lengthSq() < 1e-8) v.set(1, 0, 0);
  v.normalize().multiplyScalar(sign * (radius[n] + 1.5));
  return tmpV.set(centers[c] + v.x, centers[c + 1] + v.y, centers[c + 2] + v.z);
}
function buildLabels() {
  labelBox.innerHTML = ''; labels = []; regionRange = [];
  for (let k = 0; k < regionList.length; k++) {
    let f = -1, l = -1;
    for (let i = 0; i < NMAIN; i++) if (regionOf[i] === k) { if (f < 0) f = i; l = i; }
    if (f < 0) { f = l = Math.min(NMAIN - 1, Math.round((k + 0.5) / regionList.length * NMAIN)); }
    regionRange.push([f, l]);
    const mid = Math.round((f + l) / 2);
    const sn = { '十二指腸球部': '球部', '幽門部': '幽門' }[regionList[k][1]] || regionList[k][1];
    const main = ['胃底部', '胃体部', '胃角部', '前庭部'].indexOf(regionList[k][1]) >= 0;
    labels.push({ el: mkLabel(sn), get: () => surfAnchor(mid, 0.24), kind: main ? 'r1' : 'r2' });
  }
  labels.push({ el: mkLabel('噴門'), get: () => surfAnchor(cardiaIdx, 0.42), kind: 'r2' });
  labels.push({ el: mkLabel('食道'), get: () => surfAnchor(NMAIN + 7, 0.6), kind: 'r2' });
  const ang = Math.round((regionRange[2][0] + regionRange[2][1]) / 2);
  labels.push({ el: mkLabel('小弯', 'curv'), get: () => curvAnchor(ang, 1), kind: 'r2' });
  labels.push({ el: mkLabel('大弯', 'curv'), get: () => curvAnchor(ang, -1), kind: 'r2' });
  const ax = [['頭側', 0, 1, 0], ['足側', 0, -1, 0], ['腹側', 0, 0, 1], ['背側', 0, 0, -1]];
  for (const a of ax) labels.push({
    el: mkLabel(a[0], 'axis'), kind: 'a',
    get: () => tmpV.set(a[1] * (boxHalf[0] + 4), a[2] * (boxHalf[1] + 4.2), a[3] * (boxHalf[2] + 5))
  });
  labels.push({ el: mkLabel('重力', 'axis'), kind: 'w', get: () => tmpV.copy(arrow.position).addScaledVector(new THREE.Vector3(0, -1, 0), 10.6) });
}
function updateLabels() {
  const w = stage.clientWidth, h = stage.clientHeight;
  const hideAll = viewMode === 2, far = ctrl.dist > ctrl.base * 1.75;
  camL.copy(camera.position); bodyGroup.worldToLocal(camL);
  for (const L of labels) {
    // 引きの視点ではラベルが重なるので、寄ったときだけ出す（「詳細」はつねに表示）
    const need = L.kind === 'r1' ? 1 : 2;
    if (hideAll || labelMode < need || (far && labelMode < 2)) { L.el.style.opacity = '0'; continue; }
    const v = L.get().clone();
    if (L.kind !== 'w') v.applyMatrix4(bodyGroup.matrixWorld);
    if (L.kind === 'a') {
      const dir = v.clone().normalize();
      const toCam = camera.position.clone().sub(ctrl.target).normalize();
      if (Math.abs(dir.dot(toCam)) > 0.86) { L.el.style.opacity = '0'; continue; }
    }
    const p = v.project(camera);
    if (p.z > 1) { L.el.style.opacity = '0'; continue; }
    L.el.style.transform = 'translate(-50%,-50%) translate(' + ((p.x * .5 + .5) * w) + 'px,' + ((-p.y * .5 + .5) * h) + 'px)';
    L.el.style.opacity = '1';
  }
}

function updateNotes() {
  syncPose();
  document.getElementById('freePos').textContent = poseName(tiltT, rollT);
  document.getElementById('freeAng').textContent = Math.round(tiltT) + '° / ' + Math.round(((rollT % 360) + 360) % 360) + '°';
  if (curMode === 1 && seqIdx >= 0) {
  }
}
