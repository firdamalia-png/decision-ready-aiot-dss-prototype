#!/bin/bash
# macOS: klik dua kali file ini untuk menjalankan backend (pertama kali: klik kanan > Open).
cd "$(dirname "$0")"
PYV=$(python3 -c "import sys;print(1 if (3,9)<=sys.version_info[:2]<=(3,13) else 0)" 2>/dev/null)
if [ "$PYV" != "1" ]; then echo "Perlu Python 3.9-3.13 (TensorFlow 2.20). Versi saat ini: $(python3 --version 2>&1)"; read -r; exit 1; fi
if [ ! -d venv ]; then
  echo "Membuat lingkungan Python (venv) dan memasang paket... (hanya sekali, beberapa menit)"
  python3 -m venv venv || { echo "Python 3 tidak ditemukan. Pasang Python 3.9-3.13."; read -r; exit 1; }
  ./venv/bin/pip install --upgrade pip
  ./venv/bin/pip install -r requirements.txt || { echo "Instalasi gagal."; read -r; exit 1; }
fi
echo "Backend berjalan di http://127.0.0.1:8000  (tutup jendela ini untuk menghentikan)"
./venv/bin/python -m uvicorn lstm_api:app --host 127.0.0.1 --port 8000
