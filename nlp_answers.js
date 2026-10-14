/*
 * Jawaban untuk intent pengetahuan (know_*) dan analisis (ana_*) pada chatbot DSS.
 * - Intent pengetahuan: jawaban baku berbasis literatur yang dikutip di disertasi dan rancangan sistem.
 * - Intent analisis: dihitung langsung dari riwayat data kolam yang sedang dimuat.
 * Dipanggil dari app.js -> buildExtendedResponse(intent, question, env).
 * env = { lang, pond, rows, allRows, threshold, thresholds, summary, rec, forecast, modelInfo, assess(pondRows, threshold) }
 */
(function (root) {
  'use strict';

  const POND_NAMES = { Catfish: 'Lele', Gourami: 'Gurame', Tilapia: 'Nila', Nilem: 'Nilem' };
  const SPECIES_WORDS = { lele: 'Catfish', catfish: 'Catfish', gurame: 'Gourami', gurami: 'Gourami', gourami: 'Gourami',
    nilem: 'Nilem', nila: 'Tilapia', tilapia: 'Tilapia' };

  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');
  const name = (pond, lang) => (lang === 'id' ? `${POND_NAMES[pond] || pond}` : pond);
  const dateTime = (d, lang) => d.toLocaleString(lang === 'id' ? 'id-ID' : 'en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  function speciesInQuestion(question) {
    const words = String(question || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
    if (words.includes('nilem')) return 'Nilem';
    for (const w of words) if (SPECIES_WORDS[w]) return SPECIES_WORDS[w];
    return null;
  }

  function rangesText(pond, th, lang) {
    return lang === 'id'
      ? `${name(pond, lang)}: suhu optimal ${th.tempOpt[0]}–${th.tempOpt[1]} °C (operasional ${th.tempBand[0]}–${th.tempBand[1]} °C), pH optimal ${th.phOpt[0]}–${th.phOpt[1]} (operasional ${th.phBand[0]}–${th.phBand[1]}), DO optimal ≥ ${th.doOptMin} mg/L dan batas operasional ≥ ${th.doBandMin} mg/L`
      : `${pond}: optimal temperature ${th.tempOpt[0]}–${th.tempOpt[1]} °C (operational ${th.tempBand[0]}–${th.tempBand[1]} °C), optimal pH ${th.phOpt[0]}–${th.phOpt[1]} (operational ${th.phBand[0]}–${th.phBand[1]}), optimal DO ≥ ${th.doOptMin} mg/L, operational limit ≥ ${th.doBandMin} mg/L`;
  }

  function hourlyProfile(rows) {
    const sums = Array(24).fill(0), counts = Array(24).fill(0);
    rows.forEach((r) => { const h = r.timestamp.getHours(); sums[h] += r.do; counts[h] += 1; });
    const mean = sums.map((s, h) => (counts[h] ? s / counts[h] : NaN));
    const valid = mean.map((v, h) => ({ h, v })).filter((x) => Number.isFinite(x.v));
    const lo = valid.reduce((a, b) => (b.v < a.v ? b : a));
    const hi = valid.reduce((a, b) => (b.v > a.v ? b : a));
    return { lo, hi, days: Math.round(rows.length / 96) };
  }

  function slopePerHour(rows) {
    const n = rows.length; if (n < 3) return NaN;
    const xs = rows.map((r) => (r.timestamp - rows[0].timestamp) / 3600000), ys = rows.map((r) => r.do);
    const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
    return den ? num / den : NaN;
  }

  // Sumber yang ditampilkan di akhir jawaban pengetahuan. Status verifikasi tiap klaim: docs/SUMBER_JAWABAN_NLP.md
  const SOURCES = {
    know_do: { id: 'Sumber: Boyd & Tucker (1998); Timmons & Ebeling (2022).', en: 'Sources: Boyd & Tucker (1998); Timmons & Ebeling (2022).' },
    know_diurnal: { id: 'Sumber: Boyd & Tucker (1998); profil jam dihitung dari data kolam.', en: 'Sources: Boyd & Tucker (1998); hourly profile computed from pond data.' },
    know_temp_do: { id: 'Sumber: Boyd & Tucker (1998); tabel kelarutan oksigen USGS (DOTABLES).', en: 'Sources: Boyd & Tucker (1998); USGS oxygen solubility tables (DOTABLES).' },
    know_ph: { id: 'Sumber: Boyd & Tucker (1998); Colt (2006); Tabel 2.1.', en: 'Sources: Boyd & Tucker (1998); Colt (2006); Table 2.1.' },
    know_ranges: { id: 'Sumber: Tabel 2.1 (SNI 01-6141-1999, SNI 01-6485.3-2000, SNI 01-6484.4-2000, dan literatur spesies).', en: 'Source: Table 2.1 (Indonesian SNI standards and species literature).' },
    know_status: { id: 'Sumber: rancangan sistem (Tabel 3.4 dan 3.11).', en: 'Source: system design (Tables 3.4 and 3.11).' },
    know_model: { id: 'Sumber: rancangan model (subbab 3.6) dan metadata model terpasang.', en: 'Source: model design (section 3.6) and deployed model metadata.' },
    know_terms: { id: 'Sumber: rancangan assessment (subbab 3.5.5–3.5.9).', en: 'Source: assessment design (sections 3.5.5–3.5.9).' },
    know_raise_do: { id: 'Panduan umum pengelolaan kolam (Boyd & Tucker, 1998); sesuaikan dengan SOP BBI.', en: 'General pond-management guidance (Boyd & Tucker, 1998); follow local SOP.' },
    know_emergency: { id: 'Panduan umum; ikuti SOP darurat BBI dan arahan petugas.', en: 'General guidance; follow the hatchery emergency SOP.' },
    know_sensor: { id: 'Sumber: dokumentasi pabrikan sensor (DFRobot SEN0237, PH-4502C) dan prosedur kalibrasi subbab 3.4.', en: 'Sources: sensor manufacturer documentation (DFRobot SEN0237, PH-4502C) and calibration procedure in section 3.4.' },
    know_limits: { id: 'Sumber: batasan penelitian (subbab 1.3).', en: 'Source: research scope (section 1.3).' },
  };

  const ANSWERS = {
    know_do: (e) => (e.lang === 'id'
      ? 'Oksigen terlarut (dissolved oxygen, DO) adalah jumlah oksigen yang larut dalam air, dinyatakan dalam mg/L. Ikan dan benih memakai oksigen ini untuk bernapas, sehingga DO yang terlalu rendah (hipoksia) dapat menurunkan nafsu makan, pertumbuhan, dan daya tahan, bahkan menyebabkan kematian. Oksigen di kolam berasal dari fotosintesis fitoplankton dan tanaman air pada siang hari, difusi dari udara, serta aerasi; oksigen dikonsumsi oleh respirasi ikan, plankton, dan bakteri pengurai bahan organik (Boyd & Tucker, 1998; Timmons & Ebeling, 2022). Karena itu DO menjadi target prediksi utama dalam sistem ini.'
      : 'Dissolved oxygen (DO) is the amount of oxygen dissolved in water, in mg/L. Fish and fry need it for respiration; low DO (hypoxia) reduces feeding, growth and resistance and can cause mortality. Pond oxygen comes from photosynthesis, diffusion from air and aeration, and is consumed by fish, plankton and decomposing bacteria (Boyd & Tucker, 1998). That is why DO is the main forecast target of this system.'),

    know_diurnal: (e) => {
      const p = hourlyProfile(e.rows);
      return e.lang === 'id'
        ? `Pada siang hari fitoplankton berfotosintesis dan menghasilkan oksigen sehingga DO naik; pada malam hari fotosintesis berhenti sementara respirasi ikan, plankton, dan bakteri tetap berlangsung sehingga DO turun dan biasanya mencapai titik terendah menjelang pagi (Boyd & Tucker, 1998). Pada data ${name(e.pond, e.lang)} yang sedang dimuat (${p.days} hari), rata-rata DO terendah terjadi sekitar pukul ${String(p.lo.h).padStart(2, '0')}.00 (${f2(p.lo.v)} mg/L) dan tertinggi sekitar pukul ${String(p.hi.h).padStart(2, '0')}.00 (${f2(p.hi.v)} mg/L). Periode malam hingga dini hari karena itu perlu pemantauan aerasi yang lebih ketat.`
        : `During the day phytoplankton photosynthesis raises DO; at night photosynthesis stops while respiration continues, so DO falls and usually reaches its minimum near dawn (Boyd & Tucker, 1998). In the loaded ${e.pond} data (${p.days} days), mean DO is lowest around ${String(p.lo.h).padStart(2, '0')}:00 (${f2(p.lo.v)} mg/L) and highest around ${String(p.hi.h).padStart(2, '0')}:00 (${f2(p.hi.v)} mg/L).`;
    },

    know_temp_do: (e) => (e.lang === 'id'
      ? 'Semakin tinggi suhu air, semakin sedikit oksigen yang dapat larut. Pada air tawar di permukaan laut, kadar oksigen jenuh sekitar 8,3 mg/L pada 25 °C dan sekitar 7,6 mg/L pada 30 °C. Pada saat yang sama, suhu tinggi mempercepat metabolisme sehingga ikan membutuhkan lebih banyak oksigen (Boyd & Tucker, 1998). Itulah sebabnya suhu dipakai sebagai masukan model prediksi DO dan dinilai dalam assessment.'
      : 'Warmer water holds less oxygen: freshwater saturation at sea level is about 8.3 mg/L at 25 °C and about 7.6 mg/L at 30 °C, while higher temperature also raises fish oxygen demand (Boyd & Tucker, 1998). This is why temperature is a model input and an assessment parameter.'),

    know_ph: (e) => (e.lang === 'id'
      ? `pH menunjukkan tingkat keasaman air. pH kolam berubah harian: naik pada siang hari saat fotosintesis menyerap CO₂ dan turun pada malam hari. pH di luar rentang yang sesuai dapat menimbulkan stres pada ikan, dan pH tinggi meningkatkan proporsi amonia tak terionisasi yang beracun (Boyd & Tucker, 1998; Colt, 2006). Rentang acuan pH untuk kolam ini: optimal ${e.threshold.phOpt[0]}–${e.threshold.phOpt[1]}, operasional ${e.threshold.phBand[0]}–${e.threshold.phBand[1]}.`
      : `pH indicates water acidity. Pond pH rises during the day as photosynthesis removes CO₂ and falls at night. pH outside the suitable range stresses fish, and high pH increases the share of toxic un-ionised ammonia (Boyd & Tucker, 1998; Colt, 2006). Reference pH for this pond: optimal ${e.threshold.phOpt[0]}–${e.threshold.phOpt[1]}, operational ${e.threshold.phBand[0]}–${e.threshold.phBand[1]}.`),

    know_ranges: (e) => {
      const sp = speciesInQuestion(e.question);
      const ponds = sp ? [sp] : [e.pond];
      const body = ponds.map((p) => rangesText(p, e.thresholds[p], e.lang)).join('; ');
      return e.lang === 'id'
        ? `Rentang acuan yang digunakan sistem (Tabel 2.1, berdasarkan SNI dan literatur) — ${body}. Nilai di antara batas optimal dan operasional diberi skor 2 (dapat diterima); di luar batas operasional diberi skor 1. Rentang ini belum dikalibrasi secara fisiologis di lokasi penelitian.`
        : `Reference ranges used by the system (Table 2.1, from SNI and literature) — ${body}. Values between optimal and operational limits score 2; outside operational limits score 1.`;
    },

    know_status: (e) => (e.lang === 'id'
      ? `Status ditentukan dengan aturan berjenjang (Tabel 3.11). KRITIS bila DO saat ini atau salah satu prediksi 15–60 menit di bawah batas operasional (${e.threshold.doBandMin} mg/L untuk kolam ini), atau suhu/pH di luar rentang operasional. WASPADA bila tidak kritis tetapi DO saat ini atau prediksi di bawah target optimal (${e.threshold.doOptMin} mg/L), pernah terjadi excursion DO dalam riwayat, suhu/pH hanya "dapat diterima", rata-rata skor suhu atau pH < 2,85, atau CV DO > 16%. AMAN bila tidak ada kondisi tersebut. Assessment dihitung dari seluruh riwayat kolam yang dimuat, dan ambang 2,85 serta 16% merupakan parameter rancangan yang belum divalidasi pakar.`
      : `Status uses tiered rules (Table 3.11). CRITICAL if current DO or any 15–60 min forecast is below the operational limit (${e.threshold.doBandMin} mg/L here) or temperature/pH is outside the operational band. WARNING if not critical but DO/forecast is below the optimal target (${e.threshold.doOptMin} mg/L), a DO excursion exists in the history, temperature/pH is only acceptable, mean temperature or pH score < 2.85, or DO CV > 16%. SAFE otherwise.`),

    know_model: (e) => {
      const m = e.modelInfo && Array.isArray(e.modelInfo.test_metrics) ? e.modelInfo.test_metrics : null;
      const acc = m
        ? (e.lang === 'id'
          ? ` Pada data uji, RMSE model yang terpasang adalah ${m.map((r) => `${f2(r.RMSE)} mg/L (${r.horizon_min} menit)`).join(', ')}.`
          : ` On the test data the deployed model's RMSE is ${m.map((r) => `${f2(r.RMSE)} mg/L (${r.horizon_min} min)`).join(', ')}.`)
        : (e.lang === 'id' ? ' Metrik akurasi tampil setelah endpoint model diterapkan.' : ' Accuracy metrics appear once the model endpoint is applied.');
      return e.lang === 'id'
        ? `Prediksi dibuat oleh model Assessment-Guided LSTM (Long Short-Term Memory). Model membaca 24 langkah terakhir (6 jam) yang berisi 122 fitur: nilai suhu, pH, DO, lag dan statistik bergerak, serta fitur assessment (skor kesesuaian, excursion, stabilitas). Keluarannya adalah DO 15, 30, 45, dan 60 menit ke depan.${acc} Prediksi bersifat pendukung keputusan: nilainya cenderung lebih halus daripada fluktuasi aktual dan tetap perlu dikonfirmasi dengan pengukuran lapangan.`
        : `Forecasts come from an Assessment-Guided LSTM that reads the last 24 steps (6 hours) of 122 features (temperature, pH, DO, lags, rolling statistics and assessment features) and outputs DO at 15, 30, 45 and 60 minutes.${acc} Forecasts support, not replace, field measurement.`;
    },

    know_terms: (e) => (e.lang === 'id'
      ? 'Istilah assessment pada sistem ini: (1) Skor kesesuaian (suitability) — setiap pembacaan diberi skor 3 bila berada di rentang optimal, 2 bila hanya dalam rentang operasional, dan 1 bila di luar rentang operasional; skor kolam adalah rata-rata skor suhu, pH, dan DO. (2) Excursion — rangkaian pembacaan berurutan saat DO berada di bawah batas operasional; sistem menghitung jumlah kejadian, total durasi, dan durasi terpanjang (interval 15 menit). (3) CV (koefisien variasi) — simpangan baku dibagi rata-rata, menunjukkan seberapa besar fluktuasi relatif DO; CV di atas 16% dianggap fluktuatif oleh aturan keputusan.'
      : 'Assessment terms: (1) Suitability score — 3 = optimal range, 2 = operational range only, 1 = outside operational range; the pond score averages temperature, pH and DO. (2) Excursion — consecutive readings with DO below the operational limit; the system counts events, total and maximum duration. (3) CV — standard deviation divided by mean, i.e. relative DO fluctuation; CV above 16% is treated as fluctuating.'),

    know_raise_do: (e) => (e.lang === 'id'
      ? 'Upaya umum untuk menjaga atau menaikkan DO: (1) nyalakan atau tambah aerasi (kincir, blower, aerator), terutama malam hingga pagi; (2) kurangi atau hentikan sementara pemberian pakan saat DO rendah, karena pencernaan dan sisa pakan menambah kebutuhan oksigen; (3) lakukan pergantian air sebagian dengan air yang lebih segar; (4) buang endapan dan sisa pakan di dasar kolam; (5) sesuaikan padat tebar; (6) hindari ledakan plankton berlebih yang menyebabkan DO sangat rendah di malam hari. Pilih tindakan sesuai kondisi dan sarana di lokasi, dan konfirmasi dengan pengukuran DO langsung.'
      : 'General ways to maintain or raise DO: run or add aeration (especially night to morning), reduce or pause feeding when DO is low, partial water exchange, remove bottom sludge and uneaten feed, adjust stocking density, and avoid excessive plankton blooms. Confirm with direct DO measurement.'),

    know_emergency: (e) => (e.lang === 'id'
      ? 'Ikan yang megap-megap di permukaan atau berkumpul di dekat aliran air adalah tanda umum kekurangan oksigen. Langkah darurat yang umum dilakukan: (1) segera nyalakan aerasi atau aerator cadangan / sumber listrik cadangan; (2) hentikan pemberian pakan; (3) tambahkan air segar bila tersedia; (4) ukur DO langsung dengan alat ukur portabel untuk memastikan; (5) singkirkan ikan mati dan laporkan ke penanggung jawab atau petugas BBI. Chatbot ini tidak menggantikan penilaian petugas di lapangan.'
      : 'Fish gasping at the surface is a common sign of oxygen shortage. Common emergency steps: start aeration or backup aerators/power, stop feeding, add fresh water if available, verify DO with a portable meter, remove dead fish and inform the person in charge. This chatbot does not replace on-site judgement.'),

    know_sensor: (e) => (e.lang === 'id'
      ? 'Pemeriksaan sensor yang dianjurkan: kalibrasi sensor pH dengan larutan buffer (misalnya pH 4 dan 7) dan sensor DO dengan air jenuh udara/air referensi sesuai petunjuk pabrikan; untuk sensor DO galvanik, periksa membran dan elektrolit. Bersihkan probe secara rutin, periksa konektor, dan bandingkan pembacaan secara berkala dengan alat ukur portabel atau termometer. Curigai kesalahan sensor bila nilai melonjak tidak wajar, tetap konstan lama, atau berada di luar rentang fisik yang mungkin; sistem menyarankan pemeriksaan ulang pembacaan sebelum intervensi.'
      : 'Recommended sensor checks: calibrate pH with buffer solutions (e.g. pH 4 and 7) and DO with air-saturated/reference water per the manufacturer; for galvanic DO probes check membrane and electrolyte. Clean probes, check connectors and compare periodically with a portable meter. Suspect sensor faults if values jump implausibly or stay constant.'),

    know_limits: (e) => (e.lang === 'id'
      ? 'Batasan sistem: (1) model dilatih dari data 14 hari per kolam pada empat kolam di BBI Ciganjur, sehingga kinerjanya pada kolam, musim, atau lokasi lain belum diuji; (2) hanya tiga parameter yang diukur (suhu, pH, DO), sedangkan amonia, nitrit, dan parameter lain tidak dipantau; (3) rentang acuan dan ambang aturan (2,85 dan 16%) belum divalidasi pakar; (4) prediksi cenderung lebih halus daripada fluktuasi mendadak; (5) chatbot hanya mengenali topik yang telah dirancang. Sistem ini adalah pendukung keputusan: keputusan akhir tetap pada pengelola setelah memeriksa kondisi lapangan.'
      : 'Limitations: trained on 14 days per pond from four ponds at one hatchery; only temperature, pH and DO are measured; reference ranges and rule thresholds are not yet expert-validated; forecasts smooth sudden fluctuations; the chatbot covers designed topics only. Final decisions remain with the pond manager.'),

    ana_lowest_time: (e) => {
      const p = hourlyProfile(e.rows);
      return e.lang === 'id'
        ? `Berdasarkan ${e.rows.length.toLocaleString('id-ID')} data ${name(e.pond, e.lang)} (${p.days} hari), rata-rata DO terendah terjadi sekitar pukul ${String(p.lo.h).padStart(2, '0')}.00–${String(p.lo.h).padStart(2, '0')}.59 (${f2(p.lo.v)} mg/L) dan tertinggi sekitar pukul ${String(p.hi.h).padStart(2, '0')}.00 (${f2(p.hi.v)} mg/L). Batas operasional kolam ini ${e.threshold.doBandMin} mg/L, sehingga jam-jam sekitar titik terendah adalah waktu paling rawan.`
        : `From ${e.rows.length} readings of ${e.pond} (${p.days} days), mean DO is lowest around ${String(p.lo.h).padStart(2, '0')}:00 (${f2(p.lo.v)} mg/L) and highest around ${String(p.hi.h).padStart(2, '0')}:00 (${f2(p.hi.v)} mg/L). The operational limit here is ${e.threshold.doBandMin} mg/L.`;
    },

    ana_trend: (e) => {
      const recent = e.rows.slice(-9);
      const s = slopePerHour(recent);
      const dir = !Number.isFinite(s) ? '-' : Math.abs(s) < 0.1 ? (e.lang === 'id' ? 'relatif stabil' : 'relatively stable') : s < 0 ? (e.lang === 'id' ? 'menurun' : 'decreasing') : (e.lang === 'id' ? 'meningkat' : 'increasing');
      const fc = e.forecast.filter(Number.isFinite);
      const fcText = fc.length
        ? (e.lang === 'id' ? ` Prediksi 60 menit ke depan: ${f2(fc[fc.length - 1])} mg/L dibanding DO saat ini ${f2(recent[recent.length - 1].do)} mg/L.` : ` 60-minute forecast: ${f2(fc[fc.length - 1])} mg/L vs current ${f2(recent[recent.length - 1].do)} mg/L.`)
        : '';
      return e.lang === 'id'
        ? `Dalam 2 jam terakhir (9 pembacaan), DO ${dir} dengan laju sekitar ${f2(s)} mg/L per jam (dari ${f2(recent[0].do)} ke ${f2(recent[recent.length - 1].do)} mg/L).${fcText}`
        : `Over the last 2 hours (9 readings) DO is ${dir} at about ${f2(s)} mg/L per hour (${f2(recent[0].do)} → ${f2(recent[recent.length - 1].do)} mg/L).${fcText}`;
    },

    ana_compare: (e) => {
      const ponds = [...new Set(e.allRows.map((r) => r.pond))].filter((p) => e.thresholds[p]);
      const items = ponds.map((p) => {
        const rows = e.allRows.filter((r) => r.pond === p).sort((a, b) => a.timestamp - b.timestamp);
        const a = e.assess(rows, e.thresholds[p]);
        return { p, score: a.pondScore, exc: a.excursion.count, hours: a.excursion.totalHours, cv: a.doCv, last: rows[rows.length - 1].do };
      }).sort((x, y) => y.hours - x.hours || x.score - y.score);
      const list = items.map((i) => (e.lang === 'id'
        ? `${name(i.p, e.lang)}: skor ${i.score.toFixed(3)}, excursion ${i.exc} kejadian (${i.hours.toFixed(1)} jam), CV DO ${(i.cv * 100).toFixed(1)}%`
        : `${i.p}: score ${i.score.toFixed(3)}, ${i.exc} excursion(s) (${i.hours.toFixed(1)} h), DO CV ${(i.cv * 100).toFixed(1)}%`)).join('; ');
      return e.lang === 'id'
        ? `Perbandingan kolam (diurutkan dari total durasi excursion terlama): ${list}. Kolam dengan risiko DO tertinggi pada data ini adalah ${name(items[0].p, e.lang)}. Catatan: data tiap kolam berasal dari periode pengamatan yang berbeda dan ambang spesies berbeda, sehingga perbandingan ini bersifat deskriptif, bukan perbandingan antarspesies yang terkontrol.`
        : `Pond comparison (sorted by total excursion duration): ${list}. Highest DO risk: ${items[0].p}. Note: ponds were observed in different periods with different species thresholds, so this comparison is descriptive.`;
    },

    ana_minmax: (e) => {
      const last24 = e.rows.slice(-96);
      const ext = (rows, fn) => rows.reduce((a, b) => (fn(b.do, a.do) ? b : a));
      const lo24 = ext(last24, (x, y) => x < y), hi24 = ext(last24, (x, y) => x > y);
      const loAll = ext(e.rows, (x, y) => x < y), hiAll = ext(e.rows, (x, y) => x > y);
      return e.lang === 'id'
        ? `Dalam 24 jam terakhir, DO terendah ${f2(lo24.do)} mg/L (${dateTime(lo24.timestamp, e.lang)}) dan tertinggi ${f2(hi24.do)} mg/L (${dateTime(hi24.timestamp, e.lang)}). Selama seluruh riwayat yang dimuat, DO terendah ${f2(loAll.do)} mg/L (${dateTime(loAll.timestamp, e.lang)}) dan tertinggi ${f2(hiAll.do)} mg/L (${dateTime(hiAll.timestamp, e.lang)}).`
        : `In the last 24 hours, DO ranged from ${f2(lo24.do)} mg/L (${dateTime(lo24.timestamp, e.lang)}) to ${f2(hi24.do)} mg/L (${dateTime(hi24.timestamp, e.lang)}). Over the full loaded history: ${f2(loAll.do)} to ${f2(hiAll.do)} mg/L.`;
    },

    ana_last_excursion: (e) => {
      const ops = e.threshold.doBandMin;
      const latest = e.rows[e.rows.length - 1];
      let i = e.rows.length - 1;
      if (latest.do < ops) {
        while (i > 0 && e.rows[i - 1].do < ops) i -= 1;
        const hours = ((latest.timestamp - e.rows[i].timestamp) / 3600000) + 0.25;
        return e.lang === 'id'
          ? `Saat ini DO masih di bawah batas operasional ${ops} mg/L. Excursion yang sedang berlangsung dimulai ${dateTime(e.rows[i].timestamp, e.lang)} dan sudah berjalan sekitar ${hours.toFixed(2)} jam.`
          : `DO is currently below the operational limit (${ops} mg/L). The ongoing excursion started ${dateTime(e.rows[i].timestamp, e.lang)}, about ${hours.toFixed(2)} h ago.`;
      }
      const last = [...e.rows].reverse().find((r) => r.do < ops);
      if (!last) {
        return e.lang === 'id'
          ? `Tidak ada pembacaan DO di bawah batas operasional ${ops} mg/L pada riwayat ${name(e.pond, e.lang)} yang dimuat.`
          : `No DO reading below the operational limit (${ops} mg/L) in the loaded ${e.pond} history.`;
      }
      const hoursAgo = (latest.timestamp - last.timestamp) / 3600000;
      return e.lang === 'id'
        ? `Excursion terakhir (DO < ${ops} mg/L) tercatat pada ${dateTime(last.timestamp, e.lang)} dengan DO ${f2(last.do)} mg/L, sekitar ${hoursAgo.toFixed(1)} jam sebelum data terbaru.`
        : `The last excursion (DO < ${ops} mg/L) was at ${dateTime(last.timestamp, e.lang)} with DO ${f2(last.do)} mg/L, about ${hoursAgo.toFixed(1)} h before the latest reading.`;
    },
  };

  function buildExtendedResponse(intent, question, env) {
    const fn = ANSWERS[intent];
    if (!fn || !env.rows || !env.rows.length) return null;
    const text = fn({ ...env, question });
    const src = SOURCES[intent];
    return src ? `${text} (${env.lang === 'id' ? src.id : src.en})` : text;
  }

  const api = { buildExtendedResponse, speciesInQuestion, hourlyProfile, slopePerHour, ANSWERS, SOURCES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NLPAnswers = api;
}(typeof window !== 'undefined' ? window : globalThis));
