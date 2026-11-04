"use strict";
/* ================= 撮影系（透視台に固定された管球）================= */
const filmEl = document.getElementById('film');
const fRel = filmEl.querySelector('.fR'), fLel = filmEl.querySelector('.fL');
function viewRects() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (PIP.x < 0) pipDefault();
  if (viewMode === 0) return { film: null, w: w, h: h };
  if (viewMode === 2) {
    const fh = Math.max(120, Math.min(h - 26, (w - 26) * 1.25)), fw = fh / 1.25;
    return { film: { left: (w - fw) / 2, top: (h - fh) / 2, w: fw, h: fh, yb: (h - fh) / 2 }, w: w, h: h, full: true };
  }
  // 3D + 透視：透視像の小窓（ピクチャー・イン・ピクチャー）。位置と大きさは PIP（ドラッグで動かす。filmPip の下）
  const fw0 = Math.round(Math.min(238, Math.max(w < 420 ? 96 : 132, w * 0.29)));
  let fw = Math.round(fw0 * PIP.s), fh = Math.round(fw * 1.26);
  const maxH = h - 8, maxW = w - 8;
  if (fh > maxH) { fh = maxH; fw = Math.round(fh / 1.26); }
  if (fw > maxW) { fw = maxW; fh = Math.round(fw * 1.26); }
  const left = Math.round(Math.max(4, Math.min(w - fw - 4, PIP.x * w - fw / 2)));
  const top = Math.round(Math.max(4, Math.min(h - fh - 4, PIP.y * h - fh / 2)));
  return { film: { left: left, top: top, w: fw, h: fh, yb: h - top - fh }, w: w, h: h };
}
/* ---- 透視像の小窓を動かす（ピクチャー・イン・ピクチャー）----
   PIP.x, PIP.y：小窓の中心の位置（3D 画面の幅・高さに対する割合）。PIP.s：大きさ（初めの大きさに対する倍率 0.6〜2.6）。
   小窓をドラッグで動かす。左上の角をドラッグするか、小窓の上でホイールを回すと大きさが変わる。ダブルクリックで元に戻す。
   置いた場所はブラウザに覚えておく（保存できないブラウザでは、そのときだけ） */
const PIP_DEF = { x: -1, y: -1, s: 1 };
const PIP = { ...PIP_DEF };
try { const v = JSON.parse(localStorage.getItem('stomach.pip') || 'null'); if (v && isFinite(v.x) && isFinite(v.y) && isFinite(v.s)) Object.assign(PIP, v); } catch (e) {}
function pipDefault() {   // 初めの位置：右下（以前と同じ）
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;   // まだ画面の大きさが決まっていない
  const fw = Math.round(Math.min(238, Math.max(w < 420 ? 96 : 132, w * 0.29))), fh = Math.round(fw * 1.26);
  PIP.s = 1; PIP.x = (w - fw / 2 - 14) / w; PIP.y = (h - fh / 2 - 14) / h;
}
function pipSave() { try { localStorage.setItem('stomach.pip', JSON.stringify(PIP)); } catch (e) {} }
{
  let drag = null, lastDown = 0, lastX = 0, lastY = 0;
  filmEl.addEventListener('pointerdown', e => {
    if (viewMode !== 1) return;
    e.preventDefault(); e.stopPropagation();
    // 2 回続けて押したら元の位置と大きさに戻す（押したときにブラウザの動きを止めているので、dblclick は届かない）
    const now = performance.now();
    if (now - lastDown < 350 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 8) { lastDown = 0; drag = null; pipDefault(); layoutFilm(); pipSave(); return; }
    lastDown = now; lastX = e.clientX; lastY = e.clientY;
    filmEl.setPointerCapture(e.pointerId);
    const r = filmEl.getBoundingClientRect();
    drag = { mode: e.target.closest('.fResize') ? 'size' : 'move', x: e.clientX, y: e.clientY,
             cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, s: PIP.s };
  });
  filmEl.addEventListener('pointermove', e => {
    if (!drag) return;
    const st = stage.getBoundingClientRect();
    if (drag.mode === 'move') {
      PIP.x = (drag.cx + e.clientX - drag.x - st.left) / st.width;
      PIP.y = (drag.cy + e.clientY - drag.y - st.top) / st.height;
    } else {   // 左上の角：右下の角を動かさずに大きさを変える
      const nw = Math.max(60, drag.w - (e.clientX - drag.x));
      const k = nw / drag.w;
      PIP.s = Math.max(0.6, Math.min(2.6, drag.s * k));
      const fw = drag.w * PIP.s / drag.s, fh = fw * 1.26;
      const right = drag.cx + drag.w / 2, bottom = drag.cy + drag.w * 1.26 / 2;
      PIP.x = (right - fw / 2 - st.left) / st.width; PIP.y = (bottom - fh / 2 - st.top) / st.height;
    }
    layoutFilm();
  });
  const end = () => { if (drag) { drag = null; layoutFilm(); const r = viewRects(); if (r.film) { PIP.x = (r.film.left + r.film.w / 2) / r.w; PIP.y = (r.film.top + r.film.h / 2) / r.h; } pipSave(); } };
  filmEl.addEventListener('pointerup', end); filmEl.addEventListener('pointercancel', end);
  filmEl.addEventListener('wheel', e => {
    if (viewMode !== 1) return;
    e.preventDefault(); e.stopPropagation();
    PIP.s = Math.max(0.6, Math.min(2.6, PIP.s * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    layoutFilm(); pipSave();
  }, { passive: false });
}
function setXcam(aspect) {
  // 管球も受像器も台に固定されているので、向きは体位によらず一定
  const br = bsRadius * BODY_SCALE;
  xcam.position.copy(AZ).multiplyScalar(br * 3.2);
  const x = new THREE.Vector3().crossVectors(AY, AZ);
  xcam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, AY.clone(), AZ.clone()));
  const hh = br * 1.06, hw = hh * aspect;
  xcam.left = -hw; xcam.right = hw; xcam.top = hh; xcam.bottom = -hh;
  xcam.near = 1; xcam.far = br * 9;
  xcam.updateProjectionMatrix();
  xcam.updateMatrixWorld();
}
function layoutFilm() {
  const r = viewRects();
  fpsPad.style.visibility = r.full ? 'hidden' : '';   // X 線像だけを出しているときは操作の説明を隠す
  if (!r.film) { filmEl.style.display = 'none'; return; }
  filmEl.style.display = 'block';
  filmEl.classList.toggle('pip', viewMode === 1);
  filmEl.style.left = r.film.left + 'px'; filmEl.style.top = r.film.top + 'px';
  filmEl.style.width = r.film.w + 'px'; filmEl.style.height = r.film.h + 'px';
}
function updateFilmLabels() {
  document.getElementById('filmPos').textContent = poseName(tiltCur, rollCur);
  document.getElementById('filmProj').textContent = TYPES[curType].name + (compAmt > 0.01 ? '・圧迫' : '');
  const lw = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyGroup.quaternion);
  const cx = new THREE.Vector3().setFromMatrixColumn(xcam.matrixWorld, 0);
  const lr = lw.dot(cx) >= 0;
  fRel.textContent = lr ? 'R' : 'L'; fLel.textContent = lr ? 'L' : 'R';
}
function setXray(on) {
  meshBack.visible = !on;
  meshFront.material = on ? matXray : matFront;
  meshSurf.material = on ? matSurfX : matSurf;
  pourMesh.material = on ? matPourX : matPour;
  meshSkin.material = on ? matSkinX : matSkin;
  meshSkin.visible = on || skinOpacity > 0.005;
  figureGroup.visible = !on && skinOpacity > 0.005;
  // 引いているときだけ装置を出す。寄ったときは解剖の邪魔をしない
  const showRoom = !on && viewMode !== 2 && viewPreset !== 'tube' && (viewPreset === 'fps' || ctrl.dist >= ctrl.base * 1.9);
  roomProps.visible = showRoom; tableProps.visible = showRoom; cradle.visible = showRoom;
  wallMonitor.visible = viewPreset !== 'fps';
  partition.visible = viewPreset === 'fps' || camera.position.z < ROOM_Z0 - 10;
  boneGroup.visible = on || showBone;
  boneGroup.traverse(o => { if (o.isMesh) o.material = on ? matBoneX : matBone; });
  guides.visible = !on && viewMode !== 2;
}
/* 透視像を fluoroRT に描き、部屋のモニタに映す。2 フレームに 1 回（VR では毎回）。
   VR の最中でも普通の描画先として描けるよう、描く間だけ xr を止める（three.js の例と同じ手順） */
let fluoroTick = 0;
function renderFluoro() {
  if (!renderer.xr.isPresenting && (fluoroTick++ & 1)) return;
  setXcam(FLUORO_W / FLUORO_H);
  setXray(true);
  const rt = renderer.getRenderTarget(), xrOn = renderer.xr.enabled;
  // 透視像のシェーダは厚みを cm で数えるので、VR で部屋を縮めているときは描く間だけ元の大きさに戻す
  const shrunk = xrWorld.parent === scene;
  if (shrunk) { xrWorld.scale.setScalar(1); xrWorld.position.set(0, 0, 0); }
  renderer.xr.enabled = false;
  renderer.setRenderTarget(fluoroRT);
  renderer.setClearColor(0x05080B, 1); renderer.clear();
  renderer.render(scene, xcam);
  renderer.xr.enabled = xrOn;
  renderer.setRenderTarget(rt);
  if (shrunk) { xrWorld.scale.setScalar(XR_SCALE); xrWorld.position.set(0, 0, -XR_STAND * XR_SCALE); }
  setXray(false);
}
function render() {
  if (renderer.xr.isPresenting) { renderXR(); return; }
  setXray(false);
  if (roomProps.visible) renderFluoro();   // 部屋が見えているときだけモニタを更新する
  const r = viewRects();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, r.w, r.h); renderer.setScissor(0, 0, r.w, r.h);
  renderer.setClearColor(r.full ? theme3d.bgFull : theme3d.bg, 1); renderer.clear();
  if (!r.full) { setXray(false); fadeAlpha(r.w, r.h); renderer.render(scene, camera); }
  if (r.film) {
    setXcam(r.film.w / r.film.h);
    setXray(true);
    renderer.setScissorTest(true);
    renderer.setViewport(r.film.left, r.film.yb, r.film.w, r.film.h);
    renderer.setScissor(r.film.left, r.film.yb, r.film.w, r.film.h);
    renderer.setClearColor(0x05080B, 1); renderer.clear();
    renderer.render(scene, xcam);
    renderer.setScissorTest(false);
    setXray(false);
  }
}

/* 手前の装置の部品ごとに、画面に占める割合（外接直方体の 8 隅を画面に写した長方形の面積 ÷ 画面の面積。
   画面の外の部分は数えない）から透明度を決める。カメラの後ろに回る隅がある部品は、画面を大きく覆うとみなす。
   部品の長方形が胃の長方形と重なり、部品のいちばん近い隅が胃の中心より手前にあれば、胃を隠しているとみなす */
const _fb = new THREE.Box3(), _fv = new THREE.Vector3();
function screenRect(geo, mw) {   // 外接直方体を画面に写した長方形 [x0, x1, y0, y1]（−1〜1）、いちばん近い隅の距離、カメラの後ろの隅があるか
  geo.computeBoundingBox(); _fb.copy(geo.boundingBox);
  let x0 = 1, x1 = -1, y0 = 1, y1 = -1, near = Infinity, behind = false;
  for (let k = 0; k < 8; k++) {
    _fv.set(k & 1 ? _fb.max.x : _fb.min.x, k & 2 ? _fb.max.y : _fb.min.y, k & 4 ? _fb.max.z : _fb.min.z).applyMatrix4(mw);
    _fv.applyMatrix4(camera.matrixWorldInverse);
    if (_fv.z > -camera.near) { behind = true; continue; }
    near = Math.min(near, -_fv.z);
    _fv.applyMatrix4(camera.projectionMatrix);
    x0 = Math.min(x0, _fv.x); x1 = Math.max(x1, _fv.x); y0 = Math.min(y0, _fv.y); y1 = Math.max(y1, _fv.y);
  }
  return { x0, x1, y0, y1, near, behind };
}
function fadeAlpha(w, h) {
  const st = screenRect(meshFront.geometry, meshFront.matrixWorld);   // 胃
  _fv.copy(meshFront.geometry.boundingBox.getCenter(new THREE.Vector3())).applyMatrix4(meshFront.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
  const stDepth = -_fv.z;
  for (const m of fadeParts) {
    let a = FADE_ALPHA.base;
    if (m.parent && m.parent.visible) {
      const r = screenRect(m.geometry, m.matrixWorld);
      const frac = r.behind ? 1 : Math.max(0, Math.min(1, r.x1) - Math.max(-1, r.x0)) * Math.max(0, Math.min(1, r.y1) - Math.max(-1, r.y0)) / 4;
      const t = Math.max(0, Math.min(1, (frac - FADE_ALPHA.from) / (FADE_ALPHA.to - FADE_ALPHA.from)));
      a = FADE_ALPHA.base + (FADE_ALPHA.cover - FADE_ALPHA.base) * t;
      const overlap = r.behind || (r.x0 < st.x1 && r.x1 > st.x0 && r.y0 < st.y1 && r.y1 > st.y0);
      if (overlap && r.near < stDepth) a = FADE_ALPHA.front;   // 胃の手前に重なる
    }
    m.material.uniforms.uA.value = a;
  }
}

/* ---- フィルム撮影 ---- */
const capW = 520, capH = 650;
const capRT = new THREE.WebGLRenderTarget(capW, capH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat });
const capCv = document.createElement('canvas'); capCv.width = capW; capCv.height = capH;
const capCx = capCv.getContext('2d');
const capBuf = new Uint8Array(capW * capH * 4);
const strip = document.getElementById('strip');
function capture() {
  setXcam(capW / capH);
  setXray(true);
  renderer.setScissorTest(false);
  renderer.setRenderTarget(capRT);
  renderer.setClearColor(0x05080B, 1); renderer.clear();
  renderer.render(scene, xcam);
  renderer.readRenderTargetPixels(capRT, 0, 0, capW, capH, capBuf);
  renderer.setRenderTarget(null);
  setXray(false);

  const img = capCx.createImageData(capW, capH);
  for (let y = 0; y < capH; y++) {
    const src = (capH - 1 - y) * capW * 4, dst = y * capW * 4;
    for (let x = 0; x < capW * 4; x++) img.data[dst + x] = capBuf[src + x];
  }
  capCx.putImageData(img, 0, 0);
  const g = capCx.createRadialGradient(capW / 2, capH / 2, capH * 0.30, capW / 2, capH / 2, capH * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.42)');
  capCx.fillStyle = g; capCx.fillRect(0, 0, capW, capH);

  shotCount++;
  const name = poseName(tiltCur, rollCur);
  const sub = curMode === 1 && seqIdx >= 0 ? SEQ[seqIdx].no + ' ' + SEQ[seqIdx].tgt
            : compAmt > 0.01 ? '圧迫像' : TYPES[curType].name;
  capCx.strokeStyle = 'rgba(150,180,200,0.35)'; capCx.lineWidth = 2;
  capCx.strokeRect(6, 6, capW - 12, capH - 12);
  capCx.font = '600 19px monospace'; capCx.fillStyle = 'rgba(200,224,238,0.78)';
  const lw = new THREE.Vector3(1, 0, 0).applyQuaternion(bodyGroup.quaternion);
  const cx = new THREE.Vector3().setFromMatrixColumn(xcam.matrixWorld, 0);
  const lr = lw.dot(cx) >= 0;
  capCx.fillText(lr ? 'R' : 'L', 18, capH / 2); capCx.fillText(lr ? 'L' : 'R', capW - 34, capH / 2);
  capCx.font = '13px monospace'; capCx.fillStyle = 'rgba(150,190,210,0.85)';
  capCx.fillText(String(shotCount).padStart(2, '0') + '  ' + name, 18, 30);
  capCx.textAlign = 'right';
  capCx.fillText(sub, capW - 18, 30);
  capCx.fillStyle = 'rgba(110,150,175,0.7)'; capCx.font = '11px monospace';
  capCx.fillText('SIMULATION', capW - 18, capH - 18);
  capCx.textAlign = 'left';
  capCx.fillText('Ba ' + Math.round(targetMl * Math.pow(BODY_SCALE, 3)) + ' mL / gas ' + Math.round(gasMl) + ' mL', 18, capH - 18);

  const url = capCv.toDataURL('image/png');
  films.push({ url: url, cap: String(shotCount).padStart(2, '0') + ' ' + name, sub: sub });
  if (films.length > 12) films.shift();
  renderStrip();
}
function renderStrip() {
  if (!films.length) { strip.innerHTML = '<p class="empty">「撮影」ボタンを押すと、その体位のシミュレーション写真がここに並びます。<br>撮影手順モードで①から順に撮ると、検診1件分のフィルムセットができます。</p>'; return; }
  strip.innerHTML = '';
  films.forEach(f => {
    const fig = document.createElement('figure');
    const im = document.createElement('img'); im.src = f.url; im.alt = f.cap + ' のシミュレーション写真';
    const cp = document.createElement('figcaption'); cp.textContent = f.cap;
    fig.appendChild(im); fig.appendChild(cp);
    fig.addEventListener('click', () => {
      document.getElementById('lbImg').src = f.url;
      document.getElementById('lbCap').textContent = f.cap + '  —  ' + f.sub;
      document.getElementById('lightbox').classList.add('on');
    });
    strip.appendChild(fig);
  });
}
