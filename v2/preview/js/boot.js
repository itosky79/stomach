/* three.js（ES モジュール）を読み込み、そのあとアプリ本体を順に読み込む。
   本体のファイルは今のところ THREE を共有の名前として使うので、window に置いて渡す。 */
import * as THREE from '../lib/three.module.min.js';

// r128 と同じ色の扱いにする（色は書いた値のまま、出力も変換しない）
THREE.ColorManagement.enabled = false;
window.THREE = THREE;

// ?xr=emulate のときは VR ゴーグルの代わりにエミュレーター（Meta の IWER）を入れる。
// 既定は Quest 3、&device=quest2 で Quest 2。本物の VR が使えるブラウザでは何もしない
const Q = new URLSearchParams(location.search);
if (Q.get('xr') === 'emulate') {
  const { XRDevice, metaQuest2, metaQuest3, DevUI } = await import('../lib/iwer.min.js');
  const dev = new XRDevice(Q.get('device') === 'quest2' ? metaQuest2 : metaQuest3);
  dev.installRuntime({ forceInstall: true });   // ブラウザに中身のない WebXR があっても置き換える
  new DevUI(dev);
  window.XR_EMULATED = Q.get('device') === 'quest2' ? 'Quest 2' : 'Quest 3';
}

const FILES = ['data', 'questions', 'anatomy-data', 'model', 'scene', 'sim', 'camera', 'xray', 'labels', 'ui', 'measure', 'mission', 'perf', 'xr', 'main'];
if (Q.get('eval') === '1') FILES.push('eval');   // 評価モード（学会発表用の定量評価）は ?eval=1 のときだけ
for (const f of FILES) {
  await new Promise((done, fail) => {
    const s = document.createElement('script');
    s.src = 'js/' + f + '.js';
    s.onload = done;
    s.onerror = () => fail(new Error(s.src + ' を読み込めませんでした'));
    document.body.appendChild(s);
  });
}
