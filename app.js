const THRESHOLDS = {
  Catfish: {
    label: 'Catfish / Lele',
    tempOpt: [25, 30], tempBand: [23, 32],
    phOpt: [7.0, 8.5], phBand: [6.5, 9.0],
    doOptMin: 3.0, doBandMin: 2.0,
  },
  Gourami: {
    label: 'Gourami / Gurame',
    tempOpt: [25, 30], tempBand: [23, 32],
    phOpt: [6.5, 8.5], phBand: [6.0, 9.0],
    doOptMin: 5.0, doBandMin: 4.0,
  },
  Nilem: {
    label: 'Nilem / Osteochilus hasselti',
    tempOpt: [26, 29], tempBand: [24, 31],
    phOpt: [6.5, 8.0], phBand: [6.0, 8.5],
    doOptMin: 5.0, doBandMin: 4.0,
  },
  Tilapia: {
    label: 'Tilapia / Nila',
    tempOpt: [25, 30], tempBand: [23, 32],
    phOpt: [6.5, 8.5], phBand: [6.0, 9.0],
    doOptMin: 5.0, doBandMin: 4.0,
  },
};



// Historical assessment is computed directly from the active dataset.
// No publication-specific hard-coded summary is injected into the DSS.

const state = {
  rows: [],
  selectedPond: 'Gourami',
  source: 'Historical IoT data',
  firebaseUrl: 'https://klasifikasi-ikan-default-rtdb.asia-southeast1.firebasedatabase.app/readings/latest.json',
  lstmUrl: '',
  liveTimer: null,
  baseHistoricalRows: [],
  simulationTimer: null,
  simulationActive: false,
  simulationPond: null,
  simulationCursor: 0,
  forecast: [],
  forecastInputRow: null,
  modelSource: 'Not connected',
  lstmActive: false,
  lastForecastKey: '',
  modelError: '',
  modelInfo: null,
};

const els = {};
const LANG = ((window.APP_LANG || document.documentElement.lang || 'en') + '').toLowerCase().startsWith('id') ? 'id' : 'en';
const L = (en, id) => (LANG === 'id' ? id : en);

function $(id) {
  return document.getElementById(id);
}

function initElements() {
  [
    'pondSelect', 'settingsBtn', 'settingsPanel', 'closeSettingsBtn', 'csvInput', 'resetDataBtn',
    'firebaseUrl', 'startLiveBtn', 'stopLiveBtn', 'liveStatus', 'lstmUrl', 'applyModelBtn',
    'simSpeed', 'simStartBtn', 'simStepBtn', 'simPauseBtn', 'simResetBtn', 'simStatus',
    'manualTemp', 'manualPh', 'manualDo', 'addManualBtn', 'downloadBtn', 'mainStatus', 'mainIssue',
    'mainRecommendation', 'tempValue', 'phValue', 'doValue', 'tempStatus', 'phStatus', 'doStatus',
    'pondScore', 'sourceLabel', 'chart', 'tempScore', 'phScore', 'doScore', 'excursionValue',
    'forecast15', 'forecast30', 'forecast45', 'forecast60', 'modelBadge', 'assistantMessages', 'assistantInput', 'assistantAskBtn', 'assistantClearBtn',
    'lastUpdated', 'recordsCount', 'doCvValue', 'modelModeTop', 'excursionCount', 'excursionTotal', 'excursionMax',
    'forecastCurrentDo', 'forecastMinDo', 'forecastRisk', 'forecastTimeRisk', 'forecast15Status', 'forecast30Status', 'forecast45Status', 'forecast60Status',
    'forecastChart'
  ].forEach((id) => { els[id] = $(id); });
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseDate(value, index = 0) {
  if (!value) return new Date(Date.now() + index * 15 * 60 * 1000);
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{2,4})\s+(\d{2})[.:](\d{2})/);
  if (match) {
    const [, dd, mm, yy, hh, minute] = match;
    const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
    return new Date(year, Number(mm) - 1, Number(dd), Number(hh), Number(minute));
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return new Date(Date.now() + index * 15 * 60 * 1000);
}

function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  });
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatBackendTimestamp(row) {
  if (row?.rawTimestamp) return String(row.rawTimestamp);
  const date = row?.timestamp;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mi = pad2(date.getMinutes());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:00`;
}

const POND_ALIASES = { catfish: 'Catfish', lele: 'Catfish', gourami: 'Gourami', gurame: 'Gourami', tilapia: 'Tilapia', nila: 'Tilapia', nilem: 'Nilem' };

function normalizePond(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return 'Unknown';
  // 'nilem' diperiksa sebelum 'nila' karena 'nila' adalah awalan dari 'nilem'.
  if (value.includes('nilem')) return 'Nilem';
  const key = Object.keys(POND_ALIASES).find((alias) => value.includes(alias));
  return key ? POND_ALIASES[key] : String(raw).trim();
}

function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

  return lines.slice(1).map((line, index) => {
    const parts = line.split(delimiter).map((item) => item.trim());
    const row = Object.fromEntries(headers.map((h, i) => [h, parts[i]]));
    const timestamp = parseDate(row.timestamp || row.datetime || row.time || row.date, index);
    const pond = normalizePond(row.pond || row.kolam || row.species || row.ikan);
    return {
      id: `csv-${index}`,
      timestamp,
      rawTimestamp: String(row.timestamp || row.datetime || row.time || row.date || '').trim(),
      pond,
      temp: parseNumber(row.temp || row.temperature || row.suhu),
      ph: parseNumber(row.ph || row.pH),
      do: parseNumber(row.do || row.DO || row.dissolved_oxygen || row['dissolved oxygen']),
    };
  }).filter((r) => r.temp !== null && r.ph !== null && r.do !== null);
}

function scoreRange(value, optimal, band) {
  if (value >= optimal[0] && value <= optimal[1]) return 3;
  if (value >= band[0] && value <= band[1]) return 2;
  return 1;
}

function scoreDO(value, optimalMin, bandMin) {
  if (value >= optimalMin) return 3;
  if (value >= bandMin) return 2;
  return 1;
}

function mean(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (!clean.length) return 0;
  return clean.reduce((a, b) => a + b, 0) / clean.length;
}

function sd(values) {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) return 0;
  const avg = mean(clean);
  return Math.sqrt(mean(clean.map((v) => (v - avg) ** 2)));
}

function getPonds() {
  return [...new Set(state.rows.map((r) => r.pond))].sort();
}

function getPondRows() {
  return state.rows
    .filter((r) => r.pond === state.selectedPond)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function getThreshold() {
  return THRESHOLDS[state.selectedPond] || THRESHOLDS.Tilapia;
}

function latestRow() {
  const rows = getPondRows();
  return rows[rows.length - 1] || null;
}


function isBuiltInHistoricalSource() {
  return state.source === L('Historical IoT data', 'Data IoT historis');
}

function forecastSequenceRows() {
  const rows = getPondRows();
  if (!rows.length) return [];
  // The Assessment-Guided LSTM model itself only consumes a 24-step window
  // (6 hours at a 15-minute sampling interval), matching the revised INASS
  // experiment (Revised_Design_Experiment.ipynb: WINDOW = 24). But its lag
  // and rolling-window features (up to 24 steps back) need raw history BEFORE
  // that window starts, so we still send up to 96 raw readings here -- the
  // backend recomputes every engineered feature server-side (single source
  // of truth, verified against the notebook's own output) and trims to the
  // last 24 feature-complete steps itself. If fewer than ~48 readings exist
  // for this pond, the backend will return a clear "not enough history"
  // error instead of a misleading prediction.
  return rows.slice(-96);
}

function forecastInputRow() {
  const seq = forecastSequenceRows();
  return seq[seq.length - 1] || latestRow();
}

function rowsUntilForecastInput(rows) {
  const input = state.forecastInputRow || forecastInputRow();
  if (!input) return rows;
  return rows.filter((r) => r.timestamp <= input.timestamp);
}

function detectExcursions(rows, threshold) {
  let active = null;
  const events = [];
  rows.forEach((row) => {
    const outside = row.do < threshold;
    if (outside && !active) active = { start: row.timestamp, end: row.timestamp, count: 1 };
    else if (outside && active) {
      active.end = row.timestamp;
      active.count += 1;
    } else if (!outside && active) {
      events.push(active);
      active = null;
    }
  });
  if (active) events.push(active);
  const durations = events.map((event) => event.count * 15 / 60);
  return {
    count: events.length,
    totalHours: durations.reduce((a, b) => a + b, 0),
    maxHours: durations.length ? Math.max(...durations) : 0,
  };
}

function assessRows(rows, threshold) {
  const tempScores = rows.map((r) => scoreRange(r.temp, threshold.tempOpt, threshold.tempBand));
  const phScores = rows.map((r) => scoreRange(r.ph, threshold.phOpt, threshold.phBand));
  const doScores = rows.map((r) => scoreDO(r.do, threshold.doOptMin, threshold.doBandMin));
  const tempScore = mean(tempScores);
  const phScore = mean(phScores);
  const doScore = mean(doScores);
  const doValues = rows.map((r) => r.do);
  const doMean = mean(doValues);
  const doSd = sd(doValues);
  return {
    rows,
    threshold,
    tempScore,
    phScore,
    doScore,
    pondScore: mean([tempScore, phScore, doScore]),
    excursion: detectExcursions(rows, threshold.doBandMin),
    doMean,
    doSd,
    doCv: doMean ? doSd / doMean : 0,
  };
}

function assessment() {
  // Assessment kumulatif: seluruh riwayat kolam aktif yang dimuat (lihat README).
  return assessRows(getPondRows(), getThreshold());
}

function classifyParameter(score) {
  // Kategori skor mengikuti Tabel 3.4: 3 = Optimal, 2 = Acceptable, 1 = Unsuitable.
  if (score >= 3) return { label: L('Optimal', 'Optimal'), cls: 'safe' };
  if (score >= 2) return { label: L('Acceptable', 'Dapat diterima'), cls: 'warning' };
  return { label: L('Unsuitable', 'Tidak sesuai'), cls: 'critical' };
}

function classifyCurrent(latest, threshold) {
  if (!latest) return { temp: '-', ph: '-', do: '-' };
  return {
    temp: classifyParameter(scoreRange(latest.temp, threshold.tempOpt, threshold.tempBand)),
    ph: classifyParameter(scoreRange(latest.ph, threshold.phOpt, threshold.phBand)),
    do: classifyParameter(scoreDO(latest.do, threshold.doOptMin, threshold.doBandMin)),
  };
}

function backendSequence(rows) {
  // Backend menghitung ulang ke-122 fitur dari data mentah; frontend hanya mengirim pembacaan sensor.
  return rows.map((r) => ({ timestamp: formatBackendTimestamp(r), temp: r.temp, ph: r.ph, do: r.do, pond: r.pond }));
}

function periodStartRow() {
  // Observasi pertama periode pemantauan kolam: acuan fitur day_index (sama seperti saat pelatihan).
  const rows = getPondRows();
  return rows[0] || null;
}

function normalizePredictionResponse(data) {
  if (!data) return null;
  if (Array.isArray(data.predictions)) {
    return data.predictions.map((p) => ({
      horizon: Number(p.horizon || p.minutes || p.step || 0),
      do: Number(p.do ?? p.predicted_do ?? p.predictedDO),
    })).filter((p) => Number.isFinite(p.horizon) && Number.isFinite(p.do));
  }
  const values = [
    { horizon: 15, do: Number(data.do_15 ?? data.predicted_15 ?? data.forecast15) },
    { horizon: 30, do: Number(data.do_30 ?? data.predicted_30 ?? data.forecast30) },
    { horizon: 45, do: Number(data.do_45 ?? data.predicted_45 ?? data.forecast45) },
    { horizon: 60, do: Number(data.do_60 ?? data.predicted_60 ?? data.forecast60) },
  ].filter((p) => Number.isFinite(p.do));
  return values.length ? values : null;
}

async function updateForecast() {
  const rows = getPondRows();
  const inputForKey = forecastInputRow();

  if (!state.lstmActive) {
    state.forecast = [];
    state.forecastInputRow = inputForKey || null;
    state.modelError = '';
    state.modelSource = L('Not connected', 'Belum terhubung');
    state.lastForecastKey = '';
    render();
    return;
  }

  const key = `${state.selectedPond}-${rows.length}-${formatBackendTimestamp(inputForKey) || ''}-${state.lstmUrl}`;
  state.forecast = [];
  state.forecastInputRow = inputForKey || null;
  state.modelError = '';
  state.modelSource = state.lstmUrl ? L('Testing LSTM', 'Menguji LSTM') : L('LSTM endpoint required', 'Endpoint LSTM wajib');
  render();

  if (!state.lstmUrl) return;
  state.lastForecastKey = key;
  const sequenceRows = forecastSequenceRows();
  state.forecastInputRow = sequenceRows[sequenceRows.length - 1] || null;
  const sequence = backendSequence(sequenceRows);
  const periodStart = periodStartRow();

  try {
    const response = await fetch(state.lstmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pond: state.selectedPond, horizons: [15, 30, 45, 60], period_start: formatBackendTimestamp(periodStart), sequence }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data?.detail ?? `HTTP ${response.status}`;
      // Backend error detail can be a plain string OR a structured object
      // (e.g. { message, raw_rows_received_for_pond, recommended_minimum_raw_rows, ... }
      // from the Assessment-Guided pipeline's "not enough history" check).
      // Prefer the human-readable "message" field when present, otherwise
      // stringify the whole object so the real reason is shown instead of
      // the useless default "[object Object]".
      const detailText = (typeof detail === 'object' && detail !== null)
        ? (detail.message || JSON.stringify(detail))
        : String(detail);
      throw new Error(detailText);
    }
    const normalized = normalizePredictionResponse(data);
    if (!normalized || !normalized.length) throw new Error('No valid prediction returned by LSTM endpoint');
    state.forecast = normalized;
    state.modelSource = data?.model_label || (String(data?.model_variant || data?.model || '').toLowerCase().includes('assessment') ? 'Assessment-Guided LSTM' : 'LSTM');
    state.modelError = '';
    render();
  } catch (error) {
    console.error('LSTM endpoint error:', error);
    state.forecast = [];
    state.modelSource = L('LSTM unavailable', 'LSTM belum tersedia');
    state.modelError = error?.message || 'Prediction request failed';
    state.lastForecastKey = '';
    render();
  }
}

function getForecastValue(minutes) {
  const item = state.forecast.find((p) => Number(p.horizon) === minutes);
  return item ? item.do : null;
}

function forecastInterpretation(value, threshold) {
  if (!Number.isFinite(value)) return { label: '-', cls: 'neutral' };
  if (value < threshold.doBandMin) return { label: L('Critical', 'Kritis'), cls: 'critical' };
  if (value < threshold.doOptMin) return { label: L('Warning', 'Waspada'), cls: 'warning' };
  return { label: L('Safe', 'Aman'), cls: 'safe' };
}

function forecastSummary(summary, latest) {
  const values = state.forecast.map((p) => ({ ...p, do: Number(p.do) })).filter((p) => Number.isFinite(p.do));
  if (!values.length) {
    return {
      currentDo: latest?.do ?? null,
      minDo: null,
      risk: { label: '-', cls: 'neutral' },
      timeText: state.lstmActive
        ? L('LSTM forecast unavailable', 'Prediksi LSTM belum tersedia')
        : L('Apply LSTM endpoint to run forecast', 'Terapkan endpoint LSTM untuk menjalankan prediksi'),
    };
  }
  const minItem = values.reduce((a, b) => (b.do < a.do ? b : a), values[0]);
  const minDo = minItem.do;
  const risk = forecastInterpretation(minDo, summary.threshold);
  let timeText = L('No short-term risk', 'Tidak ada risiko jangka pendek');
  const critical = values.find((p) => p.do < summary.threshold.doBandMin);
  const warning = values.find((p) => p.do < summary.threshold.doOptMin);
  if (critical) timeText = L(`Operational limit in ${critical.horizon} min`, `Mencapai batas operasional dalam ${critical.horizon} menit`);
  else if (warning) timeText = L(`Below optimal in ${warning.horizon} min`, `Di bawah target optimal dalam ${warning.horizon} menit`);
  return {
    currentDo: latest?.do ?? null,
    minDo,
    risk,
    timeText,
  };
}

function setForecastStatus(id, value, threshold) {
  const result = forecastInterpretation(value, threshold);
  if (!els[id]) return;
  els[id].textContent = result.label;
  els[id].className = `forecast-status ${result.cls}`;
}


function decision(summary, latest) {
  const threshold = summary.threshold;
  const forecastValues = state.forecast.map((p) => p.do).filter(Number.isFinite);
  const minForecast = forecastValues.length ? Math.min(...forecastValues) : latest?.do;
  const currentDO = latest?.do ?? 0;
  const currentTempScore = latest ? scoreRange(latest.temp, threshold.tempOpt, threshold.tempBand) : 3;
  const currentPhScore = latest ? scoreRange(latest.ph, threshold.phOpt, threshold.phBand) : 3;
  const currentDoScore = latest ? scoreDO(latest.do, threshold.doOptMin, threshold.doBandMin) : 3;

  const criticalIssues = [];
  const warningIssues = [];
  const actions = [];

  if (currentDO < threshold.doBandMin || minForecast < threshold.doBandMin) {
    criticalIssues.push(L(`DO is below or predicted to cross the operational limit of ${threshold.doBandMin.toFixed(1)} mg/L`, `DO berada di bawah atau diprediksi melewati batas operasional ${threshold.doBandMin.toFixed(1)} mg/L`));
    actions.push(L('increase aeration', 'tingkatkan aerasi'));
    actions.push(L('reduce feeding temporarily', 'kurangi pemberian pakan sementara'));
  } else if (currentDO < threshold.doOptMin || minForecast < threshold.doOptMin || summary.excursion.count > 0) {
    warningIssues.push(L(`DO is not consistently within the optimal target of ${threshold.doOptMin.toFixed(1)} mg/L or higher`, `DO belum konsisten berada pada target optimal ${threshold.doOptMin.toFixed(1)} mg/L atau lebih`));
    actions.push(L('prepare aeration', 'siapkan aerasi'));
    actions.push(L('increase DO monitoring frequency', 'tingkatkan frekuensi pemantauan DO'));
  }

  if (currentTempScore === 1) {
    criticalIssues.push(L('temperature is outside the operational working band', 'temperatur berada di luar rentang kerja operasional'));
    actions.push(L('check shading, water exchange, and pond exposure', 'periksa naungan, pergantian air, dan paparan kolam'));
  } else if (currentTempScore === 2 || summary.tempScore < 2.85) {
    warningIssues.push(L('temperature is acceptable but not consistently optimal', 'temperatur masih dapat diterima tetapi belum konsisten optimal'));
    actions.push(L('observe temperature variation during the next interval', 'amati variasi temperatur pada interval berikutnya'));
  }

  if (currentPhScore === 1) {
    criticalIssues.push(L('pH is outside the operational working band', 'pH berada di luar rentang kerja operasional'));
    actions.push(L('verify pH sensor calibration and inspect water buffering condition', 'verifikasi kalibrasi sensor pH dan periksa kondisi penyangga air'));
  } else if (currentPhScore === 2 || summary.phScore < 2.85) {
    warningIssues.push(L('pH is acceptable but not consistently optimal', 'pH masih dapat diterima tetapi belum konsisten optimal'));
    actions.push(L('continue pH monitoring and check possible short-term swings', 'lanjutkan pemantauan pH dan periksa kemungkinan fluktuasi jangka pendek'));
  }

  if (currentDoScore === 2 && !warningIssues.some((item) => item.includes('DO'))) {
    warningIssues.push(L('DO is acceptable but below the optimal target', 'DO masih dapat diterima tetapi berada di bawah target optimal'));
    actions.push(L('prepare aeration if the downward trend continues', 'siapkan aerasi apabila tren penurunan berlanjut'));
  }

  if (summary.doCv > 0.16) {
    warningIssues.push(L(`DO variability is relatively high with CV ${(summary.doCv * 100).toFixed(1)}%`, `Variabilitas DO relatif tinggi dengan CV ${(summary.doCv * 100).toFixed(1)}%`));
    actions.push(L('review pond management factors that may trigger oxygen fluctuation', 'tinjau faktor manajemen kolam yang dapat memicu fluktuasi oksigen'));
  }

  const uniqueActions = [...new Set(actions)];

  if (criticalIssues.length) {
    return {
      status: L('Critical', 'Kritis'),
      cls: 'critical',
      issue: criticalIssues.join('; ') + '.',
      title: L('Immediate water-quality intervention is required', 'Intervensi kualitas air harus segera dilakukan'),
      reason: L(`The decision combines current temperature, pH, DO assessment and short-term DO forecast. Main concern: ${criticalIssues.join('; ')}.`, `Keputusan menggabungkan assessment temperatur, pH, DO saat ini dan prediksi DO jangka pendek. Perhatian utama: ${criticalIssues.join('; ')}.`),
      action: `${sentenceCase(uniqueActions.join(', '))}. ${L('Recheck sensor readings before operational intervention if the value appears abnormal.', 'Periksa ulang pembacaan sensor sebelum intervensi operasional jika nilainya tampak tidak wajar.')}`,
    };
  }

  if (warningIssues.length) {
    return {
      status: L('Warning', 'Waspada'),
      cls: 'warning',
      issue: warningIssues.join('; ') + '.',
      title: L('Preventive management is recommended', 'Manajemen preventif direkomendasikan'),
      reason: L(`The recommendation is based on multi-parameter assessment, DO excursion history, DO stability, and short-term DO forecast. Main concern: ${warningIssues.join('; ')}.`, `Rekomendasi didasarkan pada assessment multi-parameter, riwayat excursion DO, stabilitas DO, dan prediksi DO jangka pendek. Perhatian utama: ${warningIssues.join('; ')}.`),
      action: `${sentenceCase(uniqueActions.join(', '))}. ${L('Maintain routine observation of temperature and pH because they can affect oxygen dynamics.', 'Pertahankan observasi rutin terhadap temperatur dan pH karena keduanya dapat memengaruhi dinamika oksigen.')}`,
    };
  }

  return {
    status: L('Safe', 'Aman'),
    cls: 'safe',
    issue: L('Temperature, pH, and DO are within the expected operational range.', 'Temperatur, pH, dan DO berada dalam rentang operasional yang diharapkan.'),
    title: L('Current management can be maintained', 'Manajemen saat ini dapat dipertahankan'),
    reason: L('The latest multi-parameter assessment and short-term DO forecast do not indicate operational risk.', 'Assessment multi-parameter terbaru dan prediksi DO jangka pendek tidak menunjukkan risiko operasional.'),
    action: L('Continue routine monitoring and maintain the current pond management strategy.', 'Lanjutkan pemantauan rutin dan pertahankan strategi manajemen kolam saat ini.'),
  };
}

function sentenceCase(text) {
  if (!text) return L('Continue routine monitoring', 'Lanjutkan pemantauan rutin');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setPill(el, result) {
  if (!el) return;
  el.textContent = result.label;
  el.className = `pill ${result.cls}`;
}

function setText(id, value) {
  if (els[id]) els[id].textContent = value;
}

function renderPondOptions() {
  const ponds = getPonds();
  els.pondSelect.innerHTML = ponds.map((pond) => `<option value="${pond}">${pond}</option>`).join('');
  if (!ponds.includes(state.selectedPond)) state.selectedPond = ponds[0] || 'Unknown';
  els.pondSelect.value = state.selectedPond;
}

function render() {
  if (!state.rows.length) return;
  renderPondOptions();

  const latest = latestRow();
  const summary = assessment();
  const current = classifyCurrent(latest, summary.threshold);
  const rec = decision(summary, latest);

  document.body.dataset.risk = rec.cls;
  setText('mainStatus', rec.status);
  setText('mainIssue', rec.issue);
  setText('mainRecommendation', rec.action);
  setText('lastUpdated', latest ? formatTime(latest.timestamp) : '-');
  setText('recordsCount', summary.rows.length.toLocaleString('id-ID'));
  setText('doCvValue', `${(summary.doCv * 100).toFixed(1)}%`);
  setText('modelModeTop', state.modelSource);

  setText('tempValue', latest ? `${latest.temp.toFixed(2)} °C` : '-');
  setText('phValue', latest ? `${latest.ph.toFixed(2)}` : '-');
  setText('doValue', latest ? `${latest.do.toFixed(2)} mg/L` : '-');
  setPill(els.tempStatus, current.temp);
  setPill(els.phStatus, current.ph);
  setPill(els.doStatus, current.do);

  setText('pondScore', summary.pondScore.toFixed(3));
  els.sourceLabel.textContent = state.source;

  setText('tempScore', summary.tempScore.toFixed(3));
  setText('phScore', summary.phScore.toFixed(3));
  setText('doScore', summary.doScore.toFixed(3));
  setText('excursionValue', LANG === 'id' ? `${summary.excursion.count} kejadian · total ${summary.excursion.totalHours.toFixed(1)} jam · maks ${summary.excursion.maxHours.toFixed(1)} jam` : `${summary.excursion.count} event · total ${summary.excursion.totalHours.toFixed(1)} h · max ${summary.excursion.maxHours.toFixed(1)} h`);
  setText('excursionCount', `${summary.excursion.count}`);
  setText('excursionTotal', LANG === 'id' ? `${summary.excursion.totalHours.toFixed(1)} jam` : `${summary.excursion.totalHours.toFixed(1)} h`);
  setText('excursionMax', LANG === 'id' ? `${summary.excursion.maxHours.toFixed(1)} jam` : `${summary.excursion.maxHours.toFixed(1)} h`);

  const f15 = getForecastValue(15);
  const f30 = getForecastValue(30);
  const f45 = getForecastValue(45);
  const f60 = getForecastValue(60);
  setText('forecast15', f15 === null ? '-' : `${f15.toFixed(2)}`);
  setText('forecast30', f30 === null ? '-' : `${f30.toFixed(2)}`);
  setText('forecast45', f45 === null ? '-' : `${f45.toFixed(2)}`);
  setText('forecast60', f60 === null ? '-' : `${f60.toFixed(2)}`);
  setForecastStatus('forecast15Status', f15, summary.threshold);
  setForecastStatus('forecast30Status', f30, summary.threshold);
  setForecastStatus('forecast45Status', f45, summary.threshold);
  setForecastStatus('forecast60Status', f60, summary.threshold);
  const fSummary = forecastSummary(summary, state.forecastInputRow || latest);
  setText('forecastCurrentDo', fSummary.currentDo === null ? '-' : fSummary.currentDo.toFixed(2));
  setText('forecastMinDo', fSummary.minDo === null ? '-' : fSummary.minDo.toFixed(2));
  setText('forecastRisk', fSummary.risk.label);
  if (els.forecastRisk) els.forecastRisk.className = `risk-word ${fSummary.risk.cls}`;
  setText('forecastTimeRisk', state.modelError ? state.modelError.slice(0, 72) : fSummary.timeText);
  if (els.modelBadge) {
    els.modelBadge.textContent = state.modelSource;
    const modelText = state.modelSource.toLowerCase();
    els.modelBadge.className = `model-badge ${modelText.includes('assessment-guided') || modelText === 'lstm' ? 'safe' : modelText.includes('unavailable') || modelText.includes('tidak') ? 'critical' : 'neutral'}`;
  }
  setText('modelModeTop', state.modelSource);

  if (els.assistantMessages && !els.assistantMessages.dataset.locked && !els.assistantMessages.dataset.initialized) {
    resetAssistant(summary, latest, rec);
  }

  drawChart(summary.rows, summary.threshold);
  drawForecastChart(rowsUntilForecastInput(summary.rows), summary.threshold);
}


function drawChart(rows, threshold) {
  const width = 1080;
  const height = 450;
  const margin = { top: 28, right: 42, bottom: 54, left: 150 };
  const rowGap = 18;
  const rowH = 104;
  const innerW = width - margin.left - margin.right;
  const sampled = sampleRows(rows, 180);
  if (sampled.length < 2) {
    els.chart.innerHTML = '<div class="empty-chart">No data available</div>';
    return;
  }

  const x = (i) => margin.left + (i / (sampled.length - 1)) * innerW;
  const series = [
    { key: 'temp', label: 'Temperature', unit: '°C', cls: 'temp-line', dot: 'temp-hover-dot', values: sampled.map((r) => r.temp) },
    { key: 'ph', label: 'pH', unit: '', cls: 'ph-line', dot: 'ph-hover-dot', values: sampled.map((r) => r.ph) },
    { key: 'do', label: 'DO', unit: 'mg/L', cls: 'do-line', dot: 'do-hover-dot', values: sampled.map((r) => r.do), limit: threshold.doBandMin, target: threshold.doOptMin },
  ];

  const scales = [];
  const rowSvg = series.map((item, rowIndex) => {
    const top = margin.top + rowIndex * (rowH + rowGap);
    const valuesForScale = [...item.values];
    if (item.limit !== undefined) valuesForScale.push(item.limit, item.target);
    let min = Math.min(...valuesForScale);
    let max = Math.max(...valuesForScale);
    const pad = Math.max((max - min) * 0.18, item.key === 'ph' ? 0.15 : 0.4);
    min = min - pad;
    max = max + pad;
    if (Math.abs(max - min) < 0.001) max = min + 1;
    const y = (value) => top + (1 - (value - min) / (max - min)) * rowH;
    scales.push({ ...item, top, min, max, y });
    const points = item.values.map((value, i) => `${x(i)},${y(value)}`).join(' ');
    const lastValue = item.values[item.values.length - 1];
    const area = `${margin.left},${top + rowH} ${points} ${width - margin.right},${top + rowH}`;
    const limitLine = item.limit !== undefined ? `
      <line x1="${margin.left}" y1="${y(item.limit)}" x2="${width - margin.right}" y2="${y(item.limit)}" class="limit" />
      <line x1="${margin.left}" y1="${y(item.target)}" x2="${width - margin.right}" y2="${y(item.target)}" class="target" />
      <text x="${width - margin.right}" y="${y(item.limit) - 6}" text-anchor="end" class="axis-text">Limit ${item.limit.toFixed(1)}</text>
      <text x="${width - margin.right}" y="${y(item.target) - 6}" text-anchor="end" class="axis-text">Target ${item.target.toFixed(1)}</text>` : '';

    return `
      <g>
        <rect x="${margin.left}" y="${top}" width="${innerW}" height="${rowH}" rx="16" class="chart-band" />
        <line x1="${margin.left}" y1="${top + rowH}" x2="${width - margin.right}" y2="${top + rowH}" class="grid-line" />
        <line x1="${margin.left}" y1="${top + rowH / 2}" x2="${width - margin.right}" y2="${top + rowH / 2}" class="grid-line soft" />
        <text x="${margin.left - 112}" y="${top + 23}" text-anchor="start" class="series-label">${item.label}</text>
        <text x="${margin.left - 112}" y="${top + 46}" text-anchor="start" class="axis-text">Latest ${lastValue.toFixed(2)} ${item.unit}</text>
        <text x="${margin.left + 10}" y="${top + 18}" class="axis-text">${max.toFixed(1)}</text>
        <text x="${margin.left + 10}" y="${top + rowH - 9}" class="axis-text">${min.toFixed(1)}</text>
        ${limitLine}
        <polygon class="area ${item.key}-area" points="${area}" />
        <polyline class="${item.cls}" points="${points}" />
        <circle cx="${x(sampled.length - 1)}" cy="${y(lastValue)}" r="4.5" class="${item.key}-point" />
      </g>`;
  }).join('');

  const first = sampled[0].timestamp;
  const last = sampled[sampled.length - 1].timestamp;

  els.chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Temperature, pH, and DO trend chart">
      <defs>
        <linearGradient id="tempFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#2563eb" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#2563eb" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="phFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#7c3aed" stop-opacity="0.17" />
          <stop offset="100%" stop-color="#7c3aed" stop-opacity="0" />
        </linearGradient>
        <linearGradient id="doFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#0f766e" stop-opacity="0.20" />
          <stop offset="100%" stop-color="#0f766e" stop-opacity="0" />
        </linearGradient>
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#0f172a" flood-opacity="0.18" />
        </filter>
      </defs>
      <style>
        .chart-band{fill:#f8fafc;stroke:#dbeafe;stroke-width:1}.grid-line{stroke:#e2e8f0;stroke-width:1}.grid-line.soft{opacity:.62}.axis-text{fill:#64748b;font-size:11px;font-weight:650}.series-label{fill:#0f172a;font-size:14px;font-weight:900}
        .temp-line{fill:none;stroke:#2563eb;stroke-width:3.3;stroke-linecap:round;stroke-linejoin:round}.ph-line{fill:none;stroke:#7c3aed;stroke-width:3.3;stroke-linecap:round;stroke-linejoin:round}.do-line{fill:none;stroke:#0f766e;stroke-width:3.7;stroke-linecap:round;stroke-linejoin:round}
        .area{opacity:1}.temp-area{fill:url(#tempFill)}.ph-area{fill:url(#phFill)}.do-area{fill:url(#doFill)}.limit{stroke:#b91c1c;stroke-width:2.2;stroke-dasharray:8 8}.target{stroke:#64748b;stroke-width:2;stroke-dasharray:4 7}.temp-point{fill:#2563eb}.ph-point{fill:#7c3aed}.do-point{fill:#0f766e}
        #hoverLayer{opacity:0;transition:opacity .12s ease}.hover-line{stroke:#0f172a;stroke-width:1.5;stroke-dasharray:5 5;opacity:.62}.hover-dot{stroke:#fff;stroke-width:3;filter:url(#glow)}.temp-hover-dot{fill:#2563eb}.ph-hover-dot{fill:#7c3aed}.do-hover-dot{fill:#0f766e}
      </style>
      ${rowSvg}
      <g id="hoverLayer">
        <line id="hoverLine" class="hover-line" x1="${margin.left}" x2="${margin.left}" y1="${margin.top}" y2="${height - margin.bottom}" />
        <circle id="hoverTemp" class="hover-dot temp-hover-dot" cx="${margin.left}" cy="${margin.top}" r="6" />
        <circle id="hoverPh" class="hover-dot ph-hover-dot" cx="${margin.left}" cy="${margin.top}" r="6" />
        <circle id="hoverDo" class="hover-dot do-hover-dot" cx="${margin.left}" cy="${margin.top}" r="6" />
      </g>
      <rect id="hoverCapture" x="${margin.left}" y="${margin.top}" width="${innerW}" height="${height - margin.top - margin.bottom}" fill="transparent" />
      <text x="${margin.left}" y="${height - 14}" class="axis-text">${formatTime(first)}</text>
      <text x="${width - margin.right}" y="${height - 14}" text-anchor="end" class="axis-text">${formatTime(last)}</text>
    </svg>
    <div id="chartTooltip" class="chart-tooltip" aria-hidden="true"></div>`;

  const svg = els.chart.querySelector('svg');
  const tooltip = els.chart.querySelector('#chartTooltip');
  const hoverLayer = els.chart.querySelector('#hoverLayer');
  const hoverLine = els.chart.querySelector('#hoverLine');
  const hoverTemp = els.chart.querySelector('#hoverTemp');
  const hoverPh = els.chart.querySelector('#hoverPh');
  const hoverDo = els.chart.querySelector('#hoverDo');

  function setHover(event) {
    const rect = svg.getBoundingClientRect();
    const svgXPointer = ((event.clientX - rect.left) / rect.width) * width;
    const clampedX = Math.max(margin.left, Math.min(width - margin.right, svgXPointer));
    const index = Math.max(0, Math.min(sampled.length - 1, Math.round(((clampedX - margin.left) / innerW) * (sampled.length - 1))));
    const row = sampled[index];
    const svgX = x(index);
    const tempY = scales[0].y(row.temp);
    const phY = scales[1].y(row.ph);
    const doY = scales[2].y(row.do);

    hoverLayer.style.opacity = '1';
    hoverLine.setAttribute('x1', svgX);
    hoverLine.setAttribute('x2', svgX);
    hoverTemp.setAttribute('cx', svgX);
    hoverTemp.setAttribute('cy', tempY);
    hoverPh.setAttribute('cx', svgX);
    hoverPh.setAttribute('cy', phY);
    hoverDo.setAttribute('cx', svgX);
    hoverDo.setAttribute('cy', doY);

    tooltip.innerHTML = `
      <div class="tooltip-time">${formatTooltipTime(row.timestamp)}</div>
      <div class="tooltip-row"><span><i class="dot temp-dot"></i>Temperature</span><strong>${row.temp.toFixed(2)} °C</strong></div>
      <div class="tooltip-row"><span><i class="dot ph-dot"></i>pH</span><strong>${row.ph.toFixed(2)}</strong></div>
      <div class="tooltip-row"><span><i class="dot do-dot"></i>DO</span><strong>${row.do.toFixed(2)} mg/L</strong></div>
    `;
    const px = (svgX / width) * rect.width;
    const py = Math.min(tempY, phY, doY) / height * rect.height;
    const tooltipWidth = 252;
    let left = px + 16;
    if (left + tooltipWidth > rect.width - 8) left = px - tooltipWidth - 16;
    left = Math.max(10, left);
    const top = Math.max(12, Math.min(rect.height - 160, py + 8));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.classList.add('visible');
    tooltip.setAttribute('aria-hidden', 'false');
  }

  function hideHover() {
    hoverLayer.style.opacity = '0';
    tooltip.classList.remove('visible');
    tooltip.setAttribute('aria-hidden', 'true');
  }

  svg.addEventListener('mousemove', setHover);
  svg.addEventListener('mouseleave', hideHover);
  svg.addEventListener('touchmove', (event) => {
    if (event.touches && event.touches[0]) setHover(event.touches[0]);
  }, { passive: true });
  svg.addEventListener('touchend', hideHover);
}

function formatTooltipTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function sampleRows(rows, maxPoints) {
  if (!Array.isArray(rows) || rows.length <= maxPoints) return rows;

  const lastIndex = rows.length - 1;
  const sampled = [];

  for (let i = 0; i < maxPoints - 1; i += 1) {
    const index = Math.round((i / (maxPoints - 1)) * lastIndex);
    if (!sampled.length || sampled[sampled.length - 1] !== rows[index]) {
      sampled.push(rows[index]);
    }
  }

  // A monitoring dashboard must always show the newest IoT record.
  if (sampled[sampled.length - 1] !== rows[lastIndex]) {
    sampled.push(rows[lastIndex]);
  }

  return sampled;
}


function drawForecastChart(rows, threshold) {
  if (!els.forecastChart) return;
  const actual = rows.slice(-24).map((r) => ({
    type: 'actual', label: formatTime(r.timestamp), timestamp: r.timestamp, do: r.do,
  }));
  if (!actual.length || !state.forecast.length) {
    els.forecastChart.innerHTML = `<div class="empty-chart small">${L('LSTM forecast unavailable', 'Prediksi LSTM belum tersedia')}</div>`;
    return;
  }
  const lastTime = rows[rows.length - 1].timestamp;
  const forecast = state.forecast
    .slice()
    .sort((a, b) => Number(a.horizon) - Number(b.horizon))
    .map((p) => ({
      type: 'forecast', label: `${p.horizon} min`, timestamp: new Date(lastTime.getTime() + Number(p.horizon) * 60 * 1000), do: Number(p.do), horizon: Number(p.horizon),
    }))
    .filter((p) => Number.isFinite(p.do));
  const all = [...actual, ...forecast];
  const width = 900;
  const height = 410;
  const margin = { top: 34, right: 54, bottom: 54, left: 68 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const values = all.map((p) => p.do).concat([threshold.doBandMin, threshold.doOptMin]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const pad = Math.max((max - min) * 0.2, 0.45);
  min = Math.max(0, min - pad);
  max = max + pad;
  if (Math.abs(max - min) < 0.001) max = min + 1;
  const x = (i) => margin.left + (i / (all.length - 1)) * innerW;
  const y = (v) => margin.top + (1 - (v - min) / (max - min)) * innerH;
  const actualPoints = actual.map((p, i) => `${x(i)},${y(p.do)}`).join(' ');
  const forecastStartIndex = actual.length - 1;
  const forecastPoints = [actual[actual.length - 1], ...forecast].map((p, idx) => `${x(forecastStartIndex + idx)},${y(p.do)}`).join(' ');
  const futureShadeX = x(actual.length - 1);
  const hitPoints = all.map((p, idx) => {
    const cx = x(idx); const cy = y(p.do);
    const kind = p.type === 'actual' ? L('Actual DO', 'DO aktual') : L('Predicted DO', 'DO prediksi');
    const stateLabel = forecastInterpretation(p.do, threshold).label;
    return `<g class="fc-point" data-x="${cx}" data-y="${cy}" data-time="${p.label}" data-kind="${kind}" data-value="${p.do.toFixed(2)} mg/L" data-risk="${stateLabel}">
      <circle cx="${cx}" cy="${cy}" r="7" class="${p.type === 'actual' ? 'latest-dot' : 'forecast-dot ' + forecastInterpretation(p.do, threshold).cls}" />
      <circle cx="${cx}" cy="${cy}" r="16" class="fc-hit"></circle>
    </g>`;
  }).join('');

  els.forecastChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Actual and predicted dissolved oxygen chart">
      <style>
        .fc-bg{fill:#f8fcfd;stroke:#d8edf3;stroke-width:1}.fc-grid{stroke:#e5eef2;stroke-width:1}.fc-axis{fill:#60717c;font-size:12px;font-weight:700}.fc-title{fill:#08212a;font-size:12px;font-weight:900}.actual-line{fill:none;stroke:#0f766e;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}.forecast-line{fill:none;stroke:#f59e0b;stroke-width:5;stroke-dasharray:9 7;stroke-linecap:round;stroke-linejoin:round}.op-limit{stroke:#b91c1c;stroke-width:2.2;stroke-dasharray:7 7}.op-target{stroke:#64748b;stroke-width:2;stroke-dasharray:3 6}.future-zone{fill:#fff7ed;opacity:.7}.forecast-dot{stroke:#fff;stroke-width:3}.forecast-dot.safe{fill:#047857}.forecast-dot.warning{fill:#b45309}.forecast-dot.critical{fill:#b91c1c}.latest-dot{fill:#0f766e;stroke:#fff;stroke-width:3}
      </style>
      <rect x="${margin.left}" y="${margin.top}" width="${innerW}" height="${innerH}" rx="18" class="fc-bg" />
      <rect x="${futureShadeX}" y="${margin.top}" width="${width - margin.right - futureShadeX}" height="${innerH}" class="future-zone" />
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${y(threshold.doBandMin)}" y2="${y(threshold.doBandMin)}" class="op-limit" />
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${y(threshold.doOptMin)}" y2="${y(threshold.doOptMin)}" class="op-target" />
      <line x1="${margin.left}" x2="${width - margin.right}" y1="${margin.top + innerH / 2}" y2="${margin.top + innerH / 2}" class="fc-grid" />
      <polyline points="${actualPoints}" class="actual-line" />
      <polyline points="${forecastPoints}" class="forecast-line" />
      ${hitPoints}
      <line class="fc-guide" x1="${x(actual.length-1)}" x2="${x(actual.length-1)}" y1="${margin.top}" y2="${height - margin.bottom}" style="opacity:0"></line>
      <text x="${margin.left}" y="${height - 14}" class="fc-axis">${L('Recent actual DO', 'DO aktual terbaru')}</text>
      <text x="${futureShadeX + 10}" y="${height - 14}" class="fc-axis">${L('Forecast horizon', 'Horizon prediksi')}</text>
      <text x="${width - margin.right}" y="${y(threshold.doBandMin) - 8}" text-anchor="end" class="fc-axis">${L('Limit', 'Batas')} ${threshold.doBandMin.toFixed(1)}</text>
      <text x="${width - margin.right}" y="${y(threshold.doOptMin) - 8}" text-anchor="end" class="fc-axis">${L('Target', 'Target')} ${threshold.doOptMin.toFixed(1)}</text>
      <text x="${margin.left}" y="22" class="fc-title">${L('Actual DO + predicted DO with species-specific threshold', 'DO aktual + DO prediksi dengan batas spesifik spesies')}</text>
    </svg>
    <div class="forecast-tooltip" aria-hidden="true"></div>
  `;
  const tooltip = els.forecastChart.querySelector('.forecast-tooltip');
  const guide = els.forecastChart.querySelector('.fc-guide');
  const points = Array.from(els.forecastChart.querySelectorAll('.fc-point'));
  const showTip = (node) => {
    const xVal = Number(node.dataset.x); const yVal = Number(node.dataset.y);
    tooltip.innerHTML = `<div class="tooltip-time">${node.dataset.time}</div>
      <div class="tooltip-row"><span>${node.dataset.kind}</span><strong>${node.dataset.value}</strong></div>
      <div class="tooltip-row"><span>${L('Status', 'Status')}</span><strong>${node.dataset.risk}</strong></div>`;
    tooltip.classList.add('visible');
    tooltip.style.left = `${Math.min(els.forecastChart.clientWidth - 226, Math.max(8, (xVal / width) * els.forecastChart.clientWidth + 12))}px`;
    tooltip.style.top = `${Math.max(8, (yVal / height) * els.forecastChart.clientHeight - 8)}px`;
    if (guide) {
      guide.setAttribute('x1', xVal); guide.setAttribute('x2', xVal); guide.style.opacity = '1';
    }
  };
  const hideTip = () => { tooltip.classList.remove('visible'); if (guide) guide.style.opacity = '0'; };
  points.forEach((node) => {
    node.addEventListener('mouseenter', () => showTip(node));
    node.addEventListener('mousemove', () => showTip(node));
    node.addEventListener('mouseleave', hideTip);
  });
}

function cloneRows(rows) {
  return rows.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
}

function historicalRowsForPond(pond = state.selectedPond) {
  return state.baseHistoricalRows
    .filter((r) => r.pond === pond)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function setSimulationStatus(en, id) {
  if (els.simStatus) els.simStatus.textContent = L(en, id);
}

function pauseSimulation(message = true) {
  if (state.simulationTimer) clearTimeout(state.simulationTimer);
  state.simulationTimer = null;
  state.simulationActive = false;
  if (message) {
    setSimulationStatus(
      state.simulationCursor ? `Paused at replay record ${state.simulationCursor}.` : 'Simulation paused.',
      state.simulationCursor ? `Replay dijeda pada data ke-${state.simulationCursor}.` : 'Simulasi dijeda.'
    );
  }
}

function composeHistoricalReplay(pond, cursor) {
  const replayRows = historicalRowsForPond(pond).slice(0, cursor);
  const otherPonds = state.baseHistoricalRows.filter((r) => r.pond !== pond);
  state.rows = cloneRows([...otherPonds, ...replayRows]);
  state.selectedPond = pond;
  state.source = L('Historical IoT replay simulation', 'Simulasi replay data IoT historis');
  state.forecastInputRow = forecastInputRow();
  state.lastForecastKey = '';
}

function simulationWarmStartCount(total) {
  // The LSTM consumes 24 feature-complete timesteps, while lag/rolling feature
  // construction needs earlier raw history. A 96-record warm start is intentionally
  // conservative and matches the maximum raw context sent to the backend.
  return Math.min(96, total);
}

async function initializeSimulation() {
  stopLive();
  pauseSimulation(false);
  const pond = state.selectedPond;
  const sourceRows = historicalRowsForPond(pond);
  if (!sourceRows.length) {
    setSimulationStatus('No built-in historical records are available for this pond.', 'Tidak ada data historis bawaan untuk kolam ini.');
    return false;
  }
  state.simulationPond = pond;
  state.simulationCursor = simulationWarmStartCount(sourceRows.length);
  composeHistoricalReplay(pond, state.simulationCursor);
  setSimulationStatus(
    `Replay ready at record ${state.simulationCursor}/${sourceRows.length}. Each next step represents 15 minutes.`,
    `Replay siap pada data ${state.simulationCursor}/${sourceRows.length}. Setiap langkah berikutnya mewakili 15 menit.`
  );
  await updateForecast();
  return true;
}

async function simulationStep() {
  if (!state.simulationPond || state.simulationPond !== state.selectedPond || state.simulationCursor <= 0) {
    const ok = await initializeSimulation();
    if (!ok) return false;
  }
  const pond = state.simulationPond;
  const sourceRows = historicalRowsForPond(pond);
  if (state.simulationCursor >= sourceRows.length) {
    pauseSimulation(false);
    setSimulationStatus('Replay finished. Reset or select another pond to repeat.', 'Replay selesai. Reset atau pilih kolam lain untuk mengulang.');
    return false;
  }
  state.simulationCursor += 1;
  composeHistoricalReplay(pond, state.simulationCursor);
  const latest = latestRow();
  setSimulationStatus(
    `Replay ${state.simulationCursor}/${sourceRows.length} · virtual sensor time ${formatTime(latest?.timestamp)}.`,
    `Replay ${state.simulationCursor}/${sourceRows.length} · waktu sensor virtual ${formatTime(latest?.timestamp)}.`
  );
  await updateForecast();
  if (state.simulationCursor >= sourceRows.length) {
    state.simulationActive = false;
    setSimulationStatus('Replay finished. The final historical record is now active.', 'Replay selesai. Data historis terakhir sekarang aktif.');
    return false;
  }
  return true;
}

function scheduleSimulationStep() {
  if (!state.simulationActive) return;
  const delay = Math.max(200, Number(els.simSpeed?.value || 800));
  state.simulationTimer = setTimeout(async () => {
    if (!state.simulationActive) return;
    const hasMore = await simulationStep();
    if (hasMore && state.simulationActive) scheduleSimulationStep();
  }, delay);
}

async function startSimulation() {
  const needsInit = !state.simulationPond || state.simulationPond !== state.selectedPond || state.simulationCursor <= 0;
  if (needsInit) {
    const ok = await initializeSimulation();
    if (!ok) return;
  }
  pauseSimulation(false);
  state.simulationActive = true;
  const total = historicalRowsForPond(state.simulationPond).length;
  setSimulationStatus(
    `Replay running from record ${state.simulationCursor}/${total}.`,
    `Replay berjalan dari data ${state.simulationCursor}/${total}.`
  );
  scheduleSimulationStep();
}

async function resetSimulation() {
  pauseSimulation(false);
  state.simulationPond = null;
  state.simulationCursor = 0;
  state.rows = cloneRows(state.baseHistoricalRows);
  state.source = L('Historical IoT data', 'Data IoT historis');
  state.lastForecastKey = '';
  state.forecastInputRow = forecastInputRow();
  setSimulationStatus(
    'Ready. Replay warm-starts with 96 real IoT records so the engineered features and 24-step LSTM window can be formed.',
    'Siap. Replay dimulai dengan 96 data IoT nyata agar fitur rekayasa dan window LSTM 24 timestep dapat dibentuk.'
  );
  await updateForecast();
}

function nextManualSimulationTimestamp() {
  const latest = latestRow();
  if (latest?.timestamp instanceof Date && !Number.isNaN(latest.timestamp.getTime())) {
    return new Date(latest.timestamp.getTime() + 15 * 60 * 1000);
  }
  return new Date();
}

function addRow(row, source = L('Live data', 'Data langsung')) {
  const cleaned = {
    id: `live-${Date.now()}`,
    timestamp: row.timestamp instanceof Date ? row.timestamp : parseDate(row.timestamp),
    pond: normalizePond(row.pond || state.selectedPond),
    temp: parseNumber(row.temp ?? row.temperature ?? row.suhu),
    ph: parseNumber(row.ph),
    do: parseNumber(row.do ?? row.DO ?? row.dissolved_oxygen),
  };
  if ([cleaned.temp, cleaned.ph, cleaned.do].some((v) => v === null)) return false;
  state.rows.push(cleaned);
  state.selectedPond = cleaned.pond;
  state.source = source;
  updateForecast();
  return true;
}

function latestFromFirebasePayload(data) {
  if (!data) return null;
  if (data.temp !== undefined || data.temperature !== undefined || data.do !== undefined || data.ph !== undefined) return data;
  if (typeof data === 'object') {
    const values = Object.values(data).filter((item) => item && typeof item === 'object');
    values.sort((a, b) => parseDate(a.timestamp) - parseDate(b.timestamp));
    return values[values.length - 1] || null;
  }
  return null;
}

async function pollFirebaseOnce() {
  const url = els.firebaseUrl.value.trim();
  if (!url) return;
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) throw new Error('Firebase request failed');
    const payload = await response.json();
    const row = latestFromFirebasePayload(payload);
    if (row && addRow(row, L('Live data', 'Data langsung'))) {
      els.liveStatus.textContent = L(`Connected. Last update: ${formatTime(latestRow()?.timestamp)}`, `Terhubung. Pembaruan terakhir: ${formatTime(latestRow()?.timestamp)}`);
    } else {
      els.liveStatus.textContent = L('Connected, but no valid record found.', 'Terhubung, tetapi tidak ada data valid yang ditemukan.');
    }
  } catch (error) {
    els.liveStatus.textContent = L('Connection failed. Check Firebase URL or database rules.', 'Koneksi gagal. Periksa URL Firebase atau rules database.');
  }
}

function startLive() {
  stopLive();
  state.firebaseUrl = els.firebaseUrl.value.trim();
  if (!state.firebaseUrl) {
    els.liveStatus.textContent = L('Firebase URL is empty.', 'URL Firebase masih kosong.');
    return;
  }
  els.liveStatus.textContent = L('Connecting...', 'Menghubungkan...');
  pollFirebaseOnce();
  state.liveTimer = setInterval(pollFirebaseOnce, 5000);
}

function stopLive() {
  if (state.liveTimer) clearInterval(state.liveTimer);
  state.liveTimer = null;
  els.liveStatus.textContent = L('Disconnected', 'Terputus');
}

function downloadDataset() {
  const header = 'timestamp;pond;ph;do;temp';
  const lines = state.rows.map((r) => [
    formatBackendTimestamp(r), r.pond, r.ph, r.do, r.temp
  ].join(';'));
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'water_quality_dataset.csv';
  a.click();
  URL.revokeObjectURL(url);
}


function dominantParameter(summary) {
  const scores = [
    { key: L('Temperature', 'Temperatur'), value: summary.tempScore },
    { key: 'pH', value: summary.phScore },
    { key: L('Dissolved Oxygen', 'DO'), value: summary.doScore },
  ].sort((a, b) => a.value - b.value);
  return scores[0];
}

function getForecastRiskText(value, threshold) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'not available';
  if (value < threshold.doBandMin) return L('critical', 'kritis');
  if (value < threshold.doOptMin) return L('warning', 'waspada');
  return L('safe', 'aman');
}

function getAssistantContext(summary = assessment(), latest = latestRow(), rec = decision(summary, latest)) {
  const f15 = getForecastValue(15);
  const f30 = getForecastValue(30);
  const f45 = getForecastValue(45);
  const f60 = getForecastValue(60);
  const dominant = dominantParameter(summary);
  const latestText = latest
    ? (LANG === 'id' ? `Temperatur ${latest.temp.toFixed(2)} °C, pH ${latest.ph.toFixed(2)}, dan DO ${latest.do.toFixed(2)} mg/L` : `Temperature ${latest.temp.toFixed(2)} °C, pH ${latest.ph.toFixed(2)}, and DO ${latest.do.toFixed(2)} mg/L`)
    : L('no latest reading is available', 'tidak ada data terbaru yang tersedia');

  return { summary, latest, rec, f15, f30, f45, f60, dominant, latestText };
}

function normalizeAssistantText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pengenalan intent ada di nlp.js (dipakai juga oleh tests/test_nlp.js).
function detectAssistantIntent(question) {
  return window.NLPIntent.detectIntent(question);
}

function intentLead(intentInfo) {
  if (!intentInfo || intentInfo.intent === 'unknown' || intentInfo.intent === 'greeting') return '';
  const label = window.NLPIntent.label(intentInfo.intent, LANG);
  return LANG === 'id' ? `Saya menafsirkan pertanyaan Anda sebagai: ${label}. ` : `I interpret your question as: ${label}. `;
}

function assistantCapabilityMessage(ctx, summary, rec) {
  return LANG === 'id' ? `Topik yang dapat dijelaskan meliputi kondisi saat ini, ringkasan kondisi, alasan risiko, prediksi DO, rekomendasi tindakan, durasi excursion DO, parameter pembatas, skor kesesuaian, stabilitas DO, dan nilai tambah DSS. Anda juga dapat bertanya pengetahuan umum (apa itu DO, kenapa DO turun malam hari, hubungan suhu dan DO, rentang ideal tiap spesies, arti status, cara kerja prediksi, cara menaikkan DO, penanganan darurat, kalibrasi sensor, batasan sistem) atau analisis data (jam DO terendah, tren DO, perbandingan kolam, DO terendah/tertinggi, kapan excursion terakhir). Untuk ${state.selectedPond}, status saat ini ${rec.status}, skor kolam ${summary.pondScore.toFixed(3)}, dan parameter pembatas utama ${ctx.dominant.key}.` : `Available topics include current condition, condition summary, risk reason, DO forecast, recommended action, DO excursion duration, limiting parameter, suitability score, DO stability, and DSS added value. You can also ask general questions (what DO is, why DO drops at night, temperature and DO, species ranges, status meaning, how forecasting works, raising DO, emergencies, sensor calibration, limitations) or data analysis (lowest-DO hour, DO trend, pond comparison, DO min/max, last excursion). For ${state.selectedPond}, the current status is ${rec.status}, the pond score is ${summary.pondScore.toFixed(3)}, and the main limiting parameter is ${ctx.dominant.key}.`;
}

function buildAssistantResponse(question, summary = assessment(), latest = latestRow(), rec = decision(summary, latest)) {
  const ctx = getAssistantContext(summary, latest, rec);
  const threshold = summary.threshold;
  const f15Text = ctx.f15 === null ? '-' : ctx.f15.toFixed(2);
  const f30Text = ctx.f30 === null ? '-' : ctx.f30.toFixed(2);
  const f45Text = ctx.f45 === null ? '-' : ctx.f45.toFixed(2);
  const f60Text = ctx.f60 === null ? '-' : ctx.f60.toFixed(2);
  const f60Risk = getForecastRiskText(ctx.f60, threshold);
  const intentInfo = detectAssistantIntent(question);
  const lead = intentLead(intentInfo);

  if (intentInfo.intent === 'greeting') {
    return LANG === 'id' ? `Halo. Chatbot ini membantu menafsirkan keluaran DSS untuk ${state.selectedPond}. Anda dapat menanyakan kondisi saat ini, alasan risiko, prediksi DO, durasi excursion, atau rekomendasi tindakan.` : `Hello. This chatbot helps interpret the DSS output for ${state.selectedPond}. You may ask about the current condition, risk reason, DO forecast, excursion duration, or recommended action.`;
  }

  if (window.NLPIntent.EXTENDED_INTENTS.includes(intentInfo.intent) && window.NLPAnswers) {
    const answer = window.NLPAnswers.buildExtendedResponse(intentInfo.intent, question, {
      lang: LANG, pond: state.selectedPond, rows: summary.rows, allRows: state.rows, threshold, thresholds: THRESHOLDS,
      summary, rec, forecast: [ctx.f15, ctx.f30, ctx.f45, ctx.f60].map((v) => (v === null ? NaN : v)),
      modelInfo: state.modelInfo, assess: assessRows,
    });
    if (answer) return `${lead}${answer}`;
  }

  if (intentInfo.intent === 'do_forecast') {
    return LANG === 'id' ? `${lead}Untuk ${state.selectedPond}, prediksi DO adalah ${f15Text} mg/L dalam 15 menit, ${f30Text} mg/L dalam 30 menit, ${f45Text} mg/L dalam 45 menit, dan ${f60Text} mg/L dalam 60 menit. Batas operasional spesifik spesies adalah ${threshold.doBandMin.toFixed(1)} mg/L dan target optimalnya ${threshold.doOptMin.toFixed(1)} mg/L. Prediksi 60 menit diinterpretasikan sebagai ${f60Risk}. Prediksi ini digunakan sebagai sinyal peringatan dini, bukan sebagai dasar keputusan tunggal.` : `${lead}For ${state.selectedPond}, the DO forecast is ${f15Text} mg/L in 15 minutes, ${f30Text} mg/L in 30 minutes, ${f45Text} mg/L in 45 minutes, and ${f60Text} mg/L in 60 minutes. The species-specific operational limit is ${threshold.doBandMin.toFixed(1)} mg/L and the optimal target is ${threshold.doOptMin.toFixed(1)} mg/L. The 60-minute forecast is interpreted as ${f60Risk}. This forecast is used as an early-warning signal, not as a standalone decision.`;
  }

  if (intentInfo.intent === 'recommended_action') {
    return LANG === 'id' ? `${lead}Rekomendasi tindakan: ${rec.action} Rekomendasi ini menggabungkan temperatur saat ini, pH, assessment DO, riwayat excursion DO, stabilitas DO, dan prediksi DO jangka pendek. Rekomendasi ini tidak hanya didasarkan pada nilai DO terbaru saja.` : `${lead}Recommended action: ${rec.action} This recommendation combines current temperature, pH, DO assessment, DO excursion history, DO stability, and the short-term DO forecast. It is not based on the latest DO value alone.`;
  }

  if (intentInfo.intent === 'risk_reason') {
    return LANG === 'id' ? `${lead}Status saat ini adalah ${rec.status}. Alasan utamanya adalah: ${rec.issue} Indikator pendukungnya meliputi skor kolam ${summary.pondScore.toFixed(3)}, CV DO ${(summary.doCv * 100).toFixed(1)}%, ${summary.excursion.count} kejadian excursion DO, total durasi excursion ${summary.excursion.totalHours.toFixed(1)} jam, dan durasi excursion maksimum ${summary.excursion.maxHours.toFixed(1)} jam.` : `${lead}The current status is ${rec.status}. The main reason is: ${rec.issue} The supporting indicators are pond-level score ${summary.pondScore.toFixed(3)}, DO CV ${(summary.doCv * 100).toFixed(1)}%, ${summary.excursion.count} DO excursion event(s), total excursion duration ${summary.excursion.totalHours.toFixed(1)} h, and maximum excursion duration ${summary.excursion.maxHours.toFixed(1)} h.`;
  }

  if (intentInfo.intent === 'excursion_duration') {
    return LANG === 'id' ? `${lead}Analisis excursion DO menunjukkan ${summary.excursion.count} kejadian, total durasi ${summary.excursion.totalHours.toFixed(1)} jam, dan durasi maksimum ${summary.excursion.maxHours.toFixed(1)} jam. Hal ini penting karena monitoring berbasis threshold-only hanya menandai apakah batas terlampaui, sedangkan analisis excursion menjelaskan seberapa persisten kondisi yang tidak menguntungkan tersebut.` : `${lead}DO excursion analysis shows ${summary.excursion.count} event(s), total duration ${summary.excursion.totalHours.toFixed(1)} h, and maximum duration ${summary.excursion.maxHours.toFixed(1)} h. This matters because threshold-only monitoring only flags whether a limit is crossed, while excursion analysis explains how persistent the unfavorable condition is.`;
  }

  if (intentInfo.intent === 'limiting_parameter') {
    const doNote = LANG === 'id'
      ? `DO tercatat ${summary.excursion.count} kejadian excursion dengan CV ${(summary.doCv * 100).toFixed(1)}%.`
      : `DO recorded ${summary.excursion.count} excursion event(s) with CV ${(summary.doCv * 100).toFixed(1)}%.`;
    return LANG === 'id'
      ? `${lead}Parameter dengan skor kesesuaian rata-rata terendah adalah ${ctx.dominant.key} (${ctx.dominant.value.toFixed(3)}). Skor lengkap: temperatur ${summary.tempScore.toFixed(3)}, pH ${summary.phScore.toFixed(3)}, DO ${summary.doScore.toFixed(3)}. ${doNote}`
      : `${lead}The parameter with the lowest average suitability score is ${ctx.dominant.key} (${ctx.dominant.value.toFixed(3)}). Full scores: temperature ${summary.tempScore.toFixed(3)}, pH ${summary.phScore.toFixed(3)}, DO ${summary.doScore.toFixed(3)}. ${doNote}`;
  }

  if (intentInfo.intent === 'dss_value') {
    return LANG === 'id' ? `${lead}Nilai tambah di luar monitoring threshold-only adalah integrasi empat lapisan: skoring kesesuaian tingkat kolam, persistensi excursion DO, stabilitas temporal, dan prediksi DO jangka pendek. Hal ini membuat sistem mampu menjelaskan tidak hanya apakah suatu parameter melampaui batas, tetapi juga seberapa parah dan persisten risikonya serta tindakan operasional apa yang perlu dilakukan.` : `${lead}The value added beyond threshold-only monitoring is the integration of four layers: pond-level suitability scoring, DO excursion persistence, temporal stability, and short-term DO forecasting. This allows the system to explain not only whether a parameter crosses a limit, but also how severe and persistent the risk is and what operational action should follow.`;
  }

  if (intentInfo.intent === 'assessment_score') {
    return LANG === 'id' ? `${lead}Skor kesesuaian tingkat kolam untuk ${state.selectedPond} saat ini adalah ${summary.pondScore.toFixed(3)}. Skor komponennya adalah temperatur ${summary.tempScore.toFixed(3)}, pH ${summary.phScore.toFixed(3)}, dan DO ${summary.doScore.toFixed(3)}. Skor ini diinterpretasikan bersama durasi excursion dan stabilitas, bukan sebagai angka yang berdiri sendiri.` : `${lead}The current pond-level suitability score for ${state.selectedPond} is ${summary.pondScore.toFixed(3)}. The component scores are temperature ${summary.tempScore.toFixed(3)}, pH ${summary.phScore.toFixed(3)}, and DO ${summary.doScore.toFixed(3)}. The score is interpreted together with excursion duration and stability, not as an isolated number.`;
  }

  if (intentInfo.intent === 'do_stability') {
    return LANG === 'id' ? `${lead}Indikator stabilitas DO direpresentasikan oleh koefisien variasi. Untuk ${state.selectedPond}, CV DO adalah ${(summary.doCv * 100).toFixed(1)}% (dihitung dari ${summary.rows.length} data riwayat kolam). Nilai CV yang lebih tinggi menunjukkan fluktuasi yang lebih kuat, yang dapat meningkatkan risiko operasional meskipun rata-rata DO tampak masih dapat diterima.` : `${lead}The DO stability indicator is represented by the coefficient of variation. For ${state.selectedPond}, DO CV is ${(summary.doCv * 100).toFixed(1)}% (computed from ${summary.rows.length} historical records of this pond). A higher CV indicates stronger fluctuation, which can increase operational risk even when average DO appears acceptable.`;
  }

  if (intentInfo.intent === 'condition_summary') {
    const fc = ctx.f60 === null
      ? L('DO forecast is not available (LSTM endpoint not connected).', 'Prediksi DO belum tersedia (endpoint LSTM belum terhubung).')
      : L(`Minimum forecast DO over 15–60 min: ${Math.min(...[ctx.f15, ctx.f30, ctx.f45, ctx.f60].filter((v) => v !== null)).toFixed(2)} mg/L.`,
          `DO prediksi minimum 15–60 menit: ${Math.min(...[ctx.f15, ctx.f30, ctx.f45, ctx.f60].filter((v) => v !== null)).toFixed(2)} mg/L.`);
    return LANG === 'id'
      ? `${lead}${state.selectedPond}: status ${rec.status}. ${ctx.latestText}. Skor kolam ${summary.pondScore.toFixed(3)}; excursion DO ${summary.excursion.count} kejadian (total ${summary.excursion.totalHours.toFixed(1)} jam); CV DO ${(summary.doCv * 100).toFixed(1)}%. ${fc} Rekomendasi: ${rec.action}`
      : `${lead}${state.selectedPond}: status ${rec.status}. ${ctx.latestText}. Pond score ${summary.pondScore.toFixed(3)}; DO excursion ${summary.excursion.count} event(s) (total ${summary.excursion.totalHours.toFixed(1)} h); DO CV ${(summary.doCv * 100).toFixed(1)}%. ${fc} Recommendation: ${rec.action}`;
  }

  if (intentInfo.intent === 'current_condition') {
    return LANG === 'id' ? `${lead}Kondisi saat ini untuk ${state.selectedPond}: ${ctx.latestText}. Status sistem adalah ${rec.status}, skor kolam ${summary.pondScore.toFixed(3)}, dan parameter pembatas utama adalah ${ctx.dominant.key}. Tindakan yang disarankan: ${rec.action}` : `${lead}Current condition for ${state.selectedPond}: ${ctx.latestText}. The system status is ${rec.status}, pond-level score is ${summary.pondScore.toFixed(3)}, and the main limiting parameter is ${ctx.dominant.key}. Suggested action: ${rec.action}`;
  }

  return LANG === 'id' ? `Saya belum dapat memetakan pertanyaan Anda dengan yakin ke topik DSS. ${assistantCapabilityMessage(ctx, summary, rec)}` : `I could not confidently map your question to a DSS topic. ${assistantCapabilityMessage(ctx, summary, rec)}`;
}

function assistantFollowUps(question) {
  const intentInfo = detectAssistantIntent(question);
  if (intentInfo.intent === 'do_forecast') {
    return LANG === 'id' ? ['Mengapa prediksi ini berisiko?', 'Tindakan apa yang harus dilakukan sekarang?', 'Tampilkan bukti excursion'] : ['Why is this forecast risky?', 'What action should be taken now?', 'Show excursion evidence'];
  }
  if (intentInfo.intent === 'recommended_action') {
    return LANG === 'id' ? ['Apa dasar rekomendasi ini?', 'Parameter mana yang paling membatasi?', 'Bagaimana prediksi DO 60 menit?'] : ['What supports this recommendation?', 'Which parameter is limiting?', 'What is the 60-minute DO forecast?'];
  }
  if (intentInfo.intent === 'dss_value') {
    return LANG === 'id' ? ['Tampilkan skor tingkat kolam', 'Tampilkan keparahan excursion DO', 'Parameter mana yang paling membatasi?'] : ['Show pond-level score', 'Show DO excursion severity', 'Which parameter is limiting?'];
  }
  if (intentInfo.intent === 'unknown') {
    return LANG === 'id' ? ['Kondisi saat ini', 'Alasan risiko', 'Prediksi DO', 'Rekomendasi tindakan'] : ['Current condition', 'Risk reason', 'DO forecast', 'Recommended action'];
  }
  return LANG === 'id' ? ['Mengapa status kolam berisiko?', 'Bagaimana prediksi DO?', 'Tindakan apa yang harus dilakukan sekarang?'] : ['Why is the pond status risky?', 'What is the DO forecast?', 'What action should be taken now?'];
}

function addAssistantMessage(role, text, followUps = []) {
  if (!els.assistantMessages) return;
  const bubble = document.createElement('div');
  bubble.className = `assistant-message ${role}`;

  const label = document.createElement('span');
  label.textContent = role === 'user' ? L('You', 'Anda') : L('Assistant', 'Asisten');
  bubble.appendChild(label);

  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  bubble.appendChild(paragraph);

  if (role === 'bot' && followUps.length) {
    const row = document.createElement('div');
    row.className = 'assistant-followups';
    followUps.forEach((question) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = question;
      btn.addEventListener('click', () => {
        if (els.assistantInput) els.assistantInput.value = question;
        askAssistant(question);
      });
      row.appendChild(btn);
    });
    bubble.appendChild(row);
  }

  els.assistantMessages.appendChild(bubble);
  els.assistantMessages.scrollTop = els.assistantMessages.scrollHeight;
}

function resetAssistant(summary = assessment(), latest = latestRow(), rec = decision(summary, latest)) {
  if (!els.assistantMessages) return;
  els.assistantMessages.innerHTML = '';
  delete els.assistantMessages.dataset.locked;
  els.assistantMessages.dataset.initialized = 'true';
  const intro = LANG === 'id' ? `Silakan ajukan pertanyaan terkait kondisi kolam, ringkasan kondisi, alasan risiko, prediksi DO, rekomendasi tindakan, parameter pembatas, skor kesesuaian, stabilitas DO, durasi excursion, atau nilai tambah DSS.` : `Ask about pond condition, risk reason, DO forecast, excursion duration, limiting parameter, suitability score, stability, or recommended action.`;
  addAssistantMessage('bot', intro, LANG === 'id' ? ['Bagaimana kondisi kolam saat ini?', 'Mengapa kolam ini berisiko?', 'Tindakan apa yang harus dilakukan sekarang?'] : ['What is the current pond condition?', 'Why is this pond risky?', 'What action should be taken now?']);
}

function askAssistant(question) {
  const cleanQuestion = String(question || '').trim();
  if (!cleanQuestion) return;
  const summary = assessment();
  const latest = latestRow();
  const rec = decision(summary, latest);
  if (!els.assistantMessages) return;

  els.assistantMessages.dataset.locked = 'true';
  addAssistantMessage('user', cleanQuestion);

  const typing = document.createElement('div');
  typing.className = 'assistant-message bot typing';
  typing.innerHTML = LANG === 'id' ? '<span>Asisten</span><p>Memproses pertanyaan...</p>' : '<span>Assistant</span><p>Processing question...</p>';
  els.assistantMessages.appendChild(typing);
  els.assistantMessages.scrollTop = els.assistantMessages.scrollHeight;

  window.setTimeout(() => {
    typing.remove();
    addAssistantMessage('bot', buildAssistantResponse(cleanQuestion, summary, latest, rec), assistantFollowUps(cleanQuestion));
    if (els.assistantInput) els.assistantInput.value = '';
  }, 220);
}

function bindEvents() {
  els.pondSelect.addEventListener('change', () => {
    pauseSimulation(false);
    state.simulationPond = null;
    state.simulationCursor = 0;
    state.selectedPond = els.pondSelect.value;
    resetAssistant();
    state.lastForecastKey = '';
    setSimulationStatus('Ready for the selected pond.', 'Siap untuk kolam yang dipilih.');
    updateForecast();
  });

  els.assistantAskBtn?.addEventListener('click', () => askAssistant(els.assistantInput?.value || 'summary'));
  els.assistantInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') askAssistant(els.assistantInput.value || 'summary');
  });
  els.assistantClearBtn?.addEventListener('click', () => resetAssistant());
  document.querySelectorAll('[data-question]').forEach((button) => {
    button.addEventListener('click', () => {
      const question = button.dataset.question || 'summary';
      if (els.assistantInput) els.assistantInput.value = question;
      askAssistant(question);
    });
  });

  els.settingsBtn.addEventListener('click', () => els.settingsPanel.classList.add('open'));
  els.closeSettingsBtn.addEventListener('click', () => els.settingsPanel.classList.remove('open'));
  els.settingsPanel.addEventListener('click', (event) => {
    if (event.target === els.settingsPanel) els.settingsPanel.classList.remove('open');
  });

  els.csvInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    if (!parsed.length) {
      alert(L('CSV could not be read. Use columns: timestamp;pond;ph;do;temp', 'CSV tidak terbaca. Gunakan kolom: timestamp;pond;ph;do;temp'));
      return;
    }
    pauseSimulation(false);
    state.simulationPond = null;
    state.simulationCursor = 0;
    state.rows = parsed;
    state.selectedPond = parsed[0].pond;
    state.source = L('Uploaded CSV', 'CSV yang diunggah');
    resetAssistant();
    state.lastForecastKey = '';
    updateForecast();
  });

  els.resetDataBtn.addEventListener('click', () => {
    stopLive();
    pauseSimulation(false);
    state.simulationPond = null;
    state.simulationCursor = 0;
    state.rows = cloneRows(state.baseHistoricalRows);
    state.selectedPond = getPonds().includes('Gourami') ? 'Gourami' : getPonds()[0];
    state.source = L('Historical IoT data', 'Data IoT historis');
    resetAssistant();
    state.lastForecastKey = '';
    setSimulationStatus('Historical dataset restored.', 'Dataset historis dipulihkan.');
    updateForecast();
  });

  els.startLiveBtn.addEventListener('click', () => { pauseSimulation(false); startLive(); });
  els.stopLiveBtn.addEventListener('click', stopLive);

  els.simStartBtn?.addEventListener('click', startSimulation);
  els.simStepBtn?.addEventListener('click', async () => {
    pauseSimulation(false);
    await simulationStep();
  });
  els.simPauseBtn?.addEventListener('click', () => pauseSimulation(true));
  els.simResetBtn?.addEventListener('click', resetSimulation);

  els.applyModelBtn.addEventListener('click', () => {
    state.lstmUrl = els.lstmUrl.value.trim();
    state.lstmActive = Boolean(state.lstmUrl);
    state.lastForecastKey = '';
    state.modelError = '';
    if (els.applyModelBtn) els.applyModelBtn.textContent = L('Testing...', 'Menguji...');
    state.modelInfo = null;
    fetch(state.lstmUrl.replace(/\/predict\/?$/, '/health')).then((r) => r.json()).then((info) => { state.modelInfo = info; }).catch(() => {});
    updateForecast().finally(() => {
      if (els.applyModelBtn) els.applyModelBtn.textContent = L('Apply model endpoint', 'Terapkan endpoint model');
    });
  });

  els.addManualBtn.addEventListener('click', () => {
    pauseSimulation(false);
    const row = {
      timestamp: nextManualSimulationTimestamp(),
      pond: state.selectedPond,
      temp: els.manualTemp.value,
      ph: els.manualPh.value,
      do: els.manualDo.value,
    };
    if (!addRow(row, L('Manual what-if simulation', 'Simulasi manual / what-if'))) {
      alert(L('Enter valid values for temperature, pH, and DO.', 'Isi nilai temperatur, pH, dan DO dengan benar.'));
    } else {
      setSimulationStatus(
        `Manual reading applied at ${formatTime(latestRow()?.timestamp)} using the existing historical/replay context.`,
        `Data manual diterapkan pada ${formatTime(latestRow()?.timestamp)} menggunakan konteks historis/replay yang tersedia.`
      );
    }
  });

  els.downloadBtn.addEventListener('click', downloadDataset);
}

function boot() {
  initElements();
  if (els.firebaseUrl) els.firebaseUrl.value = state.firebaseUrl;
  if (els.lstmUrl) els.lstmUrl.value = 'http://127.0.0.1:8000/predict';
  state.source = L('Historical IoT data', 'Data IoT historis');
  state.baseHistoricalRows = parseCsv(HISTORICAL_CSV);
  state.rows = cloneRows(state.baseHistoricalRows);
  const ponds = getPonds();
  state.selectedPond = ponds.includes('Gourami') ? 'Gourami' : ponds[0];
  bindEvents();
  state.forecastInputRow = forecastInputRow();
  state.modelSource = L('Not connected', 'Belum terhubung');
  render();
}

boot();
