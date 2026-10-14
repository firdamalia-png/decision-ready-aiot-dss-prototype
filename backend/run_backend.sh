#!/usr/bin/env bash
# Menjalankan backend prediksi DO di http://127.0.0.1:8000
cd "$(dirname "$0")"
python3 -m pip install -r requirements.txt
python3 -m uvicorn lstm_api:app --host 127.0.0.1 --port 8000
