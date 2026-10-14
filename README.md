# Prototipe DSS Decision-Ready AIoT — Kualitas Air Kolam Pembenihan Ikan

Prototipe sistem pendukung keputusan (DSS) untuk disertasi *Pengembangan Kerangka Decision-Ready AIoT Berbasis Assessment Temporal dan Prediksi Multi-Horizon*.

Alur sistem:
1. Data sensor (suhu, pH, DO) masuk.
2. Data diolah menjadi assessment temporal: suitability, excursion, stability.
3. Model memprediksi DO 15/30/45/60 menit ke depan (Assessment-Guided LSTM).
4. Sistem menentukan status Aman/Waspada/Kritis.
5. Sistem menampilkan rekomendasi dan penjelasan NLP.

## Cara menjalankan

0. **Persyaratan.** Python 3.9–3.13 (TensorFlow 2.20). Instalasi bersih dari `backend/requirements.txt` sudah diuji di Python 3.13.
1. **Backend model.**
   - **macOS:** klik dua kali `backend/run_backend.command`. Pertama kali, klik kanan lalu pilih Open, karena macOS memblokir skrip yang diunduh. Skrip membuat `venv` dan memasang paket otomatis.
   - Linux: jalankan `run_backend.sh`. Windows: jalankan `run_backend.bat`.
   - Cek di `http://127.0.0.1:8000/health`. Hasilnya harus menunjukkan `"model_loaded": true`, `"window_size": 24`, dan `"feature_count": 122`.
2. **Halaman web.** Buka `index_id.html` (Bahasa Indonesia) atau `index.html` (English) di browser.
3. **Hubungkan model.** Klik **Data dan Model**, pastikan endpoint `http://127.0.0.1:8000/predict`, lalu klik **Terapkan endpoint model**.
   - Prediksi DO hanya tampil setelah langkah ini.

## Mode data

| Mode | Kegunaan |
|---|---|
| Data IoT historis (bawaan) | Memuat `historical-data.js`, yaitu salinan `data/iot_data.csv` sebanyak 5.376 data dari 4 kolam BBI Ciganjur |
| Simulasi replay | Memutar ulang data historis seolah-olah datang setiap 15 menit. Dimulai dari 96 data pertama, lalu tombol **Langkah +15 menit** menambah satu data |
| Input manual (what-if) | Menambah satu pembacaan 15 menit setelah data terakhir untuk mendemonstrasikan respons DSS |
| Live / Firebase | Mengambil pembacaan terbaru dari Firebase REST (`/readings/latest.json`) |

Periode data per kolam:
- Lele: 1–14 Januari 2026
- Gurame: 15–28 Januari 2026
- Nila: 29 Januari–11 Februari 2026
- Nilem: 12–25 Februari 2026

Setiap kolam berisi 1.344 data dengan interval 15 menit.

## Komponen dan kesesuaian dengan disertasi

| Komponen | Implementasi | Acuan disertasi |
|---|---|---|
| Rentang acuan | `THRESHOLDS` di `app.js` dan `backend/lstm_api.py` | Tabel 2.1 |
| Skor kesesuaian | 3 = Optimal, 2 = Dapat diterima, 1 = Tidak sesuai | Tabel 3.4 |
| Assessment pada dashboard | Dihitung **kumulatif** dari seluruh riwayat kolam yang dimuat, sejak data pertama sampai data terkini | 3.5.6–3.5.9, 3.6.6 |
| Fitur model | 122 fitur, dihitung ulang di backend dari data mentah. Lag, rolling, skor, flag, dan durasi excursion hanya memakai data ≤ t | 3.5.9, `training/feature_groups.json` |
| Model | Full Assessment-Guided LSTM: 96 unit, dropout 0,2, window 24, target DO mg/L | 3.6.1, 3.6.4 |
| Logika keputusan | Fungsi `decision()` di `app.js`. Kritis diperiksa lebih dulu, lalu Waspada, lalu Aman | Tabel 3.11 |
| NLP explanation | `nlp.js`: pencocokan kata kunci berbobot. 10 intent inti (membaca keluaran DSS) + 17 intent tambahan (pengetahuan dan analisis data). Jawaban di `app.js` dan `nlp_answers.js` | 3.8.3, 4.8 |

### Model yang terpasang

`backend/model_lstm_do.keras` dilatih ulang **satu kali** (seed 42, split utama 70/15/15) dengan `training/DSS_Final_Model_Export.ipynb`. Konfigurasinya sama dengan skenario Full_Assessment_Guided_LSTM pada eksperimen. Model ini **bukan** salah satu dari 5 run yang dirata-ratakan di Tabel 4.10–4.12.

Metrik ujinya (juga ada di `model_metadata.json` dan `/health`):

| Horizon | RMSE |
|---|---|
| 15 menit | 0,376 |
| 30 menit | 0,392 |
| 45 menit | 0,346 |
| 60 menit | 0,360 |

Decision accuracy any-horizon: 0,927.

### Status Aman pada data historis

Aturan Tabel 3.11 menetapkan Waspada jika ada riwayat excursion DO atau CV DO > 16%. Karena assessment bersifat kumulatif, kolam Gurame, Nila, dan Nilem tidak pernah mencapai status Aman setelah excursion pertama. Ini perilaku aturan, bukan galat program. Kalibrasi ambang (2,85 dan 16%) dan panjang jendela assessment perlu dilakukan bersama pakar.

## Chatbot NLP

**10 intent inti (subbab 4.8):** membaca keluaran DSS. Topiknya kondisi saat ini, ringkasan, alasan risiko, prediksi DO, rekomendasi, parameter pembatas, skor, stabilitas, durasi excursion, dan nilai DSS.

**12 intent pengetahuan:** jawaban baku dengan sumber yang ditampilkan di akhir jawaban. Status verifikasi tiap klaim ada di `docs/SUMBER_JAWABAN_NLP.md`. Jawaban darurat dan cara menaikkan DO wajib ditinjau ko-promotor atau petugas BBI. Topiknya:
- apa itu DO
- pola harian DO
- hubungan suhu dan DO
- pH
- rentang acuan tiap spesies
- arti status dan aturan keputusan
- cara kerja dan akurasi prediksi
- istilah assessment
- cara menaikkan DO
- penanganan darurat
- kalibrasi sensor
- batasan sistem

**5 intent analisis:** dihitung langsung dari riwayat data kolam. Topiknya:
- jam DO terendah/tertinggi
- tren DO 2 jam terakhir
- perbandingan semua kolam
- DO minimum/maksimum
- kapan excursion terakhir

## Struktur folder

```
index.html, index_id.html   halaman DSS (EN / ID)
app.js                      assessment, logika keputusan, dashboard, simulasi, chatbot
nlp.js                      pengenalan intent NLP (dipakai juga oleh tes)
nlp_answers.js              jawaban intent pengetahuan dan analisis
styles.css, historical-data.js
data/iot_data.csv           data sensor historis (sumber historical-data.js)
backend/                    API prediksi (FastAPI) + model, scaler, metadata
training/                   notebook ekspor model, feature_groups.json, dataset fitur pelatihan
firmware/                   TEMPLATE sketch ESP32 -> Firebase (rumus konversi masih placeholder)
tests/                      uji backend, aturan keputusan, NLP, dan uji fungsional end-to-end
```

## Pengujian

Semua perintah dijalankan dari folder ini.

```
pip install -r backend/requirements.txt -r tests/requirements-test.txt
python tests/test_backend.py      # fitur backend = dataset pelatihan; /predict = model
node   tests/test_rules.js        # logika keputusan vs Tabel 3.11 (72 skenario + 20.000 kasus acak)
node   tests/test_nlp.js test     # 10 intent inti (tests/nlp/test_questions.json)
node   tests/test_nlp.js extended # 17 intent pengetahuan/analisis (uji regresi)
python tests/test_e2e.py          # uji fungsional black-box; perlu backend :8000 dan
                                  # web server: python -m http.server 8080
python tests/make_figures.py <folder>   # screenshot Gambar 4.12 + confusion matrix Gambar 4.13
```

Hasil terakhir:
- Backend: lulus.
- Aturan: 72/72 skenario dan 20.000/20.000 kasus acak sesuai.
- NLP: 100/100 untuk intent inti dan 85/85 untuk intent tambahan (keduanya set pengembang).
- Uji fungsional: 16/16 lulus, termasuk membuka halaman dengan klik dua kali (file://) dan backend dari instalasi bersih.

Bukti tersimpan di `tests/e2e/` (`hasil_uji_fungsional.json` + screenshot).

**Catatan NLP:** set uji ditulis oleh pengembang, sebelum kata kunci disusun, dan tidak dipakai untuk penyetelan. Meski begitu, set ini tidak independen dari pengembang. Untuk klaim di disertasi, sebaiknya ditambahkan pertanyaan yang ditulis pengguna atau pakar (misalnya pengelola BBI) ke file `tests/nlp/independent_questions.json` dengan format yang sama, lalu jalankan `node tests/test_nlp.js independent`.
