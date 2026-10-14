# Catatan Perubahan — Perapian Prototipe (13 Oktober 2026)

Basis perubahan: paket `dss_sim_build` (v41/v42). Logika assessment dan aturan keputusan Tabel 3.11 **tidak diubah**.

## Perbaikan bug

1. **Prediksi di website tidak sama dengan model (penting).**
   - Fitur `day_index` saat pelatihan = hari sejak data pertama periode kolam (0–14). Backend lama menghitungnya dari data pertama sequence yang dikirim (96 data), sehingga nilainya selalu 0–1.
   - Akibatnya prediksi di website menyimpang dari prediksi model: rata-rata 0,18 mg/L, maksimum 0,53 mg/L (60 titik uji).
   - Perbaikan: frontend mengirim `period_start` (data pertama kolam), dan backend memakainya untuk `day_index`.
   - Hasil: selisih ≤ 0,0005 mg/L, yang hanya berasal dari pembulatan (`tests/test_backend.py`).
2. **Label kartu parameter.** Skor 2 sebelumnya tampil "Risiko" berwarna merah. Sekarang mengikuti Tabel 3.4: Optimal / Dapat diterima / Tidak sesuai.
3. **Nama kolam berbahasa Indonesia.** Nama dari Firebase atau CSV seperti "Lele", "Gurame", dan "Nila" kini dikenali (sebelumnya hanya nama Inggris).
4. **Payload prediksi.** Frontend tidak lagi mengirim 20-an fitur assessment kumulatif yang diabaikan backend. Sekarang hanya data mentah ditambah `period_start`, karena backend menghitung ulang ke-122 fitur.

## NLP explanation

- Logika intent dipindah ke `nlp.js` (satu sumber untuk browser dan tes).
- **10 intent kini sesuai subbab 4.8:** current_condition, risk_reason, do_forecast, recommended_action, limiting_parameter, assessment_score, do_stability, excursion_duration, dss_value, condition_summary. Intent `condition_summary` sebelumnya belum ada. `greeting` dipertahankan sebagai sapaan dan tidak dihitung dalam evaluasi.
- **Cara pencocokan:** sekarang berbasis batas kata, bukan potongan string (sebelumnya "nilai" ikut cocok dengan "menilai"). Kata kunci bisa berupa frasa atau awalan, berbobot, dan bisa menangani akhiran -nya/-kah/-lah.
- **Kosakata baru:** bahasa sehari-hari seperti gimana, bakal, naikin, paling jelek, sering drop.
- **Kerancuan parameter pembatas vs alasan risiko** (1 kesalahan di 4.8) ditangani dengan bobot kata "parameter/pembatas/variabel".
- **Jawaban:** jawaban baru untuk ringkasan kondisi. Jawaban "parameter pembatas" kini dihitung dari data kolam aktif (sebelumnya selalu menyatakan "pH stabil, DO paling penting"). Jawaban stabilitas menyebut jumlah data yang dipakai.
- **Evaluasi:** set pengembangan dan set uji dipisah (`tests/nlp/`).
  - Detektor baru: 100/100 pada set uji.
  - Detektor lama pada set uji yang sama: 57/100.

### Perluasan chatbot (pertanyaan di luar pembacaan angka sistem)

- **17 intent baru:**
  - 12 intent pengetahuan, dengan jawaban berbasis literatur disertasi: Boyd & Tucker 1998, Timmons & Ebeling 2022, Colt 2006.
  - 5 intent analisis yang dihitung dari riwayat data: jam DO terendah, tren 2 jam, perbandingan kolam, DO min/maks, excursion terakhir.
- **Mekanisme:** pola gabungan, misalnya ("apa itu" ATAU "arti") DAN ("excursion" ATAU "cv"). Pertanyaan definisi tidak lagi tertukar dengan intent inti.
- **Tombol baru:** baris kedua "Pertanyaan pengetahuan dan analisis" di halaman.
- **Akurasi model di jawaban:** `/health` dibaca saat endpoint diterapkan, sehingga jawaban "seberapa akurat prediksi" memuat RMSE model yang terpasang.
- **Uji regresi:** `tests/nlp/extended_questions.json` (85 pertanyaan) tidak independen. Set intent inti dipakai lagi sebagai uji regresi setelah perluasan; ada 2 pola yang diperbaiki berdasarkan hasilnya. Karena itu, angka akurasi untuk disertasi harus berasal dari pertanyaan independen.

## Backend

- `lstm_api.py` ditulis ulang dari 1.142 baris menjadi 278 baris. Hanya desain final yang dipertahankan: 122 fitur, window 24, target tanpa scaling.
- Yang dihapus:
  - jalur lama 3/9/19 fitur dan logika `scaler_y`;
  - alias fitur;
  - endpoint `/live/latest`, yang mengembalikan data sinus **sintetis** sehingga berisiko dikira data sensor;
  - endpoint `/live/add`.
- Rekayasa fitur tidak diubah. Ke-122 fitur identik dengan dataset pelatihan pada 5.376 baris.
- `/health` kini menampilkan sumber model, seed, dan metrik uji model yang terpasang. `/predict/sample` memakai data Gurame asli.

## Paket

- **Dihapus:**
  - `venv/` (±1,6 GB, berisi biner macOS);
  - `__MACOSX/`, `.DS_Store`, `__pycache__/`;
  - `_archive_previous_version/`;
  - template metadata lama;
  - `colab_export_cell.py` (digantikan notebook ekspor).
- **Digabung:** 13 catatan `.md` yang saling menggantikan disatukan ke `README.md`.
- **Ditambahkan:**
  - `training/`: notebook ekspor, `feature_groups.json`, dataset fitur pelatihan;
  - `tests/`;
  - `firmware/` (sketch ESP32 ditandai sebagai TEMPLATE).
