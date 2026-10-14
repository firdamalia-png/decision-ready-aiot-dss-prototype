"""Uji fungsional black-box prototipe DSS (Tabel 3.19) dengan browser headless.

Prasyarat (dari folder dss_prototype):
    backend : cd backend && uvicorn lstm_api:app --host 127.0.0.1 --port 8000
    web     : python -m http.server 8080 --bind 127.0.0.1
Jalankan  : python tests/test_e2e.py   -> tests/e2e/hasil_uji_fungsional.json + screenshot
"""
import json, re, sys, time, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests" / "e2e"; OUT.mkdir(parents=True, exist_ok=True)
WEB = "http://127.0.0.1:8080"
API = "http://127.0.0.1:8000"
results = []


def record(no, komponen, skenario, harapan, hasil, lulus, bukti=""):
    results.append({"no": no, "komponen": komponen, "skenario": skenario, "harapan": harapan,
                    "hasil": hasil, "status": "LULUS" if lulus else "GAGAL", "bukti": bukti})
    print(f"[{'LULUS' if lulus else 'GAGAL'}] {no}. {komponen}: {hasil}")


def num(text):
    m = re.search(r"-?\d+(?:[.,]\d+)?", text or "")
    return float(m.group(0).replace(",", ".")) if m else None


def shot(page, name):
    page.screenshot(path=str(OUT / name), full_page=True)
    return f"e2e/{name}"


def wait_forecast(page, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if num(page.text_content("#forecast60")) is not None:
            return True
        time.sleep(0.5)
    return False


def apply_model(page):
    page.click("#settingsBtn")
    page.fill("#lstmUrl", f"{API}/predict")
    page.click("#applyModelBtn")
    page.click("#closeSettingsBtn")


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{WEB}/index_id.html"); page.wait_for_selector("#mainStatus")

    # 1 Input data
    ponds = page.eval_on_selector_all("#pondSelect option", "els => els.map(e => e.value)")
    recs = page.text_content("#recordsCount")
    record(1, "Input data", "Memuat data IoT historis bawaan (iot_data.csv)",
           "4 kolam terbaca; 1.344 data per kolam", f"kolam: {ponds}; data kolam aktif: {recs}",
           sorted(ponds) == ["Catfish", "Gourami", "Nilem", "Tilapia"] and recs.replace(".", "") == "1344", shot(page, "01_awal.png"))

    # 2 Assessment temporal (Gurame, seluruh periode) vs Tabel 4.6-4.8
    page.select_option("#pondSelect", "Gourami"); time.sleep(0.5)
    got = {k: num(page.text_content(f"#{k}")) for k in ["tempScore", "phScore", "doScore", "pondScore"]}
    exc = page.text_content("#excursionValue"); cv = num(page.text_content("#doCvValue"))
    exp = {"tempScore": 2.849, "phScore": 3.000, "doScore": 2.202, "pondScore": 2.684}
    ok = all(abs(got[k] - v) < 0.0015 for k, v in exp.items()) and exc.startswith("82 kejadian") and ("78.2" in exc or "78.3" in exc)
    record(2, "Assessment temporal", "Kolam Gurame, seluruh 14 hari",
           "Skor 2,849/3,000/2,202; skor kolam 2,684; 82 excursion, 78,25 jam (Tabel 4.6-4.7)",
           f"skor {got}; excursion '{exc}'; CV DO {cv}%", ok, shot(page, "02_assessment_gurame.png"))

    # 3 Prediksi DO multi-horizon
    apply_model(page); ok_f = wait_forecast(page)
    f = {h: num(page.text_content(f"#forecast{h}")) for h in [15, 30, 45, 60]}
    record(3, "Prediksi DO", "Terapkan endpoint LSTM pada kolam Gurame",
           "Empat nilai prediksi (15/30/45/60 menit) tampil dari model Assessment-Guided LSTM",
           f"prediksi {f}; label model '{page.text_content('#modelBadge')}'",
           ok_f and all(v is not None for v in f.values()) and "Assessment-Guided" in page.text_content("#modelBadge"),
           shot(page, "03_prediksi.png"))

    # 4 Kesesuaian prediksi website dengan backend (day_index memakai awal periode kolam)
    body = page.evaluate("""() => { const seq = backendSequence(forecastSequenceRows());
        return {pond: state.selectedPond, period_start: formatBackendTimestamp(periodStartRow()), sequence: seq}; }""")
    req = urllib.request.Request(f"{API}/predict", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    direct = {p["horizon"]: p["do"] for p in json.load(urllib.request.urlopen(req))["predictions"]}
    same = all(abs(direct[h] - f[h]) < 0.006 for h in f)
    record(4, "Prediksi DO", "Bandingkan prediksi di layar dengan panggilan langsung ke backend",
           "Nilai sama (selisih < 0,01 mg/L karena pembulatan tampilan)", f"layar {f}; backend {direct}; period_start {body['period_start']}",
           same and body["period_start"] in ("15/01/26 00.00", "2026-01-15 00:00:00"))

    # 5 Logika keputusan + 6 rekomendasi
    status = page.text_content("#mainStatus"); rec = page.text_content("#mainRecommendation")
    expected = page.evaluate("""() => { const s = assessment(), last = latestRow(), th = s.threshold;
        const m = Math.min(...state.forecast.map(p => p.do));
        if (last.do < th.doBandMin || m < th.doBandMin) return 'Kritis';
        return 'cek'; }""")
    ok5 = (status == "Kritis") if expected == "Kritis" else (status in ["Waspada", "Aman"])
    record(5, "Logika keputusan", "Status kolam Gurame pada data terakhir",
           "Status sesuai Tabel 3.11 (diuji lengkap di tests/test_rules.js: 72 skenario + 20.000 kasus acak)",
           f"status '{status}' (acuan: {expected})", ok5)
    record(6, "Rekomendasi operasional", "Rekomendasi untuk status yang tampil",
           "Teks rekomendasi tampil dan sesuai status", f"'{rec[:140]}...'",
           bool(rec) and (("aerasi" in rec.lower()) if status in ["Kritis", "Waspada"] else True))

    # 7 Label kartu parameter
    labels = {k: page.text_content(f"#{k}Status") for k in ["temp", "ph", "do"]}
    record(7, "Dashboard - kartu parameter", "Label status tiap parameter pada data terakhir Gurame",
           "Label mengikuti Tabel 3.4 (Optimal / Dapat diterima / Tidak sesuai)", f"{labels}",
           all(v in ["Optimal", "Dapat diterima", "Tidak sesuai"] for v in labels.values()))

    # 8 Grafik
    charts = page.evaluate("""() => ['chart','forecastChart'].map(id => { const el = document.getElementById(id);
        return el ? (el.querySelectorAll('*').length || (el.width||0)) : 0; })""")
    record(8, "Dashboard - grafik", "Grafik tren kualitas air dan grafik prediksi DO",
           "Kedua grafik ter-render", f"jumlah elemen grafik {charts}", all(c > 0 for c in charts), shot(page, "08_dashboard_penuh.png"))

    # 9 NLP: 10 intent via kotak tanya
    nlp_q = {"current_condition": "Bagaimana kondisi kolam saat ini?", "risk_reason": "Kenapa statusnya kritis?",
             "do_forecast": "Berapa prediksi DO 60 menit ke depan?", "recommended_action": "Tindakan apa yang harus dilakukan?",
             "limiting_parameter": "Parameter mana yang paling bermasalah?", "assessment_score": "Berapa skor kesesuaian kolam?",
             "do_stability": "Seberapa stabil DO?", "excursion_duration": "Berapa lama DO di bawah batas?",
             "dss_value": "Apa nilai tambah DSS dibanding monitoring biasa?", "condition_summary": "Berikan ringkasan kondisi kolam"}
    labels_id = page.evaluate("() => Object.fromEntries(NLPIntent.EVALUATED_INTENTS.map(k => [k, NLPIntent.label(k, 'id')]))")
    nlp_ok = 0; nlp_detail = []
    for intent, q in nlp_q.items():
        page.fill("#assistantInput", q); page.click("#assistantAskBtn"); time.sleep(0.6)
        last = page.eval_on_selector_all("#assistantMessages .assistant-message.bot p", "els => els[els.length-1].textContent")
        hit = labels_id[intent] in last; nlp_ok += hit
        nlp_detail.append({"pertanyaan": q, "intent": intent, "terdeteksi_benar": hit, "jawaban": last[:160]})
    record(9, "NLP explanation", "10 pertanyaan, satu per intent, diketik di kotak tanya",
           "Setiap pertanyaan dijawab dengan intent yang benar dan memuat nilai dari DSS", f"{nlp_ok}/10 intent benar",
           nlp_ok == 10, shot(page, "09_nlp.png"))

    # 9b NLP pengetahuan & analisis (17 intent tambahan)
    ext_q = {"know_do": "Apa itu DO?", "know_diurnal": "Kenapa DO turun di malam hari?", "know_temp_do": "Apa hubungan suhu dengan DO?",
             "know_ph": "Apa pengaruh pH terhadap ikan?", "know_ranges": "Berapa batas DO untuk nila?", "know_status": "Apa arti status waspada?",
             "know_model": "Seberapa akurat prediksi model?", "know_terms": "Apa itu excursion?", "know_raise_do": "Bagaimana cara menaikkan DO?",
             "know_emergency": "Aerator mati, apa yang harus dilakukan?", "know_sensor": "Bagaimana kalibrasi sensor DO?", "know_limits": "Apa keterbatasan sistem ini?",
             "ana_lowest_time": "Jam berapa DO paling rendah?", "ana_trend": "Apakah DO sedang turun?", "ana_compare": "Bandingkan semua kolam",
             "ana_minmax": "Berapa DO terendah?", "ana_last_excursion": "Kapan terakhir DO di bawah batas?"}
    ext_labels = page.evaluate("() => Object.fromEntries(NLPIntent.EXTENDED_INTENTS.map(k => [k, NLPIntent.label(k, 'id')]))")
    ext_ok = 0
    for intent, q in ext_q.items():
        page.fill("#assistantInput", q); page.click("#assistantAskBtn"); time.sleep(0.5)
        last = page.eval_on_selector_all("#assistantMessages .assistant-message.bot p", "els => els[els.length-1].textContent")
        hit = ext_labels[intent] in last and len(last) > 120 and "undefined" not in last and "NaN" not in last
        ext_ok += hit
        nlp_detail.append({"pertanyaan": q, "intent": intent, "terdeteksi_benar": hit, "jawaban": last[:220]})
    record("9b", "NLP pengetahuan & analisis", "17 pertanyaan di luar pembacaan angka sistem (satu per intent tambahan)",
           "Setiap pertanyaan dikenali dan dijawab lengkap (tanpa nilai kosong/NaN)", f"{ext_ok}/17 dijawab benar", ext_ok == 17, shot(page, "09b_nlp_pengetahuan.png"))

    # 10 Replay simulasi
    page.click("#simResetBtn"); time.sleep(1.0)
    page.click("#simStepBtn"); wait_forecast(page)
    r1 = page.text_content("#recordsCount"); t1 = page.text_content("#lastUpdated"); f1 = page.text_content("#forecast15")
    page.click("#simStepBtn"); time.sleep(0.5); wait_forecast(page)
    r2 = page.text_content("#recordsCount"); t2 = page.text_content("#lastUpdated")
    record(10, "Simulasi replay IoT", "Reset replay, lalu dua kali 'Langkah +15 menit'",
           "Jumlah data bertambah 1 per langkah, waktu maju 15 menit, prediksi diperbarui",
           f"data {r1} -> {r2}; waktu {t1} -> {t2}; prediksi 15' {f1}",
           int(r2.replace('.', '')) == int(r1.replace('.', '')) + 1 and t1 != t2, shot(page, "10_replay.png"))

    # 11 Input manual what-if -> Kritis
    page.click("#settingsBtn"); page.fill("#manualTemp", "28.5"); page.fill("#manualPh", "7.4"); page.fill("#manualDo", "3.2")
    page.click("#addManualBtn"); page.click("#closeSettingsBtn"); time.sleep(0.5); wait_forecast(page)
    st = page.text_content("#mainStatus")
    record(11, "Input manual (what-if)", "Tambah pembacaan DO 3,2 mg/L pada kolam Gurame (DO Ops = 4,0)",
           "Status menjadi Kritis karena DO < batas operasional", f"status '{st}'", st == "Kritis", shot(page, "11_manual_kritis.png"))

    # 12 Backend mati -> pesan galat, tanpa prediksi basi
    page.click("#settingsBtn"); page.fill("#lstmUrl", "http://127.0.0.1:8999/predict"); page.click("#applyModelBtn"); page.click("#closeSettingsBtn")
    time.sleep(3)
    f60 = page.text_content("#forecast60"); badge = page.text_content("#modelBadge")
    record(12, "Penanganan galat", "Endpoint model tidak dapat dihubungi",
           "Prediksi dikosongkan dan label model menyatakan LSTM belum tersedia", f"prediksi 60' '{f60}'; label '{badge}'",
           num(f60) is None and "belum" in badge.lower(), shot(page, "12_backend_mati.png"))

    # 13 Halaman bahasa Inggris
    page2 = browser.new_page(viewport={"width": 1440, "height": 1000}); page2.goto(f"{WEB}/index.html"); page2.wait_for_selector("#mainStatus")
    record(13, "Antarmuka bahasa Inggris", "Membuka index.html", "Status tampil dalam bahasa Inggris",
           f"status '{page2.text_content('#mainStatus')}'", page2.text_content("#mainStatus") in ["Safe", "Warning", "Critical"], shot(page2, "13_english.png"))

    # 15 Dibuka langsung dari file (klik dua kali), bukan lewat web server
    page3 = browser.new_page(viewport={"width": 1440, "height": 1000})
    page3.on("pageerror", lambda e: errors.append("file:// " + str(e)))
    page3.goto((ROOT / "index_id.html").as_uri()); page3.wait_for_selector("#mainStatus")
    apply_model(page3); ok3 = wait_forecast(page3)
    record(15, "Dibuka dengan klik dua kali (file://)", "Membuka index_id.html langsung dari folder, lalu terapkan endpoint",
           "Halaman tampil dan prediksi LSTM muncul", f"status '{page3.text_content('#mainStatus')}', prediksi 60' {page3.text_content('#forecast60')}",
           ok3, shot(page3, "15_file_mode.png"))

    record(14, "Stabilitas halaman", "Seluruh skenario di atas", "Tidak ada galat JavaScript", f"{len(errors)} galat: {errors[:3]}", not errors)
    browser.close()

summary = {"lulus": sum(r["status"] == "LULUS" for r in results), "total": len(results), "hasil": results, "nlp_detail": nlp_detail}
(OUT / "hasil_uji_fungsional.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"\n{summary['lulus']}/{summary['total']} uji fungsional lulus")
sys.exit(0 if summary["lulus"] == summary["total"] else 1)
