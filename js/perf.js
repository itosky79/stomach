"use strict";
/* ================= 重さの表示（URL に ?perf=1 を付けたときだけ）=================
   1 秒あたりの描画回数（fps）、1 回あたりの時間、そのうち計算にかかった時間、
   描画の命令数と三角形の数を出す。VR の中では目の前の板に同じ内容を出す（xr.js）。 */
const PERF_ON = new URLSearchParams(location.search).get('perf') === '1';
const perf = { prev: 0, n: 0, sum: 0, max: 0, cpu: 0, t0: 0, calls: 0, tris: 0, text: '' };
let perfEl = null;
if (PERF_ON) {
  perfEl = document.createElement('div'); perfEl.id = 'perf'; perfEl.textContent = '計測中…';
  stage.appendChild(perfEl);
  renderer.info.autoReset = false;          // 3D と透視像の 2 回分をまとめて数える
}
function perfBegin(now) {
  if (!PERF_ON) return;
  if (perf.prev) { const d = now - perf.prev; perf.n++; perf.sum += d; perf.max = Math.max(perf.max, d); }
  perf.prev = now;
  perf.t0 = performance.now();
  renderer.info.reset();
}
function perfEnd() {
  if (!PERF_ON) return;
  perf.cpu += performance.now() - perf.t0;
  perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;
  if (perf.sum < 500 || !perf.n) return;    // 0.5 秒ごとにまとめて出す
  const fps = perf.n * 1000 / perf.sum;
  const where = renderer.xr.isPresenting ? 'VR' : '画面';
  perf.text =
    fps.toFixed(0) + ' fps（' + where + (window.XR_EMULATED ? '・' + window.XR_EMULATED + ' を模擬' : '') + '）\n' +
    '1 回 ' + (perf.sum / perf.n).toFixed(1) + ' ms（最大 ' + perf.max.toFixed(1) + '）\n' +
    '計算 ' + (perf.cpu / perf.n).toFixed(1) + ' ms\n' +
    '描画 ' + perf.calls + ' 回・三角形 ' + (perf.tris / 1000).toFixed(0) + ' 千';
  perfEl.textContent = perf.text;
  perf.n = 0; perf.sum = 0; perf.max = 0; perf.cpu = 0;
}
