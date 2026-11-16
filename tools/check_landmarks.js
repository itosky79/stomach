// 胃と十二指腸の目印（噴門・胃底部の頂点・胃角・大弯のいちばん低い所・幽門・球部の終わり・十二指腸の端）の高さ（椎体）と、正中からの左右の距離を測る。
// 使い方：このフォルダを http://localhost:8766/ で配信して、node tools/check_landmarks.js [起倒角,回転角 ...]（既定は 0,0 と 90,0）
// 椎体の位置は tools/vertebrae.json（BodyParts3D の椎骨から求めたもの）。文献の値との比較は DIMENSIONS.md「食道・胃・十二指腸のつながり方」
const fs=require('fs'),path=require('path');
const V=JSON.parse(fs.readFileSync(path.join(__dirname,'vertebrae.json'),'utf8')).vertebrae;
const poses=(process.argv.slice(2).length?process.argv.slice(2):['0,0','90,0']).map(s=>s.split(',').map(Number));
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:600}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8766/?eval=1');await p.waitForTimeout(7000);
const r=await p.evaluate(([V,poses])=>{renderer.setAnimationLoop(null);const o=[];
 const toB=(a)=>{const w=new THREE.Vector3(a[0],a[1],a[2]);bodyFit.updateMatrixWorld(true);bodyFit.localToWorld(w);bodyGroup.worldToLocal(w);return w;};
 for(const [t,ro] of poses){evalPrepare(t,ro);
  const lv=Object.entries(V).map(([k,a])=>[k,toB([0,a.y[0],0]).y,toB([0,a.y[1],0]).y]);
  const mid=toB([(V.L1.x[0]+V.L1.x[1])/2,0,0]).x;
  const at=y=>{for(const [k,lo,hi] of lv){if(y>=lo&&y<=hi){const f=(y-lo)/(hi-lo);return k+(f>0.66?' 上1/3':f<0.33?' 下1/3':' 中');}}
    for(let i=0;i<lv.length-1;i++)if(y<lv[i][1]&&y>lv[i+1][2])return lv[i][0]+'/'+lv[i+1][0]+' 間';return '範囲外';};
  const lr=x=>{const d=(x-mid)*BODY_SCALE;return (d>=0?'左 ':'右 ')+Math.abs(d).toFixed(1)+' cm';};
  const C=i=>[centers[i*3],centers[i*3+1],centers[i*3+2]], seg=k=>{let a=-1,b=-1;for(let i=0;i<NMAIN;i++)if(regionList[regionOf[i]][0]===k){if(a<0)a=i;b=i;}return [a,b];};
  const e=(NN-1)*3, rows=[['噴門（食道の下端）',[centers[e],centers[e+1],centers[e+2]]]];
  let top=-1e9,ti=0;for(let v=0;v<NMAIN*CM;v++)if(regionList[regionOf[(v/CM)|0]][0]==='fundus'&&pos[v*3+1]>top){top=pos[v*3+1];ti=v;}
  rows.push(['胃底部の頂点',[pos[ti*3],top,pos[ti*3+2]]]);
  const an=seg('angle');rows.push(['胃角（胃角部の中ほど）',C((an[0]+an[1])>>1)]);
  let lo=1e9,li=0;for(let v=0;v<pylIdx*CM;v++)if(pos[v*3+1]<lo){lo=pos[v*3+1];li=v;}
  rows.push(['胃のいちばん低い所（大弯）',[pos[li*3],lo,pos[li*3+2]]]);
  rows.push(['幽門',C(pylIdx)]);
  const S=TYPES[curType];if(S.duoEnd){const ds=Math.round(S.duoEnd/(S.pts.length-1)*(NMAIN-1));rows.push(['球部の終わり',C(ds)]);}
  rows.push(['十二指腸の端',C(NMAIN-1)]);
  o.push('== 起倒角 '+t+'° / 回転角 '+ro+'°');for(const [n,P] of rows)o.push('  '+n+'：'+at(P[1])+'、正中より'+lr(P[0]));
 }
 return o.join('\n');},[V,poses]);console.log(r);if(errs.length)console.log(errs.slice(0,3));await b.close();})();
