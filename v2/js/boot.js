/* three.js（ES モジュール）を読み込み、そのあとアプリ本体を順に読み込む。
   本体のファイルは今のところ THREE を共有の名前として使うので、window に置いて渡す。 */
import * as THREE from '../lib/three.module.min.js';

// r128 と同じ色の扱いにする（色は書いた値のまま、出力も変換しない）
THREE.ColorManagement.enabled = false;
window.THREE = THREE;

const FILES = ['data', 'questions', 'model', 'scene', 'sim', 'camera', 'xray', 'labels', 'ui', 'main'];
for (const f of FILES) {
  await new Promise((done, fail) => {
    const s = document.createElement('script');
    s.src = 'js/' + f + '.js';
    s.onload = done;
    s.onerror = () => fail(new Error(s.src + ' を読み込めませんでした'));
    document.body.appendChild(s);
  });
}
