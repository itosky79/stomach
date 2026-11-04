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
                uA: { value: new THREE.Vector2(baseA === undefined ? 0.34 : baseA, rimA === undefined ? 1.25 : rimA) },
                uR: { value: new THREE.Color(0.36, 0.50, 0.60) } },   // ふちの光の色（ライトでは暗くする。setTheme3D）
    vertexShader: SIMPLE_VERT,
    fragmentShader: `uniform vec3 uC; uniform float uO; uniform vec2 uA; uniform vec3 uR;
      varying vec3 vN; varying vec3 vVd; varying vec3 vL;
      void main(){
        vec3 n = normalize(vN);
        float l1 = max(dot(n, normalize(vec3(0.42,0.80,0.62))),0.0);
        float l2 = max(dot(n, normalize(vec3(-0.70,0.10,-0.45))),0.0);
        float fr = pow(1.0 - abs(dot(n, normalize(vVd))), 2.4);
        vec3 col = uC * (0.34 + 0.62*l1 + 0.22*l2) + uR*fr*0.7;
        gl_FragColor = vec4(col, clamp(uO * (uA.x + uA.y*fr), 0.0, 1.0));
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide
  });
}
function xrayMat(density, bone, edgeCap, dia) {   // dia：横隔膜の高さ（メッシュの座標の y）。これより頭側は肺野
  return new THREE.ShaderMaterial({
    uniforms: { uD: { value: density }, uBone: { value: bone ? 1 : 0 }, uE: { value: edgeCap || 5.0 }, uDia: { value: dia === undefined ? 13.5 : dia } },
    vertexShader: SIMPLE_VERT,
    fragmentShader: `uniform float uD; uniform float uBone; uniform float uE; uniform float uDia;
      varying vec3 vN; varying vec3 vVd; varying vec3 vL;
      void main(){
        vec3 n = normalize(vN);
        float edge = clamp(1.0/max(abs(dot(n, normalize(vVd))),0.16), 1.0, uE);
        float d = uD * edge;
        // 横隔膜より頭側は肺野なので軟部組織の濃度を落とす
        if(uBone < 0.5){ float dia = uDia - 0.05*vL.x*vL.x; d *= mix(1.0, 0.18, smoothstep(dia-1.5, dia+2.0, vL.y)); }
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
{ // 端末の素性を控えておく（うまく描けないときの切り分け用）。以前は画面の「表示と操作」の末尾に出していたが、
  // 利用者には要らないので、ブラウザの開発者ツールのコンソールにだけ出す
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
  console.info('GPU:',
    (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) +
    ' / ' + gl.getParameter(gl.VERSION) +
    ' / frag highp ' + (hp && hp.precision > 0 ? 'あり' : 'なし') +
    ' / ' + renderer.capabilities.precision + ' / AA ' + (small ? 'off' : 'on'));
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
uniform vec3 uUp; uniform float uFlip; uniform float uRug; uniform vec3 uRimS; uniform float uMucA;
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
  vec3 col = base * (0.30 + 0.70*l1 + 0.24*l2) + uRimS * fr * 0.55;
  float a = mix(mix(uMucA, 0.80, dbl), 0.985, below);
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
const uRimS = { value: new THREE.Color(0.34, 0.46, 0.56) }, uMucA = { value: 0.17 };   // 胃のふちの光の色と、粘膜の不透明度（ライトでは変える。setTheme3D）
function solidMat(side, flip) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG_SOLID,
    uniforms: { uUp: uUp, uFlip: { value: flip }, uRug: uRug, uRimS: uRimS, uMucA: uMucA },
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

/* ---- 飲んでいる間、噴門から胃の壁を伝って流れるバリウム（壁に沿った細い帯。sim.js の updatePour が形を決める）---- */
const POUR_MAX = 600;
const pourGeom = new THREE.BufferGeometry();
pourGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POUR_MAX * 6), 3));
{ const ix = new Uint16Array((POUR_MAX - 1) * 6);
  for (let i = 0; i < POUR_MAX - 1; i++) { const a = i * 2; ix.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6); }
  pourGeom.setIndex(new THREE.BufferAttribute(ix, 1)); }
pourGeom.setDrawRange(0, 0);
const matPour = new THREE.MeshBasicMaterial({ color: 0xF4F7FB, transparent: true, opacity: 0.97, depthWrite: false, side: THREE.DoubleSide });
const matPourX = new THREE.ShaderMaterial({
  uniforms: {}, vertexShader: `void main(){ gl_Position=projectionMatrix*viewMatrix*modelMatrix*vec4(position,1.0);}`,
  fragmentShader: `void main(){ gl_FragColor = vec4(vec3(0.93,0.955,1.0)*0.30, 1.0); }`,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
});
const pourMesh = new THREE.Mesh(pourGeom, matPour);
pourMesh.renderOrder = 2; pourMesh.visible = false; pourMesh.frustumCulled = false;
bodyGroup.add(pourMesh);


/* ---- 患者の体表と骨（BodyParts3D。js/anatomy-data.js、tools/build_anatomy.py で作る）----
   BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International
   座標は bodyGroup と同じ（胃の中心が原点、x = 左、y = 頭側、z = 腹側、単位は実寸 cm / BODY_SCALE） */
function bp3dGeom(d) {
  const q = new Uint16Array(Uint8Array.from(atob(d.pos), ch => ch.charCodeAt(0)).buffer);
  const pos = new Float32Array(d.n * 3);
  for (let i = 0; i < d.n * 3; i++) pos[i] = d.lo[i % 3] + q[i] * d.s[i % 3];
  const ib = Uint8Array.from(atob(d.idx), ch => ch.charCodeAt(0)).buffer;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(d.i32 ? new Uint32Array(ib) : new Uint16Array(ib), 1));
  g.computeVertexNormals();
  return g;
}
const matSkin = litMat(0xB8CBD8, 0.30, 0.07, 1.9), matSkinX = xrayMat(0.042, false, 3.2, BP3D.meta.dia);
matSkin.side = THREE.FrontSide;
/* 体（体表・骨）は bodyFit に入れ、胃の型ごとに噴門が重なるよう動かす（sim.js の fitBodyToStomach） */
const bodyFit = new THREE.Group(); bodyGroup.add(bodyFit);
/* 体表の性器は教材に要らないので、周りの肌になじませて消す。
   股の前の範囲（R）で、周りの前面の肌に合わせた二次式の面より手前にある点を、隣の点の平均へ何度も寄せる（ラプラシアン平滑化）。
   R の外の点は動かさないので、性器は付け根の周りの肌をつなぐ滑らかな面になる。範囲は今の anatomy-data.js の体に合わせてある。 */
function smoothGroin(g) {
  const a = g.attributes.position.array, n = a.length / 3;
  const inR = (x, y) => x > -8 && x < 2 && y > -36.5 && y < -23.5;
  const M = Array.from({ length: 6 }, () => new Array(7).fill(0));
  for (let i = 0; i < n; i++) {
    const x = a[3 * i], y = a[3 * i + 1], z = a[3 * i + 2];
    if (x > -13 && x < 7 && y > -41 && y < -19 && z > -1 && !inR(x, y)) {
      const r = [1, x, y, x * x, x * y, y * y];
      for (let p = 0; p < 6; p++) { for (let q = 0; q < 6; q++) M[p][q] += r[p] * r[q]; M[p][6] += r[p] * z; }
    }
  }
  for (let p = 0; p < 6; p++) {
    let m = p; for (let r = p + 1; r < 6; r++) if (Math.abs(M[r][p]) > Math.abs(M[m][p])) m = r;
    [M[p], M[m]] = [M[m], M[p]];
    for (let r = 0; r < 6; r++) if (r !== p) { const f = M[r][p] / M[p][p]; for (let c = p; c < 7; c++) M[r][c] -= f * M[p][c]; }
  }
  const c = M.map((r, p) => r[6] / r[p]);
  const zf = (x, y) => c[0] + c[1] * x + c[2] * y + c[3] * x * x + c[4] * x * y + c[5] * y * y;
  const free = [];
  for (let i = 0; i < n; i++) if (inR(a[3 * i], a[3 * i + 1]) && a[3 * i + 2] > zf(a[3 * i], a[3 * i + 1]) - 4) free.push(i);
  const ix = g.index.array, nb = new Map(free.map(i => [i, new Set()]));
  for (let t = 0; t < ix.length; t += 3) for (let k = 0; k < 3; k++) {
    const u = ix[t + k], v = ix[t + (k + 1) % 3];
    if (nb.has(u)) nb.get(u).add(v); if (nb.has(v)) nb.get(v).add(u);
  }
  const N = free.map(i => [...nb.get(i)]), tmp = new Float32Array(a.length);
  for (let it = 0; it < 400; it++) {
    tmp.set(a);
    free.forEach((i, k) => {
      let sx = 0, sy = 0, sz = 0;
      for (const j of N[k]) { sx += tmp[3 * j]; sy += tmp[3 * j + 1]; sz += tmp[3 * j + 2]; }
      const m = N[k].length; a[3 * i] = sx / m; a[3 * i + 1] = sy / m; a[3 * i + 2] = sz / m;
    });
  }
  g.computeVertexNormals();
  return g;
}
const meshSkin = new THREE.Mesh(smoothGroin(bp3dGeom(BP3D.skin)), matSkin); meshSkin.renderOrder = 6;
bodyFit.add(meshSkin);

/* ---- 骨格（胸郭・胸骨と脊椎だけ。目印として要るものに絞る）---- */
const boneGroup = new THREE.Group(); bodyFit.add(boneGroup);
const matBone = litMat(0xD6DEE6, 0.26, 0.07, 0.95), matBoneX = xrayMat(0.030, true, 1.8);   // BodyParts3D の骨は面が多いので薄めに
{ const m = new THREE.Mesh(bp3dGeom(BP3D.bones), matBone); m.renderOrder = 0; boneGroup.add(m); }

/* 体表が全身を覆うので、手足や頭を別に作る必要はなくなった（表示の切り替えのために箱だけ残す） */
const figureGroup = new THREE.Group(); bodyFit.add(figureGroup);

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
/* 手前の装置（X 線管・絞り・圧迫筒と、それを支える腕・支柱）：カメラに近づいて画面を覆うと胃が見えなくなるので、
   ふだんから少し透かし（FADE_ALPHA.base）、画面の 1/10 以上を覆ったら大きく透かす（FADE_ALPHA.cover）。
   画面の上で胃と重なり、胃より手前にある部品は、大きさによらずほとんど消す（FADE_ALPHA.front）。
   部品ごとに材質を分け、xray.js の render で毎回、部品ごとに決める */
const FADE_ALPHA = { base: 0.8, cover: 0.25, front: 0.08, from: 0.07, to: 0.10 };   // from〜to：画面に占める割合で滑らかに切り替える。front：胃の手前に重なるとき
let themeReady = false;   // setTheme3D が一度動いたら true（それより前は配色の値がまだ無い）
function fadeMat(color) {
  const m = solidProp(color);
  m.userData.base = color;   // 配色で明るくするときの元の色（setTheme3D・tintEquip）
  if (themeReady) tintEquip(m);
  m.uniforms.uA = { value: FADE_ALPHA.base };
  m.fragmentShader = m.fragmentShader.replace('uniform vec3 uC;', 'uniform vec3 uC; uniform float uA;')
    .replace('*fr*0.35, 1.0);', '*fr*0.35, uA);');
  m.transparent = true; m.depthWrite = false;
  return m;
}
let fadeParts = [];
function fadePart(mesh) { mesh.renderOrder = 8; fadeParts.push(mesh); return mesh; }   // 透けるので、不透明なものの後に描く
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
let roomGrid = null;                                                 // 床の格子（色の切り替えで色を変える）
const DOOR = [150, 240], DOOR_H = 210;                               // 仕切り壁の扉の開口（x の範囲、高さ）

/* 透視台（tiltGroup の座標。原点 = 胃、x = 足側、y = X 線管の側（天板の法線）、z = 左右）。
   台は回転軸（支点、床から TB.pivotH）を中心に起倒する。水平のときは天板の真ん中に支点がある。
   中央から端まで 105 cm あり支点より長いので、立てるにつれて天板を長さ方向に滑らせ、床に当たらないようにする（slideFor）。 */
const TB = {
  top: 0,                 // 天板の上面（胃の中心から背中まで。体の位置から setTableToBody で決める）
  thick: 5, house: 17,    // 天板の厚さ、天板の下の受像器の箱の厚さ
  x1: 0,                  // 天板の足側の端（足の裏の 0.5 cm 先に厚さ 4 cm の足台。同上）
  w: 75,                  // 天板の幅
  len: 210,               // 天板の長さ
  foot: 25,               // 足台の高さ
  pivotY: 0,              // 回転軸の高さ（天板の上面から 13 cm 下。下で決める）
  pivotH: 67,             // 回転軸の床からの高さ（水平のとき天板の上面が床から 80 cm）
  sid: 120,               // X 線管の焦点と受像器の距離
  clear: 3                // 起倒したとき、台の一番低い点を床から離しておく距離
};
let TB_BOTTOM = 0, TB_CORNERS = [], PX0 = 0, SWEEP = [], pivotNow = 67;
let tablePx = 0;
const _tv = new THREE.Vector3();
/* 体（bodyFit）の位置 off（bodyGroup の座標）から、天板の高さと足台の位置を決める。
   tiltGroup の座標では、体の腹側（bodyGroup の z）が +y、頭側（bodyGroup の y）が −x、単位は実寸 cm（× BODY_SCALE）。 */
function setTableToBody(off) {
  TB.top = -(BP3D.meta.back + 0.3) + off.z * BODY_SCALE;      // 背中のすぐ下に天板の上面
  TB.x1 = BP3D.meta.sole - off.y * BODY_SCALE + 0.5 + 4;      // 足の裏の 0.5 cm 先に厚さ 4 cm の足台
  TB.x0 = TB.x1 - TB.len;
  TB.pivotY = TB.top - 13;
  TB_BOTTOM = TB.top - TB.thick - TB.house;
  TB_CORNERS = [[TB.x0, TB.top], [TB.x0, TB_BOTTOM], [TB.x1, TB_BOTTOM], [TB.x1, TB.top + TB.foot]];
  PX0 = (TB.x0 + TB.x1) / 2;   // 水平のときは天板の真ん中に回転軸がある
  buildTable();
}
/* その角度で、台と X 線管の全部の角（SWEEP）が床から TB.clear 以上離れるのに要る、天板の滑り（PX0 からのずれ）。
   立てる側（+）は頭側へ（px を大きく）、逆傾斜の側（−）は足側へ（px を小さく）滑らせる。滑らせなくてよいときは 0 */
function slideNeed(tiltDeg, clear) {
  const t = tiltDeg * Math.PI / 180, sn = Math.sin(t), cs = Math.cos(t);
  if (Math.abs(sn) < 1e-6) return 0;
  let d = 0;
  for (const [x, y] of SWEEP) {
    const px = x - (TB.pivotH - clear + (y - TB.pivotY) * cs) / sn;   // この角がちょうど床から clear になる px
    d = sn > 0 ? Math.max(d, px - PX0) : Math.min(d, px - PX0);
  }
  return d;
}
/* 天板の滑り：台と X 線管の一番低い点が、床から CLEAR_AT（角度）の高さになるだけ滑らせる。
   CLEAR_AT は ±90° で TB.clear（3 cm。立位で足台が床のすぐ上）、寝かせるほど大きくする（3 + 30 ×（1 − |sin|）cm）。
   床に当たる最低限（いつも 3 cm）だけ滑らせると、台の端が床をなめるように動いて見えたため。
   実機でも、起倒しながら台を長さ方向に動かす作りがある（米国特許 US4013019 の要約。原文は未確認） */
const CLEAR_AT = a => TB.clear + 30 * (1 - Math.abs(Math.sin(a * Math.PI / 180)));
/* 滑りの表（−90°〜+90°、0.5° ごと）。要る滑りに、角度 1° あたり SLIDE_RATE cm より急に変わらない上側の包絡をかぶせて、
   滑り始めや滑り終わりで急に動かないようにする（包絡は要る滑り以上なので、床からの高さは CLEAR_AT 以上のまま） */
const SLIDE_RATE = 1.0;
let SLIDE_TAB = null;
function buildSlideTab() {
  const n = 361, need = new Float64Array(n);
  for (let i = 0; i < n; i++) need[i] = slideNeed(-90 + i * 0.5, CLEAR_AT(-90 + i * 0.5));
  SLIDE_TAB = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let up = 0, dn = 0;   // 頭側（+）と足側（−）を別々に包む
    for (let j = 0; j < n; j++) {
      const r = SLIDE_RATE * Math.abs(i - j) * 0.5;
      if (need[j] > 0) up = Math.max(up, need[j] - r); else dn = Math.min(dn, need[j] + r);
    }
    SLIDE_TAB[i] = (-90 + i * 0.5) >= 0 ? up : dn;
  }
}
function slideFor(tiltDeg) {
  if (!SLIDE_TAB) return 0;
  const f = (Math.max(-90, Math.min(90, tiltDeg)) + 90) * 2, i = Math.min(359, Math.floor(f)), t = f - i;
  return SLIDE_TAB[i] * (1 - t) + SLIDE_TAB[i + 1] * t;
}
function placeTable() {
  tablePx = PX0 + slideFor(tiltCur);
  pivotNow = TB.pivotH;
  // 胃（tiltGroup の原点）の床上の位置 = 回転軸 − 回転した（回転軸の天板上の位置）
  tiltGroup.position.set(0, pivotNow, 0).sub(_tv.set(tablePx, TB.pivotY, 0).applyQuaternion(tiltGroup.quaternion));
  cradle.position.set(0, pivotNow, 0);
  cradle.quaternion.copy(tiltGroup.quaternion);
}
const pedestalPosts = [];   // 床の柱（高さは変わらない）
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
  /* ---- 床に立つ 2 本の柱（回転軸を支える）---- */
  for (const sz of [1, -1]) {
    pedestalPosts.push(box(roomProps, 10, TB.pivotH, 10, matFrame, 0, TB.pivotH / 2, sz * (TB.w / 2 + 14)));
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
  const g = roomGrid = new THREE.GridHelper(500, 20, 0x2A3B4A, 0x1D2935);
  g.material.transparent = true; g.material.opacity = 0.35; g.position.set(0, 0.2, -50); roomProps.add(g);
  // 仕切り壁と鉛ガラスの窓（幅 1.2 m × 高さ 0.9 m、床から 0.9 m）
  const WX = 60, WY0 = 90, WY1 = 180, T = 15;
  box(partition, X - WX, H, T, matWall, -(X + WX) / 2, H / 2, Z0);
  // 右の壁には操作室から透視室へ入る扉の開口（幅 90 cm × 高さ 210 cm、x = DOOR[0]〜DOOR[1]）を空ける
  box(partition, DOOR[0] - WX, H, T, matWall, (DOOR[0] + WX) / 2, H / 2, Z0);
  box(partition, X - DOOR[1], H, T, matWall, (X + DOOR[1]) / 2, H / 2, Z0);
  box(partition, DOOR[1] - DOOR[0], H - DOOR_H, T, matWall, (DOOR[0] + DOOR[1]) / 2, (H + DOOR_H) / 2, Z0);
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
/* 天板・足台・受像器・X 線管・回転軸の受け枠を作る（胃の型が変わると体の位置が変わるので作り直す） */
function buildTable() {
  for (const g of [tableProps, cradle]) while (g.children.length) {
    const m = g.children.pop(); if (m.geometry) m.geometry.dispose();
  }
  fadeParts.forEach(m => m.material.dispose()); fadeParts = [];
  /* ---- 天板・足台・受像器の箱（台といっしょに傾き、滑る）---- */
  const len = TB.x1 - TB.x0, cx = (TB.x0 + TB.x1) / 2;
  box(tableProps, len, TB.thick, TB.w, matPad, cx, TB.top - TB.thick / 2, 0);                    // 天板
  box(tableProps, len - 10, TB.house, TB.w - 6, matFrame, cx - 3, TB.top - TB.thick - TB.house / 2, 0);   // 受像器の箱
  box(tableProps, 4, TB.foot, TB.w - 10, matPad, TB.x1 - 2, TB.top + TB.foot / 2, 0);            // 足台
  for (const sz of [1, -1]) box(tableProps, len - 20, 2.5, 4, matFrame, cx, TB.top - 1, sz * (TB.w / 2 + 2));   // 側レール

  /* ---- X 線管（オーバーチューブ）。映像系は胃の位置に合わせて天板の上を動く ---- */
  const fpdY = TB.top - TB.thick - 3, fy = fpdY + TB.sid;         // 受像器の面、焦点
  box(tableProps, 47, 3, 47, matDark, 0, fpdY, 0);                 // 受像器（FPD 43 × 43 cm）
  const tube = fadePart(prop(tableProps, new THREE.CylinderGeometry(9, 9, 34, 20), fadeMat(0x6E7F8C), 0, fy + 10, 0, Math.PI / 2));   // 管球
  tube.rotation.set(Math.PI / 2, 0, 0);
  fadePart(box(tableProps, 22, 12, 22, fadeMat(0x4A5C6B), 0, fy - 6, 0));             // 絞り
  fadePart(prop(tableProps, new THREE.CylinderGeometry(5, 5, 10, 20), fadeMat(0x6E7F8C), 0, fy - 17, 0));   // 圧迫筒（たたんだ状態。第 3 段階で動かす）
  const armZ = -(TB.w / 2 + 16);                                  // 支柱は窓と反対側（−z）に置く
  fadePart(box(tableProps, 10, 10, armZ, fadeMat(0x4A5C6B), 0, fy + 10, armZ / 2));   // 横の腕
  fadePart(box(tableProps, 12, fy + 15 - TB_BOTTOM, 12, fadeMat(0x4A5C6B), 0, (fy + 15 + TB_BOTTOM) / 2, armZ));   // 支柱

  /* ---- 回転軸の受け枠（傾くが滑らない）---- */
  for (const sz of [1, -1]) {
    const zr = sz * (TB.w / 2 + 6);
    box(cradle, 70, TB.house + TB.thick, 3, matFrame, 0, (TB.top - TB.pivotY) - (TB.house + TB.thick) / 2, zr);
    prop(cradle, new THREE.CylinderGeometry(6, 6, 6, 20), matGear, 0, 0, sz * (TB.w / 2 + 10), Math.PI / 2);
  }

  /* 回したときに床に近づく点：台と X 線管の部品の外接直方体の角（tiltGroup の座標の x, y） */
  SWEEP = [];
  const bb = new THREE.Box3(), v = new THREE.Vector3();
  tableProps.children.forEach(m => {
    if (!m.isMesh) return;
    m.updateMatrix(); m.geometry.computeBoundingBox(); bb.copy(m.geometry.boundingBox);
    for (let k = 0; k < 8; k++) {
      v.set(k & 1 ? bb.max.x : bb.min.x, k & 2 ? bb.max.y : bb.min.y, k & 4 ? bb.max.z : bb.min.z).applyMatrix4(m.matrix);
      SWEEP.push([v.x, v.y]);
    }
  });
  buildSlideTab();
}
setTableToBody(new THREE.Vector3());   // 胃の型が決まると sim.js の fitBodyToStomach が置き直す
/* ---- 画面の色（ダーク／ライト）に合わせた 3D の色。透視像（X 線像）は本物と同じく暗いまま ---- */
const THEME3D = {
  dark:  { bg: 0x0A0F14, bgFull: 0x070B0F, wall: 0x202C37, floor: 0x18222B, ceil: 0x141C24, frame: 0x4A5C6B, pad: 0x263440, grid: [0x2A3B4A, 0x1D2935],
           skin: 0xB8CBD8, skinA: [0.07, 1.9], bone: 0xD6DEE6, boneA: [0.07, 0.95], rim: [0.36, 0.50, 0.60], stRim: [0.34, 0.46, 0.56], mucA: 0.17 },
  // ライト（2026-11-04 に 12 案を画像で見比べて決めた）：背景と部屋を中間の灰色にし、人体と骨は白く描く。
  // 背景を明るくして人体を濃く描く案は、引いた視点で人体全体が濃い影のかたまりになり、胃が埋もれた。背景をもっと明るくした案は、白い人体とバリウムが背景に溶けた
  light: { bg: 0x9AA7B2, bgFull: 0x9AA7B2, wall: 0x8C99A4, floor: 0x76838E, ceil: 0xA5B0B9, frame: 0x4F5F6C, pad: 0x3A4855, grid: [0x5F6E7B, 0x6E7C88],
           skin: 0xE8F0F6, skinA: [0.10, 2.0], bone: 0xF2F6FA, boneA: [0.10, 1.0], rim: [0.95, 0.98, 1.0], stRim: [0.95, 0.80, 0.80], mucA: 0.24, equip: 0 }
};
let theme3d = THEME3D.dark;
/* X 線管・支柱・腕・歯車など装置の色を、配色の equip（0〜1）だけ背景の色へ寄せる。明るい配色で、濃い人体が濃い装置に重なって見えなくなるのを防ぐ */
function tintEquip(m) {
  const t = theme3d.equip || 0, base = new THREE.Color(m.userData.base);
  m.uniforms.uC.value.copy(base).lerp(new THREE.Color(theme3d.bg), t);
}
function setTheme3D(name) {
  theme3d = THEME3D[name] || THEME3D.dark;
  matWall.uniforms.uC.value.setHex(theme3d.wall); matFloor.uniforms.uC.value.setHex(theme3d.floor); matCeil.uniforms.uC.value.setHex(theme3d.ceil);
  matFrame.uniforms.uC.value.setHex(theme3d.frame); matPad.uniforms.uC.value.setHex(theme3d.pad);
  matSkin.uniforms.uC.value.setHex(theme3d.skin); matSkin.uniforms.uA.value.set(...theme3d.skinA); matSkin.uniforms.uR.value.setRGB(...theme3d.rim);
  matBone.uniforms.uC.value.setHex(theme3d.bone); matBone.uniforms.uA.value.set(...theme3d.boneA); matBone.uniforms.uR.value.setRGB(...theme3d.rim);
  uRimS.value.setRGB(...theme3d.stRim); uMucA.value = theme3d.mucA;
  fadeParts.forEach(m => tintEquip(m.material));
  matGear.userData.base = matGear.userData.base || 0x6E7F8C; tintEquip(matGear);
  themeReady = true;
  if (roomGrid) { const c = roomGrid.geometry.attributes.color; const a = new THREE.Color(theme3d.grid[0]), b = new THREE.Color(theme3d.grid[1]);
    // 真ん中の線だけ濃く（GridHelper と同じ並び：1 本の線ごとに 4 点、真ん中は 10 本目）
    for (let i = 0; i < c.count; i++) { const k = Math.floor(i / 4) === 10 ? a : b; c.setXYZ(i, k.r, k.g, k.b); }
    c.needsUpdate = true; }
}
setTheme3D(document.documentElement.dataset.theme);
const OPERATOR_EYE = new THREE.Vector3(0, 128, 345);   // 操作室で座った術者の目の位置（窓から 95 cm、床から 128 cm。2026-11-03 に 118 cm から上げた）

/* ---- ガイド ---- */
const guides = new THREE.Group(); scene.add(guides);
const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(-15, 8, 0), 11, 0x52B8CE, 3.0, 1.9);
guides.add(arrow);
