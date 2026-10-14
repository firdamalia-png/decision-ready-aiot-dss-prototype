// Rule-consistency test of the DSS decision() function in app.js against the rule text of
// Tabel 3.11 (implemented independently below as `oracle`).
const fs = require('fs'), vm = require('vm');
const path = require('path');
const appPath = path.join(__dirname, '..', 'app.js');
const outPath = path.join(__dirname, 'result_rules.json');
const predsPath = '', iotPath = '';
let src = fs.readFileSync(appPath, 'utf8').replace(/\nboot\(\);\s*$/, '\n');
const harness = `
const OPS = {}; for (const k of Object.keys(THRESHOLDS)) OPS[k] = THRESHOLDS[k];
function sScore(v,o,b){ return (v>=o[0]&&v<=o[1])?3:((v>=b[0]&&v<=b[1])?2:1); }
function sDO(v,o,b){ return v>=o?3:(v>=b?2:1); }
// ---- independent oracle written from the dissertation text (Tabel 3.11) ----
function oracle(rows, forecast, th){
  const last = rows[rows.length-1];
  const preds = forecast.filter(Number.isFinite);
  const minPred = preds.length ? Math.min(...preds) : last.do;
  const tS = sScore(last.temp, th.tempOpt, th.tempBand), pS = sScore(last.ph, th.phOpt, th.phBand);
  const avg = a => a.reduce((x,y)=>x+y,0)/a.length;
  const avgT = avg(rows.map(r=>sScore(r.temp, th.tempOpt, th.tempBand)));
  const avgP = avg(rows.map(r=>sScore(r.ph, th.phOpt, th.phBand)));
  const dos = rows.map(r=>r.do), mu = avg(dos);
  const sdv = dos.length<2 ? 0 : Math.sqrt(avg(dos.map(v=>(v-mu)**2)));
  const cv = mu ? sdv/mu : 0;
  const excHistory = rows.some(r => r.do < th.doBandMin);
  if (last.do < th.doBandMin || minPred < th.doBandMin || tS===1 || pS===1) return 'Kritis';
  if (last.do < th.doOptMin || minPred < th.doOptMin || excHistory || tS===2 || pS===2 || avgT<2.85 || avgP<2.85 || cv>0.16) return 'Waspada';
  return 'Aman';
}
function runApp(pond, rows, forecast){
  state.selectedPond = pond; state.rows = rows;
  state.forecast = forecast.map((v,i)=>({horizon:[15,30,45,60][i], do:v}));
  return decision(assessment(), latestRow()).status;
}
function mkRows(pond, n, f){ const t0 = Date.UTC(2026,0,1); const out=[];
  for(let i=0;i<n;i++){ const r=f(i); out.push({pond, timestamp:new Date(t0+i*900000), temp:r[0], ph:r[1], do:r[2]}); } return out; }
const results = {scenarios:[], fuzz:{}};
// ---------------- 1. scenario tests (one per rule branch, per pond) ----------------
for (const pond of ['Catfish','Gourami','Nilem','Tilapia']) {
  const th = THRESHOLDS[pond];
  const tOk = (th.tempOpt[0]+th.tempOpt[1])/2, pOk = (th.phOpt[0]+th.phOpt[1])/2, dOk = th.doOptMin + 1.0;
  const dWarn = (th.doOptMin + th.doBandMin)/2, dCrit = th.doBandMin - 0.3;
  const tAcc = th.tempBand[1] - 0.5, tBad = th.tempBand[1] + 1, pAcc = th.phOpt[0] - 0.2, pBad = th.phBand[0] - 0.3;
  const base = (i)=>[tOk,pOk,dOk + 0.05*Math.sin(i)];
  const S = [
   ['S01 semua optimal, prediksi >= Opt', mkRows(pond,24,base), [dOk,dOk,dOk,dOk], 'Aman'],
   ['S02 prediksi minimum di antara Ops dan Opt', mkRows(pond,24,base), [dOk,dWarn,dOk,dOk], 'Waspada'],
   ['S03 DO aktual di antara Ops dan Opt', mkRows(pond,24,i=> i===23?[tOk,pOk,dWarn]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S04 prediksi minimum < Ops', mkRows(pond,24,base), [dOk,dOk,dOk,dCrit], 'Kritis'],
   ['S05 DO aktual < Ops', mkRows(pond,24,i=> i===23?[tOk,pOk,dCrit]:base(i)), [dOk,dOk,dOk,dOk], 'Kritis'],
   ['S06 riwayat excursion DO, kondisi kini optimal', mkRows(pond,24,i=> i===5?[tOk,pOk,dCrit]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S07 suhu kini Acceptable (skor 2)', mkRows(pond,24,i=> i===23?[tAcc,pOk,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S08 suhu kini Unsuitable (skor 1)', mkRows(pond,24,i=> i===23?[tBad,pOk,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Kritis'],
   ['S09 pH kini Acceptable (skor 2)', mkRows(pond,24,i=> i===23?[tOk,pAcc,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S10 pH kini Unsuitable (skor 1)', mkRows(pond,24,i=> i===23?[tOk,pBad,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Kritis'],
   ['S11 rata-rata skor suhu < 2,85, kini optimal', mkRows(pond,24,i=> i<4?[tAcc,pOk,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S12 rata-rata skor pH < 2,85, kini optimal', mkRows(pond,24,i=> i<4?[tOk,pAcc,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S13 CV DO > 0,16, lainnya optimal', mkRows(pond,24,i=>[tOk,pOk, i%2? dOk+3.0 : dOk+0.0]), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S14 Kritis dan Waspada bersamaan -> Kritis', mkRows(pond,24,i=> i===23?[tAcc,pOk,dOk]:base(i)), [dOk,dOk,dCrit,dOk], 'Kritis'],
   ['S15 batas: DO aktual = Ops tepat', mkRows(pond,24,i=> i===23?[tOk,pOk,th.doBandMin]:base(i)), [dOk,dOk,dOk,dOk], 'Waspada'],
   ['S16 batas: DO aktual & prediksi = Opt tepat', mkRows(pond,24,i=> i===23?[tOk,pOk,th.doOptMin]:base(i)), [th.doOptMin,dOk,dOk,dOk], 'Aman'],
   ['S17 batas: suhu = batas atas Opt tepat', mkRows(pond,24,i=> i===23?[th.tempOpt[1],pOk,dOk]:base(i)), [dOk,dOk,dOk,dOk], 'Aman'],
   ['S18 prediksi tidak tersedia, DO aktual optimal', mkRows(pond,24,base), [], 'Aman'],
  ];
  for (const [name, rows, fc, expected] of S) {
    const app = runApp(pond, rows, fc), orc = oracle(rows, fc, th);
    results.scenarios.push({pond, name, expected, oracle: orc, app, pass: app===expected && orc===expected});
  }
}
// ---------------- 2. randomized fuzz vs oracle ----------------
let seed = 12345; const rnd = () => (seed = (seed*1103515245+12345) % 2147483648) / 2147483648;
for (const pond of Object.keys(THRESHOLDS)) {
  const th = THRESHOLDS[pond]; let n=0, agree=0; const dist={Aman:0,Waspada:0,Kritis:0}; const bad=[];
  for (let k=0;k<5000;k++){
    const len = 2 + Math.floor(rnd()*60), mode = rnd();
    const near = mode > 0.66;   // one third: near-optimal histories with rare perturbations
    const rows = near ? mkRows(pond, len, ()=>{ const q=rnd();
        return [ (th.tempOpt[0]+th.tempOpt[1])/2 + (q<0.03? (th.tempOpt[1]-th.tempOpt[0])/2+1.5 : (rnd()-0.5)*(th.tempOpt[1]-th.tempOpt[0])*0.8),
                 (th.phOpt[0]+th.phOpt[1])/2 + (q>0.97? -((th.phOpt[1]-th.phOpt[0])/2+0.3) : (rnd()-0.5)*(th.phOpt[1]-th.phOpt[0])*0.8),
                 th.doOptMin + 0.6 + rnd()*(q>0.5&&q<0.53? -2.5 : 1.2) ]; })
      : mkRows(pond, len, ()=>[ th.tempOpt[0]-3 + rnd()*(th.tempOpt[1]-th.tempOpt[0]+6) * (mode<0.5?1:0.6) + (mode<0.5?0:0.2*(th.tempOpt[1]-th.tempOpt[0]+6)),
                                        th.phOpt[0]-0.8 + rnd()*(th.phOpt[1]-th.phOpt[0]+1.6) * (mode<0.5?1:0.6) + (mode<0.5?0:0.2*(th.phOpt[1]-th.phOpt[0]+1.6)),
                                        th.doBandMin-1 + rnd()*(mode<0.3?6:3) + (mode<0.3?0:th.doOptMin-th.doBandMin+1) ]);
    const fc = rnd()<0.1 ? [] : [0,1,2,3].map(()=> near ? th.doOptMin - 0.3 + rnd()*2 : th.doBandMin-1 + rnd()*5);
    const a = runApp(pond, rows, fc), o = oracle(rows, fc, th); n++; dist[a]++;
    if (a===o) agree++; else if (bad.length<5) bad.push({len, fc, a, o});
  }
  results.fuzz[pond] = {cases:n, agree, disagree:n-agree, appStatusDistribution:dist, examples:bad};
}
// parameter-card label check (classifyCurrent) for an Acceptable reading
results.cardLabel = { score3: classifyParameter(3).label, score2: classifyParameter(2).label, score1: classifyParameter(1).label };
fs.writeFileSync(outPath, JSON.stringify(results,null,1));
const sp = results.scenarios.filter(s=>s.pass).length;
console.log('Scenario tests:', sp, '/', results.scenarios.length, 'passed');
for (const s of results.scenarios.filter(s=>!s.pass)) console.log('  FAIL', s.pond, s.name, 'expected', s.expected, 'oracle', s.oracle, 'app', s.app);
for (const [k,v] of Object.entries(results.fuzz)) console.log('Fuzz', k, JSON.stringify({cases:v.cases, disagree:v.disagree, dist:v.appStatusDistribution}));
console.log('Label kartu parameter skor 3/2/1:', JSON.stringify(results.cardLabel));
const allFuzzOk = Object.values(results.fuzz).every(v => v.disagree === 0);
const labelOk = results.cardLabel.score2 === 'Dapat diterima';
if (sp === results.scenarios.length && allFuzzOk && labelOk) console.log('SEMUA UJI ATURAN LULUS'); else { console.log('ADA UJI GAGAL'); process.exitCode = 1; }
`;
const ctx = { window:{APP_LANG:'id'}, document:{documentElement:{lang:'id'}, getElementById:()=>null}, console, Math, Date, JSON, Number, Object, Array, Set, fs, process };
ctx.require = require; vm.createContext(ctx);
vm.runInContext(src + '\nconst fs = require("fs");\n' + harness.replace(/const \[appPath[^\n]*\n/,'') .replace('fs.readFileSync(iotPath','fs.readFileSync(' + JSON.stringify(iotPath)).replace('fs.readFileSync(predsPath','fs.readFileSync(' + JSON.stringify(predsPath)).replace('fs.writeFileSync(outPath','fs.writeFileSync(' + JSON.stringify(outPath)), ctx);
