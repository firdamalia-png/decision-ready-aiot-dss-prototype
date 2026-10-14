/*
 * Pengenalan intent untuk NLP explanation DSS (rule-based, tanpa model statistik).
 *
 * Cara kerja:
 *  1. Normalisasi: huruf kecil, buang tanda baca, pisah menjadi token; akhiran -nya/-kah/-lah dibuang.
 *  2. Setiap intent punya daftar pola kata kunci. Pola dapat berupa frasa ("berapa lama") dan
 *     dapat diakhiri '*' untuk pencocokan awalan ("fluktua*" cocok dengan fluktuasi/fluktuatif).
 *     Pola dicocokkan pada batas kata, bukan sebagai potongan string.
 *  3. Skor intent = jumlah bobot pola yang cocok (bobot bawaan = jumlah kata dalam pola).
 *  4. Intent dengan skor tertinggi dipilih; jika seri, dipakai urutan PRIORITY (yang lebih spesifik dulu).
 *
 * Dipakai oleh app.js (browser) dan tests/test_nlp.js (Node.js) - satu sumber kode yang sama.
 */
(function (root) {
  'use strict';

  // 10 intent sesuai subbab 4.8 + 'greeting' (sapaan, bukan bagian dari 10 intent yang dievaluasi).
  const DEF = ['apa itu', 'apa yang dimaksud', 'yang dimaksud', 'apa arti', 'arti', 'artinya', 'definisi', 'pengertian', 'maksud', 'jelaskan', 'what does', 'meaning', 'what is meant'];

  const INTENTS = {
    current_condition: {
      label: { id: 'Kondisi Saat Ini', en: 'Current Condition' },
      patterns: ['kondisi', 'keadaan', 'saat ini', 'sekarang', 'terkini', 'terbaru', 'hari ini', 'pembacaan sensor',
        'nilai sensor', 'kabar', 'berapa suhu', 'berapa ph', 'berapa do', 'aman atau tidak',
        'current', 'now', 'latest', 'right now', ['status kolam', 2], 'cukup', 'aman', 'gimana'],
    },
    risk_reason: {
      label: { id: 'Alasan Risiko', en: 'Risk Reason' },
      patterns: [['kenapa', 2], ['mengapa', 2], ['alasan', 2], ['penyebab', 2], ['sebab*', 2], ['kok', 2],
        ['apa yang membuat', 3], ['dasar penetapan', 3], ['dasar keputusan', 3], ['why', 2], ['reason', 2], ['cause', 2],
        'berisiko', 'risiko', 'bahaya', 'berbahaya', 'waspada', 'kritis', 'peringatan', 'dianggap', 'dinyatakan',
        'risky', 'critical', 'warning'],
    },
    do_forecast: {
      label: { id: 'Prediksi DO', en: 'DO Forecast' },
      patterns: [['prediksi', 2], ['diprediksi', 2], ['prakiraan', 2], ['perkiraan', 2], ['ramalan', 2], ['forecast*', 2],
        ['predict*', 2], 'ke depan', 'mendatang', 'menit lagi', 'jam lagi', 'nanti', 'jangka pendek',
        '15 menit', '30 menit', '45 menit', '60 menit', '1 jam', 'satu jam', 'akan turun', 'akan naik',
        'next hour', 'next', 'lstm', 'bakal', 'anjlok', 'jam lagi'],
    },
    recommended_action: {
      label: { id: 'Rekomendasi Tindakan', en: 'Recommended Action' },
      patterns: [['rekomendasi', 2], ['tindakan', 2], ['saran*', 2], ['solusi*', 2], ['langkah', 2], ['penanganan', 2],
        ['harus', 2], ['sebaiknya', 2], ['perlu dilakukan', 3], ['apa yang perlu', 3], ['yang harus', 2], 'lakukan',
        'dilakukan', 'kerjakan', 'diambil', 'aerasi', 'aerator', 'ganti air', 'pakan', 'pencegahan', 'perlu',
        ['what should', 3], ['action', 2], ['recommend*', 2], 'should', ['cara', 2], ['bagaimana cara', 3], ['gimana cara', 3], 'naikin', 'menaikkan', 'meningkatkan'],
    },
    limiting_parameter: {
      label: { id: 'Parameter Pembatas', en: 'Limiting Parameter' },
      patterns: [['parameter', 3], ['pembatas', 3], ['membatasi', 3], ['variabel', 3], ['faktor', 2],
        ['paling bermasalah', 3], ['masalah utama', 3], ['terburuk', 2], ['paling lemah', 3], ['skor terendah', 2],
        ['paling rendah', 2], ['paling tidak sesuai', 3], ['paling perlu', 2], 'bermasalah', 'paling berpengaruh',
        ['limiting', 3], ['which parameter', 4], ['main problem', 3], ['paling jelek', 3], ['paling buruk', 3], ['jelek', 2]],
    },
    assessment_score: {
      label: { id: 'Skor Kesesuaian', en: 'Suitability Score' },
      patterns: [['skor', 3], ['score*', 3], ['suitability', 3], ['kesesuaian', 3], ['penilaian', 2], 'assessment',
        'nilai kesesuaian', 'rata rata', 'scoring'],
    },
    do_stability: {
      label: { id: 'Stabilitas DO', en: 'DO Stability' },
      patterns: [['stabil*', 3], ['kestabilan', 3], ['fluktua*', 3], ['berfluktuasi', 3], ['naik turun', 3], ['berubah ubah', 3],
        ['cv', 3], ['koefisien variasi', 4], ['variasi', 2], ['variabilitas', 3], ['konsisten', 2], ['stability', 3],
        ['stable', 3], ['coefficient', 3]],
    },
    excursion_duration: {
      label: { id: 'Durasi Excursion', en: 'DO Excursion' },
      patterns: [['excursion', 3], ['ekskursi', 3], ['durasi', 3], ['berapa lama', 3], ['seberapa lama', 3], ['lama', 1],
        ['berapa kali', 3], ['kejadian', 2], ['episode', 3], ['penyimpangan', 3], ['menyimpang', 3], ['keluar dari batas', 3],
        ['di bawah batas', 2], ['do rendah', 2], ['total waktu', 2], ['riwayat', 2], ['how long', 3], ['duration', 3], ['sering', 2], 'drop'],
    },
    dss_value: {
      label: { id: 'Nilai Tambah DSS', en: 'DSS Added Value' },
      patterns: [['nilai tambah', 4], ['nilai dss', 4], ['kelebihan', 3], ['keunggulan', 3], ['kontribusi', 3], ['manfaat', 3],
        ['kebaruan', 3], ['novelty', 3], ['beda*', 2], ['membedakan', 3], ['dibanding*', 2], ['threshold', 2],
        ['ambang batas', 2], ['monitoring biasa', 3], ['pemantauan biasa', 3], ['cukup sensor', 3], ['alarm', 2],
        ['perlu dss', 3], ['sistem ini', 1], 'dss', 'decision ready', ['added value', 4], ['value', 2]],
    },
    condition_summary: {
      label: { id: 'Ringkasan Kondisi', en: 'Condition Summary' },
      patterns: [['ringkas*', 4], ['rangkum*', 4], ['ikhtisar', 4], ['gambaran umum', 4], ['gambaran keseluruhan', 4],
        ['secara keseluruhan', 4], ['keseluruhan', 3], ['laporan singkat', 4], ['laporan ringkas', 4], ['kesimpulan', 3],
        ['overview', 4], ['summary', 4], ['summarize', 4], 'semua informasi', 'singkat', ['poin penting', 3]],
    },
    // ---------------- Pertanyaan pengetahuan (jawaban berbasis literatur/rancangan, bukan membaca angka sistem)
    know_do: { group: 'knowledge', label: { id: 'Pengetahuan: Oksigen Terlarut', en: 'Knowledge: Dissolved Oxygen' },
      patterns: [{ all: [DEF, ['do', 'oksigen terlarut', 'dissolved oxygen', 'oksigen']], w: 8 }, ['what is dissolved oxygen', 10],
        { all: [['kenapa', 'mengapa', 'why'], ['do', 'oksigen'], ['penting', 'dibutuhkan', 'diperlukan', 'important']], w: 9 },
        { all: [['dari mana', 'sumber'], ['oksigen', 'do']], w: 8 }] },
    know_diurnal: { group: 'knowledge', label: { id: 'Pengetahuan: Pola Harian DO', en: 'Knowledge: Daily DO Pattern' },
      patterns: [{ all: [['malam', 'subuh', 'dini hari', 'pagi hari', 'siang', 'sore', 'night', 'dawn', 'harian'], ['do', 'oksigen'], ['kenapa', 'mengapa', 'why', 'kok', 'turun', 'rendah', 'naik', 'pola', 'berubah']], w: 9 },
        ['pola harian', 4], ['fotosintesis', 4], ['siklus harian', 4]] },
    know_temp_do: { group: 'knowledge', label: { id: 'Pengetahuan: Suhu dan DO', en: 'Knowledge: Temperature and DO' },
      patterns: [{ all: [['suhu', 'temperatur', 'panas', 'temperature'], ['do', 'oksigen'], ['hubungan', 'pengaruh', 'mempengaruhi', 'memengaruhi', 'kaitan', 'berkaitan', 'relation', 'affect']], w: 9 },
        { all: [['suhu', 'temperatur', 'panas'], ['kelarutan', 'jenuh', 'saturasi']], w: 9 },
        { all: [['panas', 'hangat', 'suhu tinggi', 'warm'], ['oksigen', 'do'], ['sedikit', 'rendah', 'berkurang', 'turun', 'less', 'lower']], w: 9 }] },
    know_ph: { group: 'knowledge', label: { id: 'Pengetahuan: pH', en: 'Knowledge: pH' },
      patterns: [{ all: [DEF, ['ph']], w: 8 },
        { all: [['ph'], ['pengaruh', 'dampak', 'bahaya', 'penting', 'mempengaruhi', 'memengaruhi', 'akibat', 'effect']], w: 8 },
        { all: [['ph'], ['amonia', 'amoniak', 'ammonia']], w: 9 }] },
    know_ranges: { group: 'knowledge', label: { id: 'Rentang Acuan Spesies', en: 'Species Reference Ranges' },
      patterns: [{ all: [['berapa batas', 'batas aman', 'batas ideal', 'batas normal', 'batas minimum', 'batas maksimum', 'rentang', 'ideal', 'standar', 'acuan', 'kisaran', 'syarat', 'range', 'normal'], ['do', 'oksigen', 'suhu', 'temperatur', 'ph', 'kualitas air', 'parameter']], w: 7 },
        { all: [['berapa batas', 'batas aman', 'batas ideal', 'batas untuk', 'rentang', 'ideal', 'standar', 'acuan', 'kisaran', 'syarat', 'normal'], ['lele', 'gurame', 'gurami', 'nila', 'nilem', 'catfish', 'gourami', 'tilapia']], w: 8 },
        ['sni', 5]] },
    know_status: { group: 'knowledge', label: { id: 'Arti Status dan Aturan Keputusan', en: 'Status Meaning and Decision Rules' },
      patterns: [{ all: [DEF, ['status', 'aman', 'waspada', 'kritis', 'safe', 'warning', 'critical']], w: 8 },
        { all: [['bagaimana', 'gimana', 'cara', 'how'], ['status', 'keputusan'], ['ditentukan', 'menentukan', 'dihitung', 'determined', 'decided']], w: 9 },
        ['aturan keputusan', 6], ['logika keputusan', 6], ['decision rule*', 6]] },
    know_model: { group: 'knowledge', label: { id: 'Cara Kerja Prediksi', en: 'How the Forecast Works' },
      patterns: [{ all: [['cara kerja', 'bagaimana cara', 'gimana cara', 'how does', 'how do', 'bekerja', 'metode'], ['prediksi', 'model', 'lstm', 'forecast', 'sistem']], w: 9 },
        { all: [['akurat', 'akurasi', 'tepat', 'ketepatan', 'error', 'galat', 'rmse', 'accurate', 'accuracy', 'dipercaya', 'percaya'], ['prediksi', 'model', 'lstm', 'forecast']], w: 9 },
        { all: [DEF, ['lstm', 'assessment guided']], w: 9 }] },
    know_terms: { group: 'knowledge', label: { id: 'Istilah Assessment', en: 'Assessment Terms' },
      patterns: [{ all: [DEF, ['excursion', 'ekskursi', 'suitability', 'kesesuaian', 'skor', 'score', 'cv', 'koefisien variasi', 'stabilitas', 'assessment']], w: 9 },
        { all: [['bagaimana', 'gimana', 'cara', 'how'], ['skor', 'score', 'cv', 'excursion'], ['dihitung', 'menghitung', 'calculated', 'computed']], w: 9 }] },
    know_raise_do: { group: 'knowledge', label: { id: 'Cara Menaikkan DO', en: 'How to Raise DO' },
      patterns: [{ all: [['cara', 'bagaimana cara', 'gimana cara', 'tips', 'how to', 'upaya'], ['naik*', 'menaikkan', 'meningkatkan', 'menambah', 'tambah', 'raise', 'increase', 'menjaga', 'mempertahankan'], ['do', 'oksigen', 'oxygen']], w: 10 },
        { all: [['mencegah', 'cegah', 'menghindari', 'prevent'], ['do rendah', 'kekurangan oksigen', 'hipoksia', 'oksigen rendah']], w: 10 }] },
    know_emergency: { group: 'knowledge', label: { id: 'Penanganan Darurat', en: 'Emergency Handling' },
      patterns: [['megap megap', 8], ['mengap mengap', 8], ['megap', 8], ['tersengal*', 8], ['ke permukaan', 6], ['mati mendadak', 8], ['banyak yang mati', 8], ['ikan mati', 7],
        { all: [['aerator', 'blower', 'kincir', 'listrik', 'pompa'], ['mati', 'rusak', 'padam', 'error']], w: 10 }, ['darurat', 6], ['emergency', 6]] },
    know_sensor: { group: 'knowledge', label: { id: 'Pemeriksaan Sensor', en: 'Sensor Checking' },
      patterns: [{ all: [['sensor', 'probe', 'alat ukur'], ['kalibrasi', 'kalibr*', 'dikalibrasi', 'benar', 'akurat', 'rusak', 'error', 'aneh', 'cek', 'periksa', 'calibrat*', 'valid']], w: 9 },
        ['kalibrasi', 6], ['calibration', 6]] },
    know_limits: { group: 'knowledge', label: { id: 'Batasan Sistem', en: 'System Limitations' },
      patterns: [['batasan sistem', 8], ['keterbatasan', 7], ['kelemahan', 7], ['limitation*', 7],
        { all: [['bisa', 'boleh', 'can'], ['dipercaya', 'diandalkan', 'trusted', 'rely']], w: 8 },
        { all: [['menggantikan', 'mengganti', 'replace'], ['pengelola', 'petugas', 'manusia', 'operator', 'human']], w: 9 }] },
    // ---------------- Pertanyaan analisis (dihitung dari riwayat data, bukan sekadar membaca satu angka)
    ana_lowest_time: { group: 'analysis', label: { id: 'Analisis: Jam DO Terendah', en: 'Analysis: Lowest-DO Hour' },
      patterns: [{ all: [['jam berapa', 'pukul berapa', 'kapan', 'waktu', 'what time', 'when'], ['do', 'oksigen'], ['paling rendah', 'terendah', 'minimum', 'paling tinggi', 'tertinggi', 'maksimum', 'lowest', 'highest']], w: 11 },
        { all: [['jam', 'pukul', 'waktu'], ['rawan', 'berisiko', 'bahaya']], w: 9 }] },
    ana_trend: { group: 'analysis', label: { id: 'Analisis: Tren DO', en: 'Analysis: DO Trend' },
      patterns: [{ all: [['do', 'oksigen'], ['sedang', 'lagi', 'trend', 'tren', 'arah', 'kecenderungan', 'currently', 'trending'], ['naik', 'turun', 'menurun', 'meningkat', 'up', 'down', 'tren', 'trend']], w: 10 },
        ['tren do', 6], ['do trend', 6], ['kecenderungan do', 6]] },
    ana_compare: { group: 'analysis', label: { id: 'Analisis: Perbandingan Kolam', en: 'Analysis: Pond Comparison' },
      patterns: [{ all: [['bandingkan', 'perbandingan', 'membandingkan', 'compare', 'comparison', 'antar kolam', 'semua kolam', 'kolam lain', 'kolam mana', 'which pond']], w: 10 },
        { all: [['kolam'], ['paling berisiko', 'paling bahaya', 'paling aman', 'paling baik', 'paling buruk', 'terbaik', 'terburuk']], w: 10 }] },
    ana_minmax: { group: 'analysis', label: { id: 'Analisis: DO Minimum dan Maksimum', en: 'Analysis: DO Min and Max' },
      patterns: [{ all: [['do', 'oksigen'], ['terendah', 'tertinggi', 'minimum', 'maksimum', 'paling rendah', 'paling tinggi', 'lowest', 'highest', 'min', 'max']], w: 7 },
        { all: [['24 jam', 'kemarin', 'hari ini', 'seharian', 'last 24']], w: 2 }] },
    ana_last_excursion: { group: 'analysis', label: { id: 'Analisis: Excursion Terakhir', en: 'Analysis: Last Excursion' },
      patterns: [{ all: [['kapan', 'when'], ['terakhir', 'last'], ['do', 'oksigen', 'excursion', 'di bawah batas', 'rendah', 'kritis']], w: 11 },
        { all: [['sudah berapa lama', 'berapa lama sejak', 'sejak kapan'], ['excursion', 'di bawah', 'rendah', 'kritis']], w: 11 }] },
    greeting: {
      label: { id: 'Sapaan', en: 'Greeting' },
      patterns: ['halo', 'hai', 'hi', 'hello', 'hey', 'selamat pagi', 'selamat siang', 'selamat sore', 'selamat malam',
        'good morning', 'good afternoon', 'assalamualaikum'],
    },
  };

  // Urutan pemecah seri: intent spesifik sebelum intent umum.
  const PRIORITY = ['greeting', 'know_emergency', 'know_raise_do', 'ana_last_excursion', 'ana_lowest_time', 'ana_trend', 'ana_compare',
    'know_diurnal', 'know_temp_do', 'know_terms', 'know_status', 'know_model', 'know_sensor', 'know_limits', 'know_ranges', 'know_ph', 'know_do',
    'ana_minmax', 'condition_summary', 'dss_value', 'limiting_parameter', 'excursion_duration', 'do_stability',
    'assessment_score', 'do_forecast', 'recommended_action', 'risk_reason', 'current_condition'];

  // 10 intent inti (subbab 4.8) dievaluasi terpisah dari intent pengetahuan/analisis.
  const groupOf = (k) => INTENTS[k].group || (k === 'greeting' ? 'greeting' : 'core');
  const EVALUATED_INTENTS = Object.keys(INTENTS).filter((k) => groupOf(k) === 'core');
  const EXTENDED_INTENTS = Object.keys(INTENTS).filter((k) => ['knowledge', 'analysis'].includes(groupOf(k)));

  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => (t.length > 5 ? t.replace(/(nya|kah|lah)$/, '') : t));
  }

  function compilePhrase(text, weight) {
    const words = normalize(text.replace(/\*/g, ''));
    return { text, words, prefixLast: text.trim().endsWith('*'), weight: weight ?? words.length };
  }

  function compile(pattern) {
    // Pola gabungan {all: [[alternatif...], [alternatif...]], w}: cocok bila SETIAP kelompok punya minimal satu alternatif yang cocok.
    if (pattern && pattern.all) {
      const groups = pattern.all.map((g) => (Array.isArray(g) ? g : [g]).map((t) => compilePhrase(t, null)));
      return { text: pattern.all.map((g) => (Array.isArray(g) ? g[0] : g)).join(' + '), groups, weight: pattern.w };
    }
    const [text, weight] = Array.isArray(pattern) ? pattern : [pattern, null];
    return compilePhrase(text, weight);
  }

  const COMPILED = Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.patterns.map(compile)]));

  function matches(tokens, p) {
    if (p.groups) return p.groups.every((alts) => alts.some((a) => matches(tokens, a)));
    const n = p.words.length;
    for (let i = 0; i + n <= tokens.length; i += 1) {
      let ok = true;
      for (let j = 0; j < n; j += 1) {
        const tok = tokens[i + j];
        const w = p.words[j];
        const isLast = j === n - 1;
        if (!(tok === w || (isLast && p.prefixLast && tok.startsWith(w)))) { ok = false; break; }
      }
      if (ok) return true;
    }
    return false;
  }

  function detectIntent(question) {
    const tokens = normalize(question);
    if (!tokens.length) return { intent: 'unknown', score: 0, matched: [], scores: {} };
    const scores = {};
    const matchedBy = {};
    for (const [intent, patterns] of Object.entries(COMPILED)) {
      const hit = patterns.filter((p) => matches(tokens, p));
      scores[intent] = hit.reduce((s, p) => s + p.weight, 0);
      matchedBy[intent] = hit.map((p) => p.text);
    }
    const top = Math.max(...Object.values(scores));
    if (top <= 0) return { intent: 'unknown', score: 0, matched: [], scores };
    const tied = PRIORITY.filter((k) => scores[k] === top);
    const intent = tied[0];
    return { intent, score: top, matched: matchedBy[intent], scores };
  }

  function label(intent, lang) {
    const info = INTENTS[intent];
    return info ? info.label[lang === 'id' ? 'id' : 'en'] : intent;
  }

  const api = { INTENTS, PRIORITY, EVALUATED_INTENTS, EXTENDED_INTENTS, groupOf, normalize, detectIntent, label };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NLPIntent = api;
}(typeof window !== 'undefined' ? window : globalThis));
