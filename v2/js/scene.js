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
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;   // r128 と同じく、描いた色をそのまま出す
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
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
const xcam = new THREE.OrthographicCamera(-12, 12, 16, -16, 1, 500);
const tiltGroup = new THREE.Group(); scene.add(tiltGroup);       // 撮影台（起倒する）
const bodyGroup = new THREE.Group(); tiltGroup.add(bodyGroup);   // 台の上の患者（体軸回転する）
const anatGroup = new THREE.Group(); bodyGroup.add(anatGroup);   // 体表・骨格（解剖座標）
const BODY_SCALE = 1.2;          // 胃と体の模型を実寸（身長およそ 170 cm）に合わせる倍率（DIMENSIONS.md）
bodyGroup.scale.setScalar(BODY_SCALE);
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
  addFig(new THREE.CylinderGeometry(3.9, 4.6, 9, 16), 0, 29, 1);
  addFig(new THREE.SphereGeometry(7.8, 20, 16), 0, 38.5, 1.5);
  for (const sx of [1, -1]) {
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(12.0 * sx, 21.5, 1), new THREE.Vector3(15.8 * sx, 10, 2.4),
      new THREE.Vector3(15.4 * sx, -1, 3.4), new THREE.Vector3(13.6 * sx, -9, 4.2)]);
    addFig(new THREE.TubeGeometry(arm, 24, 3.1, 10, false), 0, 0, 0);
    const leg = new THREE.CatmullRomCurve3([
      new THREE.Vector3(6.2 * sx, -22, 1), new THREE.Vector3(7.2 * sx, -46, 2),
      new THREE.Vector3(6.6 * sx, -72, 2.6), new THREE.Vector3(6.4 * sx, -91, 3)]);
    addFig(new THREE.TubeGeometry(leg, 30, 5.1, 12, false), 0, 0, 0);
    addFig(new THREE.BoxGeometry(7, 4.5, 12), 6.4 * sx, -93.5, 7.5);
  }
}

/* ---- 鼻（顔が向いているほうが腹側）---- */
const matAnt = litMat(0xFFA94D, 0.95, 0.70, 0.55);
matAnt.side = THREE.FrontSide; matAnt.depthWrite = true;
const orientGroup = new THREE.Group(); anatGroup.add(orientGroup);
{
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.8, 3.6, 14), matAnt);
  nose.position.set(0, 37.6, 8.2); nose.rotation.x = Math.PI / 2;
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
const roomProps = new THREE.Group(); scene.add(roomProps);          // 透視室・操作室・台座（動かない）
const tableProps = new THREE.Group(); tiltGroup.add(tableProps);    // 天板・受像器・X 線管（台といっしょに傾く）
const cradle = new THREE.Group(); scene.add(cradle);                // 回転軸のまわりの受け枠（傾くが、滑らない）
const partition = new THREE.Group(); roomProps.add(partition);      // 仕切り壁・窓・操作室の机（画面でカメラが操作室側に出たら隠す）
const ROOM_Z0 = 250;                                                 // 仕切り壁の位置（z）

/* 透視台（tiltGroup の座標。原点 = 胃、x = 足側、y = X 線管の側（天板の法線）、z = 左右）。
   台は回転軸を中心に起倒する。立位や逆傾斜で天板の端が床に当たらないよう、
   実機と同じく天板が長手方向に滑る（回転軸に対する天板の位置 tablePx が変わる）。 */
const TB = {
  top: -9.6,              // 天板の上面（胃の中心から背中側へ）
  thick: 5, house: 17,    // 天板の厚さ、天板の下の受像器の箱の厚さ
  x0: -86.5, x1: 123.5,   // 天板の頭側・足側の端（長さ 210）
  w: 75,                  // 天板の幅
  foot: 25,               // 足台の高さ
  pivotY: -22.6,          // 回転軸の高さ（天板の上面から 13 cm 下）
  pivotH: 67,             // 回転軸の床からの高さ（水平のとき天板の上面が床から 80 cm）
  sid: 120,               // X 線管の焦点と受像器の距離
  clear: 3                // 起倒したとき、台の一番低い点を床から離しておく距離
};
const TB_BOTTOM = TB.top - TB.thick - TB.house;
const TB_CORNERS = [[TB.x0, TB.top], [TB.x0, TB_BOTTOM], [TB.x1, TB_BOTTOM], [TB.x1, TB.top + TB.foot]];
const PX0 = (TB.x0 + TB.x1) / 2;   // 水平のときは天板の真ん中に回転軸がある
let tablePx = PX0;
const _tv = new THREE.Vector3();
function placeTable() {
  const t = tiltCur * Math.PI / 180, sn = Math.sin(t), cs = Math.cos(t);
  let px = PX0;
  for (let k = 0; k < 3 && Math.abs(sn) > 1e-3; k++) {
    let low = Infinity;
    for (const [x, y] of TB_CORNERS) low = Math.min(low, TB.pivotH - (x - px) * sn + (y - TB.pivotY) * cs);
    if (low >= TB.clear - 1e-6) break;
    px += (TB.clear - low) / sn;
  }
  tablePx = px;
  // 胃（tiltGroup の原点）の床上の位置 = 回転軸 − 回転した（回転軸の天板上の位置）
  tiltGroup.position.set(0, TB.pivotH, 0).sub(_tv.set(px, TB.pivotY, 0).applyQuaternion(tiltGroup.quaternion));
  cradle.position.set(0, TB.pivotH, 0);
  cradle.quaternion.copy(tiltGroup.quaternion);
}
const matWall = solidProp(0x202C37), matFloor = solidProp(0x18222B), matCeil = solidProp(0x141C24);
const matDark = solidProp(0x0D1318), matScreen = solidProp(0x0A2230);
const matGlass = new THREE.MeshBasicMaterial({ color: 0x6FA4B8, transparent: true, opacity: 0.10, depthWrite: false, side: THREE.DoubleSide });
function plane(w, h, mat, x, y, z, ry, rx) {   // 表（内側）だけ見える壁。外から見ると透ける
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0, 'YXZ');
  roomProps.add(m); return m;
}
function box(parent, w, h, d, mat, x, y, z) { return prop(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z); }
{
  /* ---- 天板・足台・受像器の箱（台といっしょに傾き、滑る）---- */
  const len = TB.x1 - TB.x0, cx = (TB.x0 + TB.x1) / 2;
  box(tableProps, len, TB.thick, TB.w, matPad, cx, TB.top - TB.thick / 2, 0);                    // 天板
  box(tableProps, len - 10, TB.house, TB.w - 6, matFrame, cx - 3, TB.top - TB.thick - TB.house / 2, 0);   // 受像器の箱
  box(tableProps, 4, TB.foot, TB.w - 10, matPad, TB.x1 - 2, TB.top + TB.foot / 2, 0);            // 足台
  for (const sz of [1, -1]) box(tableProps, len - 20, 2.5, 4, matFrame, cx, TB.top - 1, sz * (TB.w / 2 + 2));   // 側レール

  /* ---- X 線管（オーバーチューブ）。映像系は胃の位置に合わせて天板の上を動く ---- */
  const fpdY = TB.top - TB.thick - 3, fy = fpdY + TB.sid;         // 受像器の面、焦点
  box(tableProps, 47, 3, 47, matDark, 0, fpdY, 0);                 // 受像器（FPD 43 × 43 cm）
  const tube = prop(tableProps, new THREE.CylinderGeometry(9, 9, 34, 20), matGear, 0, fy + 10, 0, Math.PI / 2);   // 管球
  tube.rotation.set(Math.PI / 2, 0, 0);
  box(tableProps, 22, 12, 22, matFrame, 0, fy - 6, 0);             // 絞り
  prop(tableProps, new THREE.CylinderGeometry(5, 5, 10, 20), matGear, 0, fy - 17, 0);   // 圧迫筒（たたんだ状態。第 3 段階で動かす）
  const armZ = -(TB.w / 2 + 16);                                  // 支柱は窓と反対側（−z）に置く
  box(tableProps, 10, 10, armZ, matFrame, 0, fy + 10, armZ / 2);   // 横の腕
  box(tableProps, 12, fy + 15 - TB_BOTTOM, 12, matFrame, 0, (fy + 15 + TB_BOTTOM) / 2, armZ);   // 支柱

  /* ---- 回転軸の受け枠（傾くが滑らない）と、床に立つ 2 本の柱 ---- */
  for (const sz of [1, -1]) {
    const zr = sz * (TB.w / 2 + 6);
    box(cradle, 70, TB.house + TB.thick, 3, matFrame, 0, (TB.top - TB.pivotY) - (TB.house + TB.thick) / 2, zr);
    prop(cradle, new THREE.CylinderGeometry(6, 6, 6, 20), matGear, 0, 0, sz * (TB.w / 2 + 10), Math.PI / 2);
    box(roomProps, 10, TB.pivotH, 10, matFrame, 0, TB.pivotH / 2, sz * (TB.w / 2 + 14));
    box(roomProps, 36, 3, 18, matFrame, 0, 1.5, sz * (TB.w / 2 + 14));
  }

  /* ---- 透視室（5.0 × 6.0 m、天井 2.8 m）と操作室（隣、5.0 × 3.0 m）---- */
  const H = 280, X = 250, Z0 = ROOM_Z0, Z1 = -350, ZC = 550;      // 仕切り壁は z = +250。操作室はその向こう（+z）
  const D = Math.abs(ZC - Z1), ZM = (Z1 + ZC) / 2;                     // 両室あわせた奥行き
  plane(2 * X, D, matFloor, 0, 0, ZM, 0, -Math.PI / 2);                  // 床（両室）
  plane(2 * X, D, matCeil, 0, H, ZM, 0, Math.PI / 2);                    // 天井
  plane(D, H, matWall, -X, H / 2, ZM, Math.PI / 2);                      // 左右の壁
  plane(D, H, matWall, X, H / 2, ZM, -Math.PI / 2);
  plane(2 * X, H, matWall, 0, H / 2, Z1, 0);                                // 奥の壁
  plane(2 * X, H, matWall, 0, H / 2, ZC, Math.PI);                          // 操作室の奥の壁
  const g = new THREE.GridHelper(500, 20, 0x2A3B4A, 0x1D2935);
  g.material.transparent = true; g.material.opacity = 0.35; g.position.set(0, 0.2, -50); roomProps.add(g);
  // 仕切り壁と鉛ガラスの窓（幅 1.2 m × 高さ 0.9 m、床から 0.9 m）
  const WX = 60, WY0 = 90, WY1 = 180, T = 15;
  box(partition, X - WX, H, T, matWall, -(X + WX) / 2, H / 2, Z0);
  box(partition, X - WX, H, T, matWall, (X + WX) / 2, H / 2, Z0);
  box(partition, 2 * WX, WY0, T, matWall, 0, WY0 / 2, Z0);
  box(partition, 2 * WX, H - WY1, T, matWall, 0, (H + WY1) / 2, Z0);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(2 * WX, WY1 - WY0), matGlass);
  glass.position.set(0, (WY0 + WY1) / 2, Z0); glass.renderOrder = 8; partition.add(glass);

  /* ---- 透視室のモニタ（55 インチ）、近接操作卓、操作室の遠隔操作卓 ---- */
  box(roomProps, 122, 69, 5, matDark, 60, 175, Z1 + 4);                // 奥の壁のモニタ
  box(roomProps, 116, 63, 1, matScreen, 60, 175, Z1 + 7);
  box(roomProps, 6, 100, 6, matFrame, -150, 50, 70);                   // 近接操作卓（台の頭側、窓の側）
  box(roomProps, 40, 6, 28, matFrame, -150, 102, 70);
  box(partition, 180, 6, 70, matFrame, 0, 75, Z0 + 50);                // 遠隔操作卓の机
  for (const sx of [1, -1]) box(partition, 6, 72, 60, matFrame, sx * 84, 36, Z0 + 50);
  box(partition, 30, 36, 4, matDark, -75, 100, Z0 + 30);               // 机の上のモニタ 2 台（窓の左右。窓をふさがない）
  box(partition, 30, 36, 4, matDark, 75, 100, Z0 + 30);
  box(partition, 70, 4, 26, matDark, 0, 80, Z0 + 40);                  // 操作盤
}
/* ---- 透視像をモニタに映す（xray.js の renderFluoro が毎フレーム描く）---- */
const FLUORO_W = 256, FLUORO_H = 320;
const fluoroRT = new THREE.WebGLRenderTarget(FLUORO_W, FLUORO_H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
const matMonitor = new THREE.MeshBasicMaterial({ map: fluoroRT.texture });
function monitorImage(h, x, y, z) {   // 縦 h cm の透視像（縦横比 4:5）を +z 向きに貼る
  const m = new THREE.Mesh(new THREE.PlaneGeometry(h * FLUORO_W / FLUORO_H, h), matMonitor);
  m.position.set(x, y, z); return m;
}
roomProps.add(monitorImage(60, 60, 175, -350 + 7.6));          // 透視室の奥の壁の 55 インチ
partition.add(monitorImage(32, -75, 100, ROOM_Z0 + 32.2));      // 操作室の机の左のモニタ
const OPERATOR_EYE = new THREE.Vector3(0, 118, 345);   // 操作室で座った術者の目の位置（窓から 95 cm）

/* ---- ガイド ---- */
const guides = new THREE.Group(); scene.add(guides);
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-15, 8, 0), 11, 0x52B8CE, 3.0, 1.9);
guides.add(arrow);
