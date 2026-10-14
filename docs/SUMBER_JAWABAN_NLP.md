# Sumber Jawaban Chatbot (intent pengetahuan)

Jawaban pengetahuan ditulis oleh pengembang dan **belum diperiksa per halaman** terhadap sumbernya. Sebelum dikutip di disertasi atau dipakai dalam demonstrasi, setiap baris perlu dicek dan diberi nomor halaman. Kolom "Status" berisi penilaian pengembang, bukan verifikasi pakar.

| Intent | Klaim utama | Sumber | Status |
|---|---|---|---|
| know_do | DO = oksigen terlarut (mg/L); sumber oksigen: fotosintesis, difusi, aerasi; konsumen oksigen: respirasi ikan, plankton, bakteri | Boyd & Tucker (1998); Timmons & Ebeling (2022) | Klaim umum dalam buku teks. Perlu nomor halaman |
| know_diurnal | DO naik siang hari karena fotosintesis, turun malam, minimum menjelang pagi | Boyd & Tucker (1998) | Perlu nomor halaman. Jam terendah dihitung dari data |
| know_temp_do | Oksigen jenuh ±8,3 mg/L pada 25 °C dan ±7,6 mg/L pada 30 °C (air tawar, permukaan laut) | Tabel kelarutan USGS DOTABLES / YSI | Angka sesuai tabel kelarutan standar. **Belum ada di daftar pustaka disertasi**: tambahkan jika dikutip |
| know_ph | pH berfluktuasi harian karena CO₂ dan fotosintesis; pH tinggi menaikkan fraksi amonia tak terionisasi | Boyd & Tucker (1998); Colt (2006) | Perlu nomor halaman |
| know_ranges | Rentang suhu, pH, dan DO per spesies | Tabel 2.1 disertasi | Diambil langsung dari kode, identik dengan Tabel 2.1 |
| know_status | Aturan Aman/Waspada/Kritis | Tabel 3.4 dan 3.11 disertasi | Sesuai kode (diuji di tests/test_rules.js) |
| know_model | 24 langkah, 122 fitur, horizon 15–60 menit; RMSE model terpasang | Subbab 3.6; model_metadata.json | Sesuai kode |
| know_terms | Definisi skor, excursion, CV | Subbab 3.5.5–3.5.9 | Sesuai kode |
| know_raise_do | Aerasi, kurangi pakan, ganti air sebagian, buang endapan, sesuaikan padat tebar, cegah ledakan plankton | Praktik umum pengelolaan kolam; Boyd & Tucker (1998) | **Perlu ditinjau ko-promotor perikanan** dan disesuaikan dengan SOP BBI Ciganjur |
| know_emergency | Tanda megap-megap; nyalakan aerasi cadangan, hentikan pakan, tambah air segar, ukur DO, lapor petugas | Praktik umum | **Belum ada rujukan pustaka. Wajib ditinjau** ko-promotor atau petugas BBI sebelum demonstrasi |
| know_sensor | Kalibrasi pH dengan buffer, kalibrasi DO galvanik dengan air jenuh udara, cek membran/elektrolit | Wiki DFRobot SEN0237; prosedur kalibrasi subbab 3.4 | Sesuai dokumentasi pabrikan. Rujukan pabrikan belum ada di daftar pustaka |
| know_limits | Batasan data, parameter, ambang, dan cakupan chatbot | Subbab 1.3 dan temuan pengujian | Sesuai disertasi |
