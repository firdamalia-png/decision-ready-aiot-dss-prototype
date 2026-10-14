@echo off
REM Menjalankan backend prediksi DO di http://127.0.0.1:8000
cd /d %~dp0
python -m pip install -r requirements.txt
python -m uvicorn lstm_api:app --host 127.0.0.1 --port 8000
pause
