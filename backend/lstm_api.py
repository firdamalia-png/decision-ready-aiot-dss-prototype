"""
Backend prediksi DO untuk prototipe DSS Decision-Ready AIoT.

Model  : Full Assessment-Guided Multi-Horizon LSTM (122 fitur, window 24 langkah = 6 jam,
         horizon 15/30/45/60 menit, target DO dalam mg/L tanpa scaling).
Sumber : training/DSS_Final_Model_Export.ipynb (konfigurasi sama dengan skenario
         Full_Assessment_Guided_LSTM pada Revised_Design_Experiment.ipynb).

File yang wajib ada di folder ini:
    model_lstm_do.keras, scaler_x.pkl, model_metadata.json

Rekayasa fitur di `build_features()` identik dengan dataset pelatihan
(processed_iot_dataset_with_features.csv): diuji ulang pada 5.376 baris x 122 fitur,
lihat tests/test_backend.py.

Catatan day_index: fitur ini = jumlah hari sejak observasi PERTAMA periode pemantauan kolam.
Frontend wajib mengirim `period_start`; tanpa itu backend memakai awal sequence yang dikirim
dan menandai respons dengan `day_index_reference = "sequence_start"` (prediksi akan menyimpang
dari model yang dilatih).

Jalankan:  uvicorn lstm_api:app --host 127.0.0.1 --port 8000
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

try:
    from tensorflow.keras.models import load_model
    TF_ERROR = None
except Exception as exc:  # pragma: no cover
    load_model = None
    TF_ERROR = repr(exc)

BASE_DIR = Path(__file__).resolve().parent
MODEL_PATH = BASE_DIR / "model_lstm_do.keras"
SCALER_X_PATH = BASE_DIR / "scaler_x.pkl"
METADATA_PATH = BASE_DIR / "model_metadata.json"

WIB = timezone(timedelta(hours=7))
INTERVAL_MINUTES = 15
LAGS = [1, 2, 3, 4, 8, 12, 24]
ROLL_WINDOWS = [4, 8, 24]
POND_COLUMNS = ["pond_Catfish", "pond_Gourami", "pond_Nilem", "pond_Tilapia"]

# Rentang acuan Tabel 2.1 (Opt = optimal, Band = operasional).
THRESHOLDS = {
    "Catfish": {"tempOpt": (25.0, 30.0), "tempBand": (23.0, 32.0), "phOpt": (7.0, 8.5), "phBand": (6.5, 9.0), "doOptMin": 3.0, "doBandMin": 2.0},
    "Gourami": {"tempOpt": (25.0, 30.0), "tempBand": (23.0, 32.0), "phOpt": (6.5, 8.5), "phBand": (6.0, 9.0), "doOptMin": 5.0, "doBandMin": 4.0},
    "Nilem":   {"tempOpt": (26.0, 29.0), "tempBand": (24.0, 31.0), "phOpt": (6.5, 8.0), "phBand": (6.0, 8.5), "doOptMin": 5.0, "doBandMin": 4.0},
    "Tilapia": {"tempOpt": (25.0, 30.0), "tempBand": (23.0, 32.0), "phOpt": (6.5, 8.5), "phBand": (6.0, 9.0), "doOptMin": 5.0, "doBandMin": 4.0},
}
POND_ALIASES = {"catfish": "Catfish", "lele": "Catfish", "gourami": "Gourami", "gurame": "Gourami",
                "nilem": "Nilem", "tilapia": "Tilapia", "nila": "Tilapia"}


# --------------------------------------------------------------------------- artefak model
def _load_artifacts():
    errors = {}
    meta = model = scaler = None
    try:
        meta = json.loads(METADATA_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        errors["metadata"] = repr(exc)
    try:
        scaler = joblib.load(SCALER_X_PATH)
    except Exception as exc:
        errors["scaler_x"] = repr(exc)
    if load_model is None:
        errors["tensorflow"] = TF_ERROR
    else:
        try:
            model = load_model(MODEL_PATH, compile=False)
        except Exception as exc:
            errors["model"] = repr(exc)
    if meta and model is not None:
        feats = meta.get("features", [])
        shape = tuple(model.input_shape[1:])
        if shape != (int(meta.get("window_size", 24)), len(feats)):
            errors["shape"] = f"model input {shape} != metadata ({meta.get('window_size')}, {len(feats)})"
        if meta.get("target_scaling", "none") != "none":
            errors["target_scaling"] = "Backend ini hanya mendukung model dengan target DO tanpa scaling."
    return meta, model, scaler, errors


METADATA, MODEL, SCALER_X, LOAD_ERRORS = _load_artifacts()


def _require_ready():
    if LOAD_ERRORS or MODEL is None or METADATA is None or SCALER_X is None:
        raise HTTPException(status_code=503, detail={"message": "Model belum siap. Periksa /health.", "errors": LOAD_ERRORS})


# --------------------------------------------------------------------------- utilitas
def canonical_pond(value: Optional[str]) -> str:
    key = (value or "").strip().lower()
    for alias, name in POND_ALIASES.items():
        if alias in key:
            return name
    raise HTTPException(status_code=400, detail=f"Kolam tidak dikenal: {value!r}. Gunakan Catfish/Lele, Gourami/Gurame, Tilapia/Nila, atau Nilem.")


def parse_time(text: str) -> datetime:
    """Waktu lokal (WIB) tanpa zona; zona waktu yang dikirim dikonversi ke WIB lalu dibuang."""
    s = str(text).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        try:
            dt = datetime.strptime(s, "%d/%m/%y %H.%M")
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Format timestamp tidak dikenali: {text!r}")
    if dt.tzinfo is not None:
        dt = dt.astimezone(WIB).replace(tzinfo=None)
    return dt


def score_range(v, opt, band):
    return 3.0 if opt[0] <= v <= opt[1] else (2.0 if band[0] <= v <= band[1] else 1.0)


def score_do(v, opt_min, band_min):
    return 3.0 if v >= opt_min else (2.0 if v >= band_min else 1.0)


# --------------------------------------------------------------------------- rekayasa fitur
def build_features(df: pd.DataFrame, pond: str, period_start: datetime) -> pd.DataFrame:
    """Menghitung 122 fitur untuk satu kolam. df: kolom timestamp, temp, ph, do (urut waktu).
    Semua operasi lag/rolling hanya melihat ke belakang (tanpa informasi masa depan)."""
    thr = THRESHOLDS[pond]
    df = df.copy()
    df["temp_score"] = df["temp"].apply(lambda v: score_range(v, thr["tempOpt"], thr["tempBand"]))
    df["ph_score"] = df["ph"].apply(lambda v: score_range(v, thr["phOpt"], thr["phBand"]))
    df["do_score"] = df["do"].apply(lambda v: score_do(v, thr["doOptMin"], thr["doBandMin"]))
    df["pond_score"] = df[["temp_score", "ph_score", "do_score"]].mean(axis=1)
    ops, opt = thr["doBandMin"], thr["doOptMin"]
    df["do_excursion_flag"] = (df["do"] < ops).astype(int)
    df["do_warning_flag"] = ((df["do"] < opt) & (df["do"] >= ops)).astype(int)
    df["do_gap_ops"] = df["do"] - ops
    df["do_gap_opt"] = df["do"] - opt
    run, durations = 0, []
    for flag in df["do_excursion_flag"].values:
        run = run + 1 if flag == 1 else 0
        durations.append(run)
    df["do_excursion_duration_steps"] = durations
    df["do_excursion_duration_minutes"] = df["do_excursion_duration_steps"] * INTERVAL_MINUTES

    hour = df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60.0
    df["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    df["day_index"] = (df["timestamp"] - pd.Timestamp(period_start)).dt.total_seconds() / 86400.0
    for col in POND_COLUMNS:
        df[col] = int(col == f"pond_{pond}")

    new = {}
    for col in ["temp", "ph", "do"]:
        for lag in LAGS:
            new[f"{col}_lag{lag}"] = df[col].shift(lag)
        for w in ROLL_WINDOWS:
            r = df[col].rolling(w, min_periods=w)
            new[f"{col}_roll_mean{w}"], new[f"{col}_roll_sd{w}"] = r.mean(), r.std()
            new[f"{col}_roll_min{w}"], new[f"{col}_roll_max{w}"] = r.min(), r.max()
            new[f"{col}_roll_cv{w}"] = new[f"{col}_roll_sd{w}"] / new[f"{col}_roll_mean{w}"]
    for col in ["temp_score", "ph_score", "do_score", "pond_score", "do_excursion_flag", "do_warning_flag"]:
        for w in ROLL_WINDOWS:
            r = df[col].rolling(w, min_periods=w)
            new[f"{col}_roll_mean{w}"], new[f"{col}_roll_sum{w}"] = r.mean(), r.sum()
    return pd.concat([df, pd.DataFrame(new, index=df.index)], axis=1)


# --------------------------------------------------------------------------- API
class SensorRow(BaseModel):
    timestamp: str
    temp: float
    ph: float
    do: float
    pond: Optional[str] = None


class PredictRequest(BaseModel):
    pond: str
    sequence: List[SensorRow]
    period_start: Optional[str] = None  # observasi pertama periode pemantauan kolam (untuk day_index)
    horizons: List[int] = [15, 30, 45, 60]


app = FastAPI(title="DSS Kualitas Air Kolam Pembenihan - LSTM API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def model_info():
    if not METADATA:
        return {}
    return {
        "model_variant": METADATA.get("model_variant"),
        "training_scenario": METADATA.get("training_scenario"),
        "source": METADATA.get("source"),
        "export_seed": METADATA.get("export_seed"),
        "window_size": METADATA.get("window_size"),
        "feature_count": len(METADATA.get("features", [])),
        "horizons_minutes": METADATA.get("horizons"),
        "target_scaling": METADATA.get("target_scaling"),
        "test_metrics": METADATA.get("test_metrics"),
    }


@app.get("/health")
def health():
    ready = not LOAD_ERRORS and MODEL is not None
    return {
        "status": "ok" if ready else "error",
        "model_loaded": ready,
        "model_label": "Assessment-Guided LSTM",
        "errors": LOAD_ERRORS,
        "model_input_shape": str(MODEL.input_shape) if MODEL is not None else None,
        "minimum_raw_rows": int((METADATA or {}).get("window_size", 24)) + max(LAGS + ROLL_WINDOWS),
        **model_info(),
    }


@app.post("/predict")
def predict(req: PredictRequest):
    _require_ready()
    pond = canonical_pond(req.pond)
    window = int(METADATA["window_size"])
    features = METADATA["features"]
    rows = [r for r in req.sequence if canonical_pond(r.pond or pond) == pond]
    if not rows:
        raise HTTPException(status_code=400, detail="Sequence kosong untuk kolam ini.")
    df = pd.DataFrame({"timestamp": [parse_time(r.timestamp) for r in rows],
                       "temp": [r.temp for r in rows], "ph": [r.ph for r in rows], "do": [r.do for r in rows]})
    df = df.drop_duplicates("timestamp", keep="last").sort_values("timestamp").reset_index(drop=True)
    if req.period_start:
        start, reference = parse_time(req.period_start), "period_start"
    else:
        start, reference = df["timestamp"].iloc[0], "sequence_start"
    feats = build_features(df, pond, start)
    complete = feats.dropna(subset=features)
    if len(complete) < window:
        raise HTTPException(status_code=400, detail={
            "message": f"Data belum cukup: perlu {window} langkah berfitur lengkap; kirim minimal "
                       f"{window + max(LAGS + ROLL_WINDOWS)} data mentah berurutan untuk kolam ini.",
            "raw_rows_received": len(df), "feature_complete_rows": len(complete)})
    x = complete[features].tail(window).to_numpy(dtype=float)
    x = SCALER_X.transform(x).reshape(1, window, len(features))
    y = MODEL.predict(x, verbose=0).reshape(-1)
    horizon_list = [int(h) for h in METADATA.get("horizons", [15, 30, 45, 60])]
    preds = [{"horizon": h, "do": round(float(v), 3)} for h, v in zip(horizon_list, y) if h in req.horizons]
    return {
        "model_label": "Assessment-Guided LSTM",
        "pond": pond,
        "input_end_timestamp": complete["timestamp"].iloc[-1].isoformat(),
        "day_index_reference": reference,
        "predictions": preds,
    }


@app.get("/predict/sample")
def predict_sample():
    """Uji cepat dengan 48 data terakhir kolam Gurame dari data/iot_data.csv."""
    csv = BASE_DIR.parent / "data" / "iot_data.csv"
    raw = pd.read_csv(csv, sep=";")
    raw = raw[raw["pond"] == "Gourami"]
    seq = raw.tail(48)
    return predict(PredictRequest(
        pond="Gourami",
        period_start=parse_time(raw["timestamp"].iloc[0]).isoformat(),
        sequence=[SensorRow(timestamp=parse_time(t).isoformat(), temp=a, ph=b, do=c, pond="Gourami")
                  for t, a, b, c in zip(seq["timestamp"], seq["temp"], seq["ph"], seq["do"])]))
