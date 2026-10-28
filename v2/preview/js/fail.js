"use strict";
/* 何かに失敗したときは黙って真っ暗にせず、画面に理由を出す */
function showFail(msg) {
  const st = document.getElementById('stage');
  if (!st || st.querySelector('.glerr')) return;
  const d = document.createElement('div');
  d.className = 'glerr';
  d.innerHTML = '<b>3D を表示できませんでした</b>' +
    '<span>' + String(msg).replace(/[<>&]/g, '') + '</span>' +
    '<span>ページを開き直しても直らないときは、別のブラウザか PC で開いてみてください。</span>';
  st.appendChild(d);
}
addEventListener('error', e => showFail((e && e.message) || '不明なエラー'));
const _err = console.error;
console.error = function () {
  const m = Array.prototype.map.call(arguments, x => String(x)).join(' ');
  if (/shader|WebGLProgram|GL_/i.test(m)) showFail('シェーダを処理できませんでした。' + m.slice(0, 200));
  _err.apply(console, arguments);
};
