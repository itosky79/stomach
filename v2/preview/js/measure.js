"use strict";
/* ================= 目的部位の二重造影の度合い（描出率）=================
   評価モード（eval.js）とミッション（mission.js）の両方で使う。定義は EVAL.md「指標の定義」と同じ。 */
const WALLS = ['前壁', '小弯', '後壁', '大弯'];
// 壁の半分（マニュアルの「大弯側」「小弯側」）。前壁・後壁の扇形（90°）を、小弯と大弯の向きの境の 0°・180° で 2 つに分けたもの。
// 前壁小弯側 0 < φ ≦ 45°、前壁大弯側 −45° ≦ φ < 0、後壁小弯側 φ > 135°、後壁大弯側 φ < −135°。番号は 4〜7
const HALF_WALLS = ['前壁小弯側', '前壁大弯側', '後壁小弯側', '後壁大弯側'];
function wallHit(w, sec, phi, v) {
  if (w < 0) return true;
  if (w < 4) return sec[v] === w;
  const f = phi[v];
  return w === 4 ? f > 0 && f <= 45 : w === 5 ? f >= -45 && f < 0 : w === 6 ? f > 135 : f < -135;
}

/* ---- ① 部位と壁の判定、二重造影、描出率 ---- */
function vertexAreas() {   // 頂点の受け持ち面積（隣の三角形の面積の 1/3 の合計）。胃と十二指腸の輪だけ
  const A = new Float64Array(NMAIN * CM), nf = (NMAIN - 1) * CM * 2;
  for (let f = 0; f < nf; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const ux = pos[b * 3] - ax, uy = pos[b * 3 + 1] - ay, uz = pos[b * 3 + 2] - az;
    const vx = pos[c * 3] - ax, vy = pos[c * 3 + 1] - ay, vz = pos[c * 3 + 2] - az;
    const s = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2 / 3;
    A[a] += s; A[b] += s; A[c] += s;
  }
  return A;
}
function wallSectors() {   // 頂点ごとの壁（0 前壁、1 小弯、2 後壁、3 大弯）
  const sec = new Int8Array(NMAIN * CM), phiA = new Float32Array(NMAIN * CM), nrm = geom.attributes.normal.array;
  sec.phi = phiA;   // 壁の向きの角度 φ（度）。壁の半分の判定に使う
  let gx = 0, gy = 0, gz = 0, gn = 0;   // 胃の中心線の重心（十二指腸球部を除く）
  for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] !== 'duode') { gx += centers[i * 3]; gy += centers[i * 3 + 1]; gz += centers[i * 3 + 2]; gn++; }
  const G = new THREE.Vector3(gx / gn, gy / gn, gz / gn);
  const T = new THREE.Vector3(), A = new THREE.Vector3(), S = new THREE.Vector3(), C = new THREE.Vector3(), r = new THREE.Vector3();
  const Z = new THREE.Vector3(0, 0, 1);
  let lastSign = 1;
  for (let i = 0; i < NMAIN; i++) {
    const a = Math.max(0, i - 1) * 3, b = Math.min(NMAIN - 1, i + 1) * 3;
    T.set(centers[b] - centers[a], centers[b + 1] - centers[a + 1], centers[b + 2] - centers[a + 2]).normalize();
    A.copy(Z).addScaledVector(T, -Z.dot(T)).normalize();                 // 腹側
    S.crossVectors(T, A).normalize();                                    // 横（向きは下で小弯側にそろえる）
    C.set(centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]);
    const inner = G.clone().sub(C).dot(S);
    const sign = Math.abs(inner) > 0.05 ? Math.sign(inner) : lastSign;   // 重心の側 = 曲がりの内側 = 小弯
    lastSign = sign; S.multiplyScalar(sign);
    for (let j = 0; j < CM; j++) {
      const v = i * CM + j;
      r.set(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);   // 壁の外向きの法線
      const phi = Math.atan2(r.dot(S), r.dot(A)) * 180 / Math.PI;
      phiA[v] = phi;
      sec[v] = Math.abs(phi) <= 45 ? 0 : phi > 45 && phi <= 135 ? 1 : Math.abs(phi) > 135 ? 2 : 3;
    }
  }
  return sec;
}
function smooth(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }
function doubleContrast() {   // 頂点ごとの dbl（FRAG_SOLID と同じ式）
  const nrm = geom.attributes.normal.array, u = uUp.value;
  const d = new Float64Array(NMAIN * CM);
  for (let v = 0; v < NMAIN * CM; v++) {
    const below = hArr[v] <= aLevel[v] ? 1 : 0;
    const coat = smooth(0.12, 0.55, aWet[v]);
    const down = Math.max(0, Math.min(1, -(nrm[v * 3] * u.x + nrm[v * 3 + 1] * u.y + nrm[v * 3 + 2] * u.z)));
    d[v] = (1 - below) * coat * smooth(0.02, 0.22, down);
  }
  return d;
}
/* 目的部位の文字列を読む。
   書き方：部位を「・」「+」「、」でつなぐ（どれかに入れば目的部位）。「A〜B」は A から B までの範囲。
   最後に壁（前壁・小弯・後壁・大弯）が付いていれば、その項目全体に壁の条件がかかる。括弧書きは無視する。
   部位の言葉と、その定義：
     胃底部（穹窿部）・胃体部（体部）・胃角部・前庭部・幽門部・十二指腸球部（十二指腸）… 胃の型のデータの部位
     胃体上部・胃体中部・胃体下部 … 胃体部の輪を、管の軸に沿って数で 3 等分したもの
     胃上部・胃中部・胃下部 … 胃（十二指腸球部を除く）を、管の中心の線の長さで 3 等分したもの
                             （胃癌取扱い規約の U・M・L は小弯と大弯をそれぞれ 3 等分する。ここでは中心の線で近似した）
     噴門部 … 噴門（食道の管の下端）から実寸 2 cm 以内にある胃の壁
     胃全体 … 十二指腸球部を除くすべて
   食道は評価の対象外（胃の壁の面積しか数えないため）。読めない言葉があれば null を返す。 */
const TERM_SYN = { '穹窿部': '胃底部', '体部': '胃体部', '十二指腸': '十二指腸球部' };
const REGION_WORDS = ['胃底部', '胃体部', '胃角部', '前庭部', '幽門部', '十二指腸球部'];
const SUB_WORDS = ['胃体上部', '胃体中部', '胃体下部', '胃上部', '胃中部', '胃下部', '噴門部', '胃全体'];
const TERM_WORDS = [...REGION_WORDS, ...SUB_WORDS, ...Object.keys(TERM_SYN)];
function parseTarget(text) {
  const clean = String(text || '').replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '');
  const parts = clean.split(/[+＋、,，・]/).filter(Boolean);
  if (!parts.length) return null;
  const out = [];
  for (let p of parts) {
    let wall = -1;
    for (let w = 0; w < HALF_WALLS.length; w++) if (p.endsWith(HALF_WALLS[w])) { wall = 4 + w; p = p.slice(0, -HALF_WALLS[w].length); break; }
    if (wall < 0) for (let w = 0; w < WALLS.length; w++) if (p.endsWith(WALLS[w])) { wall = w; p = p.slice(0, -WALLS[w].length); break; }
    const ends = p.split(/[〜～~]/);
    if (ends.length > 2) return null;
    const words = ends.map(e => TERM_SYN[e] || e);
    if (words.some(w => TERM_WORDS.indexOf(w) < 0 && !TERM_SYN[w])) return null;
    if (words.length === 2 && words.some(w => w === '噴門部' || w === '胃全体')) return null;   // 範囲の端には使えない
    out.push({ words, wall });
  }
  return out;
}
function ringsOf(word) {   // 言葉 → 胃の輪の番号の範囲 [最初, 最後]（噴門部・胃全体は別に扱う）
  const rr = [];
  for (let i = 0; i < NMAIN; i++) rr.push(regionList[regionOf[i]][1]);
  const span = name => { const f = rr.indexOf(name), l = rr.lastIndexOf(name); return f < 0 ? null : [f, l]; };
  if (REGION_WORDS.indexOf(word) >= 0) return span(word);
  const body = span('胃体部');
  if (word.startsWith('胃体') && body) {   // 胃体部を輪の数で 3 等分
    const k = ['胃体上部', '胃体中部', '胃体下部'].indexOf(word), n = body[1] - body[0] + 1;
    return [body[0] + Math.round(n * k / 3), body[0] + Math.round(n * (k + 1) / 3) - 1];
  }
  const k = ['胃上部', '胃中部', '胃下部'].indexOf(word);
  if (k >= 0) {   // 胃（十二指腸球部を除く）を中心の線の長さで 3 等分
    const last = rr.indexOf('十二指腸球部') - 1, acc = [0];
    for (let i = 1; i <= last; i++) acc.push(acc[i - 1] + Math.hypot(centers[i * 3] - centers[i * 3 - 3], centers[i * 3 + 1] - centers[i * 3 - 2], centers[i * 3 + 2] - centers[i * 3 - 1]));
    const L = acc[last], a = L * k / 3, b = L * (k + 1) / 3;
    let f = -1, l = -1;
    for (let i = 0; i <= last; i++) if (acc[i] >= a && acc[i] <= b) { if (f < 0) f = i; l = i; }
    return [f, l];
  }
  return null;
}
function targetMask(target, sec) {   // 目的部位に入る頂点
  const m = new Uint8Array(NMAIN * CM);
  const duodeFirst = (() => { for (let i = 0; i < NMAIN; i++) if (regionList[regionOf[i]][0] === 'duode') return i; return NMAIN; })();
  const e = (NN - 1) * 3, R2 = Math.pow(2.0 / BODY_SCALE, 2);   // 噴門部：噴門から実寸 2 cm 以内
  for (const t of target) {
    const ok = new Uint8Array(NMAIN * CM);
    if (t.words.length === 1 && t.words[0] === '胃全体') { for (let v = 0; v < duodeFirst * CM; v++) ok[v] = 1; }
    else if (t.words.length === 1 && t.words[0] === '噴門部') {
      for (let v = 0; v < duodeFirst * CM; v++) {
        const dx = pos[v * 3] - centers[e], dy = pos[v * 3 + 1] - centers[e + 1], dz = pos[v * 3 + 2] - centers[e + 2];
        if (dx * dx + dy * dy + dz * dz <= R2) ok[v] = 1;
      }
    } else {
      const a = ringsOf(t.words[0]), b = ringsOf(t.words[t.words.length - 1]);
      if (!a || !b) continue;
      const f = Math.min(a[0], b[0]), l = Math.max(a[1], b[1]);
      for (let i = f; i <= l; i++) for (let j = 0; j < CM; j++) ok[i * CM + j] = 1;
    }
    for (let v = 0; v < NMAIN * CM; v++) if (ok[v] && wallHit(t.wall, sec, sec.phi, v)) m[v] = 1;
  }
  return m;
}
function depictionRate(target) {
  const A = vertexAreas(), sec = wallSectors(), d = doubleContrast(), m = targetMask(target, sec);
  let all = 0, dbl = 0;
  for (let v = 0; v < NMAIN * CM; v++) if (m[v]) { all += A[v]; dbl += A[v] * d[v]; }
  return { rate: all > 0 ? dbl / all * 100 : NaN, area: all };
}

