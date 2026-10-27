// CT の胃を一人ずつアプリの評価モードで教科書と比べる（ねじれなし、内腔 400 mL、バリウム 150 mL、項目 1 を除く 10 項目）
// 使い方：node tools/ct/screen.js <fit_ct.py の出力 JSON> <出力 JSON>（http://localhost:8123/v2/ で v2 を配信しておく）
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const fit = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), outp = process.argv[3];
  const ids = Object.keys(fit).filter(k => !fit[k].error).sort();
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  page.on('pageerror', e => console.log('ERR', e.message));
  await page.goto('http://localhost:8123/v2/?eval=1'); await page.waitForTimeout(4000);
  await page.evaluate(() => renderer.setAnimationLoop(null));
  const res = fs.existsSync(outp) ? JSON.parse(fs.readFileSync(outp, 'utf8')) : {};
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]; if (res[id]) continue;
    res[id] = await page.evaluate(([id, f]) => {
      try {
        TYPES['ct_' + id] = { name: 'CT ' + id, ruby: 'CT', short: 'TotalSegmentator ' + id, pts: f.pts, rad0: f.rad, rad: f.rad, cardia: f.cardia, regions: f.regions, twist: [], note: '' };
        EVAL.ml = 150 / Math.pow(BODY_SCALE, 3); EVAL.pylorus = false;
        const key = makeLumenType(400, 'ct_' + id, 'ct_' + id + '_400');
        EVAL.type = key; TB_TYPES = [key];
        const rows = textbookCheck({ skipDrain: true });
        const r = {}; rows.forEach(x => { r[x.no] = [x.judge === '一致', x.value, x.roll]; });
        delete TYPES[key]; delete TYPES['ct_' + id];
        return { n: rows.filter(x => x.judge === '一致').length, k: TYPES.bp3d ? 1 : 0, items: r };
      } catch (e) { return { error: String(e) }; }
    }, [id, fit[id]]);
    if (i % 20 === 0) { fs.writeFileSync(outp, JSON.stringify(res)); console.log(i, id, res[id].n); }
  }
  fs.writeFileSync(outp, JSON.stringify(res));
  await b.close();
})();
