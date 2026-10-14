// Evaluasi pengenalan intent: node tests/test_nlp.js [dev|test] [--old ../path/app_lama.js]
const fs = require('fs'), path = require('path');
const NLP = require(path.join(__dirname, '..', 'nlp.js'));
const which = process.argv[2] || 'test';
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'nlp', `${which}_questions.json`), 'utf8'));
const labels = which === 'extended' ? NLP.EXTENDED_INTENTS : NLP.EVALUATED_INTENTS;
const allLabels = Object.keys(NLP.INTENTS).concat('unknown');
const cm = Object.fromEntries(labels.map((a) => [a, Object.fromEntries(allLabels.map((b) => [b, 0]))]));
let n = 0, ok = 0; const errors = [];
for (const intent of labels) for (const q of data[intent] || []) {
  const pred = NLP.detectIntent(q).intent; n++; cm[intent][pred] = (cm[intent][pred] || 0) + 1;
  if (pred === intent) ok++; else errors.push({ q, expected: intent, predicted: pred });
}
console.log(`Set ${which}: ${ok}/${n} benar (akurasi ${(100 * ok / n).toFixed(2)}%)`);
for (const intent of labels) {
  const tp = cm[intent][intent], fn = (data[intent] || []).length - tp, fp = labels.reduce((s, o) => s + (o !== intent ? cm[o][intent] : 0), 0);
  const p = tp / Math.max(1, tp + fp), r = tp / Math.max(1, tp + fn);
  console.log(`  ${intent.padEnd(20)} precision ${p.toFixed(2)}  recall ${r.toFixed(2)}`);
}
if (errors.length) { console.log('Salah klasifikasi:'); errors.forEach((e) => console.log(`  "${e.q}"  -> ${e.predicted} (seharusnya ${e.expected})`)); }
fs.writeFileSync(path.join(__dirname, 'nlp', `result_${which}.json`), JSON.stringify({ set: which, n, correct: ok, accuracy: ok / n, confusion: cm, errors }, null, 1));
