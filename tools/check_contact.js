// 体が天板にめり込んでいないかを、基準撮影法Ⅰ・Ⅱの手順一式（本の体位変換の経路どおりに動かした途中も含む）で確かめる。
// 使い方：このフォルダを http://localhost:8766/ で配信して（例：python3 -m http.server 8766）、node tools/check_contact.js
// 出力：手順ごとの、体表でいちばん深く天板の面より下に入った量（cm。正がめり込み、負はすき間）、部位、そのときの起倒角/回転角。
// 腕を挙げる動き（sim.js の armMove）と、回る途中のねじれ（applyRollFeel）も同じ式で入れて測る。天板の面だけを見る（肩当て・握り棒・足台は見ない）
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({args:['--use-gl=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage({viewport:{width:900,height:600}});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://localhost:8766/');await p.waitForTimeout(5000);
const res=await p.evaluate(()=>{
  // 体表の頂点（bodyGroup の座標）と、部位の分け方（胴・腕・頭・脚）
  const L=new THREE.Matrix4();for(let o=meshSkin;o&&o!==bodyGroup;o=o.parent){o.updateMatrix();L.premultiply(o.matrix);}
  const a=meshSkin.geometry.attributes.position, V=[], part=[];const v=new THREE.Vector3();
  const LOC=[];for(let i=0;i<a.count;i++){v.fromBufferAttribute(a,i);LOC.push(v.x,v.y,v.z);v.applyMatrix4(L);V.push(v.x,v.y,v.z);
    part.push(v.y>28?'頭・首・肩':v.y<-30?(Math.abs(v.x+2)>12&&v.y>-60?'腕':'腰・脚'):(v.x>-17&&v.x<13?'胴':'腕'));}
  const q=new THREE.Quaternion(), w=new THREE.Vector3();
  function pen(lead){ // いちばん深いめり込み（cm、正がめり込み）と部位
    twLift=TW_R*Math.abs(lead||0); armEff=armAngle(tiltCur,rollCur); applyPose(); q.copy(bodyGroup.quaternion); const S=BODY_SCALE, P=bodyGroup.position; const g=armAngle(tiltCur,rollCur); const lv=new THREE.Vector3(), mv=new THREE.Vector3(); const y0=(new THREE.Vector3(0,0,0)).applyMatrix4(new THREE.Matrix4().copy(L).invert()).y, kk=(lead||0)/(30/BODY_SCALE);
    let worst=-1e9, wp='';
    for(let i=0;i<V.length;i+=3){if(!ARMS_UP&&armCut(LOC[i],LOC[i+1])>0.02)continue;if(g>0.03*Math.PI/Math.PI&&g>0.03){const c=armCut(LOC[i],LOC[i+1]);if(c>0.02&&c<0.98)continue;}armMove(lv.set(LOC[i],LOC[i+1],LOC[i+2]),g,mv);{const an=kk*Math.max(-30/BODY_SCALE,Math.min(30/BODY_SCALE,mv.y-y0)),c=Math.cos(an),sn=Math.sin(an),x=mv.x,z=mv.z;mv.x=c*x+sn*z;mv.z=-sn*x+c*z;}mv.applyMatrix4(L);w.copy(mv).applyQuaternion(q).multiplyScalar(S).add(P);
      if(w.x<TB.x0||w.x>TB.x1||Math.abs(w.z)>TB.w/2) continue;
      const d=TB.top-w.y; if(d>worst){worst=d;wp=part[i/3];}}
    return [worst,wp];
  }
  const out=[];
  for(const [name,SEQ,RT] of [['Ⅰ',SEQ1,SEQ1_ROUTES],['Ⅱ',SEQ2,SEQ2_ROUTES]]){
    tiltCur=tiltT=90;rollCur=rollT=0;tiltV=0;
    SEQ.forEach((S,i)=>{
      let M; const R=RT[i];
      if(R){const base=Math.round((rollCur-R.pts[0][1])/360)*360;M=motionBuild(R.pts.slice(1).map(([t,r,sl])=>({tilt:t,roll:base+r,slow:!!sl})),rollCur);}
      else{const dr=((S.roll-rollCur)%360+540)%360-180;M=motionBuild([{tilt:S.tilt,roll:rollCur+dr}],rollCur);}
      let worst=[-1e9,''],wpose='',n=0,prevR=rollCur,rv=0;
      for(let f=0;f<6000;f++){const dt=1/30;const going=motionStep(M,dt);
        const err=tiltT-tiltCur,want=Math.sign(err)*Math.min(TILT_MAX,Math.sqrt(2*TILT_ACC*Math.abs(err)));
        tiltV+=Math.max(-TILT_ACC*dt,Math.min(TILT_ACC*dt,want-tiltV));const nx=tiltCur+tiltV*dt;
        if((tiltT-nx)*err<=0||(Math.abs(err)<0.05&&Math.abs(tiltV)<1)){tiltCur=tiltT;tiltV=0;}else tiltCur=nx;
        rollCur=rollT;const vv=(rollCur-prevR)/dt;prevR=rollCur;rv+=(Math.max(-200,Math.min(200,vv))-rv)*(1-Math.exp(-dt*6));
        if(f%3===0){const r=pen(rv*ROLL_LEAD*Math.PI/180);if(r[0]>worst[0]){worst=r;wpose=Math.round(tiltCur)+'/'+Math.round(((rollCur%360)+360)%360);}}
        if(!going)break;}
      out.push(name+(S.no||NOS[i])+' '+S.name+'：最深 '+worst[0].toFixed(1)+' cm（'+worst[1]+'、'+wpose+'）');
    });
  }
  return out.join('\n');});
console.log(res);console.log(errs.slice(0,3));await b.close();})();
