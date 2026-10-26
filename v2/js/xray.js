"use strict";
/* ================= 撮影系（透視台に固定された管球）================= */
const filmEl = document.getElementById('film');
const fRel = filmEl.querySelector('.fR'), fLel = filmEl.querySelector('.fL');
function viewRects() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (viewMode === 0) return { film: null, w: w, h: h };
  if (viewMode === 2) {
    const fh = Math.max(120, Math.min(h - 26, (w - 26) * 1.25)), fw = fh / 1.25;
    return { film: { left: (w - fw) / 2, top: (h - fh) / 2, w: fw, h: fh, yb: (h - fh) / 2 }, w: w, h: h, full: true };
  }
  const fw = Math.round(Math.min(238, Math.max(w < 420 ? 96 : 132, w * 0.29)));
  const fh = Math.round(Math.min(fw * 1.26, h * 0.62));
  return { film: { left: w - fw - 14, top: h - fh - 14, w: fw, h: fh, yb: 14 }, w: w, h: h };
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
  if (!r.film) { filmEl.style.display = 'none'; return; }
  filmEl.style.display = 'block';
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
  meshSkin.material = on ? matSkinX : matSkin;
  meshSkin.visible = on || skinOpacity > 0.005;
  figureGroup.visible = !on && skinOpacity > 0.005;
  orientGroup.visible = !on && showOri;
  // 引いているときだけ装置を出す。寄ったときは解剖の邪魔をしない
  const showRoom = !on && viewMode !== 2 && viewPreset !== 'tube' && (viewPreset === 'operator' || ctrl.dist >= ctrl.base * 1.9);
  roomProps.visible = showRoom; tableProps.visible = showRoom; cradle.visible = showRoom;
  partition.visible = viewPreset === 'operator' || camera.position.z < ROOM_Z0 - 10;
  boneGroup.visible = on || showBone;
  boneGroup.traverse(o => { if (o.isMesh) o.material = on ? matBoneX : matBone; });
  guides.visible = !on && viewMode !== 2;
}
function render() {
  if (renderer.xr.isPresenting) { renderXR(); return; }
  const r = viewRects();
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, r.w, r.h); renderer.setScissor(0, 0, r.w, r.h);
  renderer.setClearColor(r.full ? 0x070B0F : 0x0A0F14, 1); renderer.clear();
  if (!r.full) { setXray(false); renderer.render(scene, camera); }
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
  capCx.fillText('Ba ' + Math.round(targetMl) + ' mL / gas ' + Math.round(airLevel * 100) + '%', 18, capH - 18);

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
