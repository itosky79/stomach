"use strict";
/* ================= 体表と骨格 ================= */
function lathe(prof, NR, MR) {                    // prof: [y, 左右半径, 前後半径]
  const vp = new Float32Array((NR * MR + 2) * 3);
  const idx = [];
  for (let i = 0; i < NR; i++) {
    const t = i / (NR - 1) * (prof.length - 1);
    const y = cr1(prof.map(q => q[0]), t), a = cr1(prof.map(q => q[1]), t), b = cr1(prof.map(q => q[2]), t);
    for (let j = 0; j < MR; j++) {
      const th = j / MR * Math.PI * 2, k = (i * MR + j) * 3;
      vp[k] = a * Math.cos(th); vp[k + 1] = y; vp[k + 2] = b * Math.sin(th);
    }
  }
  const cTop = NR * MR, cBot = NR * MR + 1;
  vp[cTop * 3] = 0; vp[cTop * 3 + 1] = prof[0][0] + 1.2; vp[cTop * 3 + 2] = 0;
  vp[cBot * 3] = 0; vp[cBot * 3 + 1] = prof[prof.length - 1][0] - 1.2; vp[cBot * 3 + 2] = 0;
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < MR; j++) {
    const j2 = (j + 1) % MR, A = i * MR + j, B = i * MR + j2, C = (i + 1) * MR + j2, D = (i + 1) * MR + j;
    idx.push(A, C, B, A, D, C);
  }
  for (let j = 0; j < MR; j++) { const j2 = (j + 1) % MR; idx.push(cTop, j, j2); idx.push(cBot, (NR - 1) * MR + j2, (NR - 1) * MR + j); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(vp, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const SIMPLE_VERT = `
varying vec3 vN; varying vec3 vVd; varying vec3 vL;
void main(){
  vL = position;
  vec4 wp = modelMatrix * vec4(position,1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vVd = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
function litMat(color, opacity, baseA, rimA) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) }, uO: { value: opacity },
                uA: { value: new THREE.Vector2(baseA === undefined ? 0.34 : baseA, rimA === undefined ? 1.25 : rimA) } },
    vertexShader: SIMPLE_VERT,
    fragmentShader: `uniform vec3 uC; uniform float uO; uniform vec2 uA;
      varying vec3 vN; varying vec3 vVd; varying vec3 vL;
      void main(){
        vec3 n = normalize(vN);
        float l1 = max(dot(n, normalize(vec3(0.42,0.80,0.62))),0.0);
        float l2 = max(dot(n, normalize(vec3(-0.70,0.10,-0.45))),0.0);
        float fr = pow(1.0 - abs(dot(n, normalize(vVd))), 2.4);
        vec3 col = uC * (0.34 + 0.62*l1 + 0.22*l2) + vec3(0.36,0.50,0.60)*fr*0.7;
        gl_FragColor = vec4(col, clamp(uO * (uA.x + uA.y*fr), 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
}
function xrayMat(density, bone, edgeCap) {
  return new THREE.ShaderMaterial({
    uniforms: { uD: { value: density }, uBone: { value: bone ? 1 : 0 }, uE: { value: edgeCap || 5.0 } },
    vertexShader: SIMPLE_VERT,
    fragmentShader: `uniform float uD; uniform float uBone; uniform float uE;
      varying vec3 vN; varying vec3 vVd; varying vec3 vL;
      void main(){
        vec3 n = normalize(vN);
        float edge = clamp(1.0/max(abs(dot(n, normalize(vVd))),0.16), 1.0, uE);
        float d = uD * edge;
        // 横隔膜より頭側は肺野なので軟部組織の濃度を落とす
        if(uBone < 0.5){ float dia = 13.5 - 0.05*vL.x*vL.x; d *= mix(1.0, 0.18, smoothstep(dia-1.5, dia+2.0, vL.y)); }
        gl_FragColor = vec4(vec3(0.90,0.93,1.0) * d, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
}

/* ================= シーン ================= */
const stage = document.getElementById('stage');
const canvas = document.getElementById('gl');
const small = matchMedia('(max-width:900px)').matches;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas: canvas, antialias: !small, alpha: false, preserveDrawingBuffer: false,
    powerPreference: 'default', failIfMajorPerformanceCaveat: false
  });
} catch (e) {
  showFail('WebGL を初期化できませんでした。' + (e && e.message ? e.message : ''));
  throw e;
}
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault(); showFail('WebGL のコンテキストが失われました。ページを開き直してください。');
});
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
{ // 端末の素性を控えておく（うまく描けないときの切り分け用）
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  document.getElementById('glInfo').textContent =
    (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) +
    ' / ' + gl.getParameter(gl.VERSION) +
    ' / frag highp ' + (hp && hp.precision > 0 ? 'あり' : 'なし') +
    ' / ' + renderer.capabilities.precision + ' / AA ' + (small ? 'off' : 'on');
}
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 500);
const xcam = new THREE.OrthographicCamera(-12, 12, 16, -16, 1, 500);
const tiltGroup = new THREE.Group(); scene.add(tiltGroup);       // 撮影台（起倒する）
const bodyGroup = new THREE.Group(); tiltGroup.add(bodyGroup);   // 台の上の患者（体軸回転する）
const anatGroup = new THREE.Group(); bodyGroup.add(anatGroup);   // 体表・骨格（解剖座標）
tiltGroup.add(xcam);                                             // 管球・受像器も台に固定

const geom = new THREE.BufferGeometry();
geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
geom.setAttribute('aLevel', new THREE.BufferAttribute(aLevel, 1));
geom.setAttribute('aWet', new THREE.BufferAttribute(aWet, 1));
geom.setAttribute('aRug', new THREE.BufferAttribute(aRug, 3));
geom.setIndex(new THREE.BufferAttribute(indices, 1));

const VERT = `
attribute float aLevel; attribute float aWet; attribute vec3 aRug;
uniform vec3 uUp;
varying float vH; varying float vLevel; varying float vWet; varying vec3 vR;
varying vec3 vNL; varying vec3 vNW; varying vec3 vVd;
void main(){
  vH = dot(position, uUp); vLevel = aLevel; vWet = aWet; vNL = normal; vR = aRug;
  vec4 wp = modelMatrix * vec4(position,1.0);
  vNW = normalize(mat3(modelMatrix) * normal);
  vVd = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const RUGAE = `
float rugae(vec3 r, float on){
  float f = sin(r.y*6.2831*6.0 + r.x*24.0) * 0.5 + 0.5;
  f = pow(f, 1.9);
  return mix(1.0, 0.30 + 1.55*f, r.z * on);
}`;

const FRAG_SOLID = `
uniform vec3 uUp; uniform float uFlip; uniform float uRug;
varying float vH; varying float vLevel; varying float vWet; varying vec3 vR;
varying vec3 vNL; varying vec3 vNW; varying vec3 vVd;
${RUGAE}
void main(){
  vec3 n = normalize(vNW) * uFlip;
  vec3 nl = normalize(vNL) * uFlip;
  float below = step(vH, vLevel);
  float down = clamp(-dot(nl, uUp), 0.0, 1.0);
  float coat = smoothstep(0.12, 0.55, vWet);
  float dbl = (1.0 - below) * coat * smoothstep(0.02, 0.22, down);
  float rg = rugae(vR, uRug);
  vec3 cBar = vec3(0.957,0.969,0.984);
  vec3 cMuc = vec3(0.760,0.400,0.428);
  vec3 cDbl = vec3(0.74,0.76,0.79) * mix(1.0, rg, 0.50);   // 二重造影：粘膜に薄く付いたバリウム（灰色）
  vec3 base = mix(cMuc, cBar, below);
  base = mix(base, cDbl, dbl);
  float l1 = max(dot(n, normalize(vec3(0.42,0.80,0.62))), 0.0);
  float l2 = max(dot(n, normalize(vec3(-0.70,0.10,-0.45))), 0.0);
  float fr = pow(1.0 - max(dot(n, normalize(vVd)), 0.0), 2.1);
  vec3 col = base * (0.30 + 0.70*l1 + 0.24*l2) + vec3(0.34,0.46,0.56) * fr * 0.55;
  float a = mix(mix(0.17, 0.80, dbl), 0.985, below);
  a = max(a, fr * 0.48);
  gl_FragColor = vec4(col, a);
}`;

const FRAG_XRAY = `
uniform vec3 uUp; uniform float uRug;
varying float vH; varying float vLevel; varying float vWet; varying vec3 vR;
varying vec3 vNL; varying vec3 vNW; varying vec3 vVd;
${RUGAE}
void main(){
  vec3 n = normalize(vNW);
  float below = step(vH, vLevel);
  float coat = smoothstep(0.10, 0.50, vWet);
  float edge = clamp(1.0 / max(abs(dot(n, normalize(vVd))), 0.20), 1.0, 4.6);
  float d = below * 0.235 + (1.0 - below) * coat * 0.058 * rugae(vR, uRug);
  d *= edge;
  gl_FragColor = vec4(vec3(0.93,0.955,1.0) * d, 1.0);
}`;

const uUp = { value: new THREE.Vector3(0, 1, 0) };
const uRug = { value: 1 };
function solidMat(side, flip) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG_SOLID,
    uniforms: { uUp: uUp, uFlip: { value: flip }, uRug: uRug },
    transparent: true, depthWrite: false, side: side
  });
}
const matBack = solidMat(THREE.BackSide, -1), matFront = solidMat(THREE.FrontSide, 1);
const matXray = new THREE.ShaderMaterial({
  vertexShader: VERT, fragmentShader: FRAG_XRAY, uniforms: { uUp: uUp, uRug: uRug },
  transparent: true, depthWrite: false, depthTest: false,
  blending: THREE.AdditiveBlending, side: THREE.DoubleSide
});
const meshBack = new THREE.Mesh(geom, matBack); meshBack.renderOrder = 1;
const meshFront = new THREE.Mesh(geom, matFront); meshFront.renderOrder = 3;
bodyGroup.add(meshBack, meshFront);

/* ---- バリウム液面（ニボー）---- */
const surfPos = new Float32Array(NN * 18);
const surfGeom = new THREE.BufferGeometry();
surfGeom.setAttribute('position', new THREE.BufferAttribute(surfPos, 3));
surfGeom.setDrawRange(0, 0);
const matSurf = new THREE.ShaderMaterial({
  uniforms: {},
  vertexShader: `varying vec3 vP; void main(){ vP=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}`,
  fragmentShader: `varying vec3 vP;
    void main(){ float g = 0.80 + 0.20*sin(vP.x*1.6)*sin(vP.z*1.6);
      gl_FragColor = vec4(vec3(0.90,0.93,0.97)*g, 0.93); }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide
});
const matSurfX = new THREE.ShaderMaterial({
  uniforms: {}, vertexShader: `void main(){ gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}`,
  fragmentShader: `void main(){ gl_FragColor = vec4(vec3(0.93,0.955,1.0)*0.10, 1.0); }`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
});
const meshSurf = new THREE.Mesh(surfGeom, matSurf); meshSurf.renderOrder = 2;
bodyGroup.add(meshSurf);

/* ---- 体表 ---- */
const TORSO = [[25, 9.0, 6.4], [19, 12.6, 8.2], [13, 13.8, 9.0], [6, 13.4, 9.4], [-2, 12.9, 9.4],
               [-9, 12.6, 9.2], [-15, 13.4, 8.8], [-21, 11.6, 7.8], [-25, 8.6, 6.4]];
const torsoGeom = lathe(TORSO, 48, 36);
const matSkin = litMat(0xB8CBD8, 0.30, 0.07, 1.9), matSkinX = xrayMat(0.042, false, 3.2);
matSkin.side = THREE.FrontSide;
const meshSkin = new THREE.Mesh(torsoGeom, matSkin); meshSkin.renderOrder = 6;
anatGroup.add(meshSkin);

/* ---- 骨格（胸郭と脊椎だけ。目印として要るものに絞る）---- */
const boneGroup = new THREE.Group(); anatGroup.add(boneGroup);
const matBone = litMat(0xD6DEE6, 0.26, 0.07, 0.95), matBoneX = xrayMat(0.075, true, 2.1);
{
  const vb = new THREE.CylinderGeometry(1.75, 1.75, 2.25, 14, 1, false);
  for (let i = 0; i < 11; i++) {
    const m = new THREE.Mesh(vb, matBone);
    m.position.set(0, 14 - i * 3.0, -6.4); m.renderOrder = 0; boneGroup.add(m);
  }
  for (let i = 0; i < 5; i++) {
    const y = 13.4 - i * 3.1;
    for (const sx of [1, -1]) {
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(1.6 * sx, y, -6.0), new THREE.Vector3(7.0 * sx, y - 0.9, -3.2),
        new THREE.Vector3(9.9 * sx, y - 2.8, 1.6), new THREE.Vector3(7.3 * sx, y - 4.8, 4.9),
        new THREE.Vector3(3.4 * sx, y - 6.0, 6.2)]);
      const m = new THREE.Mesh(new THREE.TubeGeometry(c, 28, 0.34, 6, false), matBone);
      m.renderOrder = 0; boneGroup.add(m);
    }
  }
}

/* ---- 患者の全身（体表といっしょに透ける）---- */
const figureGroup = new THREE.Group(); anatGroup.add(figureGroup);
function addFig(g, x, y, z) {
  const m = new THREE.Mesh(g, matSkin); m.position.set(x, y, z); m.renderOrder = 6;
  figureGroup.add(m); return m;
}
{
  addFig(new THREE.CylinderGeometry(3.9, 4.6, 7, 16), 0, 27, 1);
  addFig(new THREE.SphereGeometry(7.8, 20, 16), 0, 34.5, 1.5);
  for (const sx of [1, -1]) {
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(12.0 * sx, 21.5, 1), new THREE.Vector3(15.8 * sx, 10, 2.4),
      new THREE.Vector3(15.4 * sx, -1, 3.4), new THREE.Vector3(13.6 * sx, -9, 4.2)]);
    addFig(new THREE.TubeGeometry(arm, 24, 3.1, 10, false), 0, 0, 0);
    const leg = new THREE.CatmullRomCurve3([
      new THREE.Vector3(6.2 * sx, -22, 1), new THREE.Vector3(7.2 * sx, -38, 2),
      new THREE.Vector3(6.6 * sx, -52, 2.6), new THREE.Vector3(6.4 * sx, -60, 3)]);
    addFig(new THREE.TubeGeometry(leg, 26, 5.1, 12, false), 0, 0, 0);
    addFig(new THREE.BoxGeometry(7, 4.5, 12), 6.4 * sx, -62, 7.5);
  }
}

/* ---- 鼻（顔が向いているほうが腹側）---- */
const matAnt = litMat(0xFFA94D, 0.95, 0.70, 0.55);
matAnt.side = THREE.FrontSide; matAnt.depthWrite = true;
const orientGroup = new THREE.Group(); anatGroup.add(orientGroup);
{
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.6, 14), matAnt);
  nose.position.set(0, 33.6, 8.2); nose.rotation.x = Math.PI / 2;
  nose.renderOrder = 7; orientGroup.add(nose);
}

/* ---- 透視台と台座（模型）---- */
function solidProp(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uC: { value: new THREE.Color(color) } },
    vertexShader: SIMPLE_VERT,
    fragmentShader: `uniform vec3 uC;
      varying vec3 vN; varying vec3 vVd; varying vec3 vL;
      void main(){
        vec3 n = normalize(vN);
        float l1 = max(dot(n, normalize(vec3(0.42,0.80,0.62))),0.0);
        float l2 = max(dot(n, normalize(vec3(-0.70,0.10,-0.45))),0.0);
        float fr = pow(1.0 - abs(dot(n, normalize(vVd))), 3.0);
        gl_FragColor = vec4(uC * (0.30 + 0.66*l1 + 0.26*l2) + vec3(0.30,0.42,0.52)*fr*0.35, 1.0);
      }`,
    transparent: false, depthWrite: true, side: THREE.FrontSide
  });
}
const matFrame = solidProp(0x4A5C6B);
const matPad = solidProp(0x263440);
const matGear = solidProp(0x6E7F8C);
function prop(parent, geo, mat, x, y, z, rx) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  m.renderOrder = 0; parent.add(m); return m;
}
const roomProps = new THREE.Group(); scene.add(roomProps);          // 床・台座（傾かない）
const roomBase = new THREE.Group(); roomProps.add(roomBase);         // 床・土台（台の起倒に合わせて上下する）
const uprights = [];                                                 // 台座と回転軸をつなぐ柱（伸び縮みする）
/* 台を起こすと足側が回転軸より下へ回り込む。実機では台が柱に沿って持ち上がるが、
   ここではカメラが患者を基準にしているので、そのぶん床と土台を下げ、柱を伸ばす。
   天板と足台の角のうち一番低い点が、床より少し上に来るだけの量を求める。 */
const FLOOR_Y = -38;
const TABLE_CORNERS = [[-58, -14.5], [-58, -9.5], [74, -14.5], [76.5, -12], [76.5, 14]];
function floorDrop(tiltDeg) {
  const t = tiltDeg * Math.PI / 180, sn = Math.sin(t), cs = Math.cos(t);
  let low = Infinity;
  for (const [x, y] of TABLE_CORNERS) low = Math.min(low, -x * sn + y * cs);
  return Math.max(0, low < FLOOR_Y + 1.5 ? (FLOOR_Y + 1.5) - low : 0);
}
function placeRoom() {
  const d = floorDrop(tiltCur);
  roomBase.position.y = -d;
  const h = 35 + d;                                 // 台座の上面（床 +3）から回転軸まで
  for (const u of uprights) { u.scale.y = h / 21; u.position.y = -h / 2; }
}
const tableProps = new THREE.Group(); tiltGroup.add(tableProps);    // 天板・管球・受像器（傾く）
{
  const grid2 = new THREE.GridHelper(180, 18, 0x243442, 0x172230);
  grid2.material.transparent = true; grid2.material.opacity = 0.30;
  grid2.position.y = -38; roomBase.add(grid2);
  for (const sz of [1, -1]) {   // 台座は天板の両脇だけに置き、立位で足台・足先と重ならないようにする
    prop(roomBase, new THREE.BoxGeometry(14, 3, 9), matFrame, 0, -36.5, 33 * sz);
    uprights.push(prop(roomProps, new THREE.BoxGeometry(5, 21, 5), matFrame, 0, -10.5, 33 * sz));
    prop(roomProps, new THREE.CylinderGeometry(3.4, 3.4, 6, 16), matGear, 0, 0, 32 * sz, Math.PI / 2);   // 回転軸
  }
  prop(tableProps, new THREE.BoxGeometry(132, 5, 50), matPad, 8, -12, 0);       // 天板
  prop(tableProps, new THREE.BoxGeometry(5, 26, 50), matPad, 74, 1, 0);         // 足台
  prop(tableProps, new THREE.BoxGeometry(120, 2.5, 6), matFrame, 8, -9, 26);    // 側レール
  prop(tableProps, new THREE.BoxGeometry(120, 2.5, 6), matFrame, 8, -9, -26);
  for (const sz of [1, -1])                                                     // 側レールから回転軸までの腕
    prop(tableProps, new THREE.BoxGeometry(10, 14.5, 2), matFrame, 0, -3.5, 29 * sz);
}

/* ---- ガイド ---- */
const guides = new THREE.Group(); scene.add(guides);
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-15, 8, 0), 11, 0x52B8CE, 3.0, 1.9);
guides.add(arrow);
