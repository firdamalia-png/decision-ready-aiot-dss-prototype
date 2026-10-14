"""Uji backend: (1) 122 fitur backend == dataset pelatihan untuk seluruh 5.376 baris;
(2) prediksi lewat /predict (96 data mentah + period_start) == prediksi model pada fitur pelatihan.
Jalankan dari folder dss_prototype:  python tests/test_backend.py"""
import sys, json
from pathlib import Path
import numpy as np, pandas as pd
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
import lstm_api as api
from fastapi.testclient import TestClient

train = pd.read_csv(ROOT / "training" / "processed_iot_dataset_with_features.csv", parse_dates=["timestamp"])
F = api.METADATA["features"]
worst, nan_mismatch = 0.0, 0
for pond, g in train.groupby("pond"):
    g = g.sort_values("timestamp").reset_index(drop=True)
    feats = api.build_features(g[["timestamp", "temp", "ph", "do"]], pond, g["timestamp"].iloc[0])
    a, b = feats[F].to_numpy(float), g[F].to_numpy(float)
    nan_mismatch += int((np.isnan(a) != np.isnan(b)).sum())
    worst = max(worst, float(np.nanmax(np.abs(a - b))))
print(f"[1] Fitur backend vs dataset pelatihan: {len(train)} baris x {len(F)} fitur, maks |selisih| = {worst:.2e}, beda pola NaN = {nan_mismatch}")
assert worst < 1e-9 and nan_mismatch == 0

client = TestClient(api.app)
rng = np.random.default_rng(0); diffs = []
for pond, g in train.groupby("pond"):
    g = g.sort_values("timestamp").reset_index(drop=True)
    for end in rng.choice(np.arange(120, len(g) - 4), 10, replace=False):
        seq = g.iloc[end - 95:end + 1]
        body = {"pond": pond, "period_start": g["timestamp"].iloc[0].isoformat(),
                "sequence": [{"timestamp": t.isoformat(), "temp": a, "ph": b, "do": c} for t, a, b, c in zip(seq.timestamp, seq.temp, seq.ph, seq["do"])]}
        r = client.post("/predict", json=body); assert r.status_code == 200, r.text
        got = np.array([p["do"] for p in r.json()["predictions"]])
        x = api.SCALER_X.transform(g.loc[end - 23:end, F].to_numpy(float)).reshape(1, 24, len(F))
        ref = api.MODEL.predict(x, verbose=0).reshape(-1)
        diffs.append(np.abs(got - ref).max())
print(f"[2] /predict vs model pada fitur pelatihan: {len(diffs)} titik uji, maks |selisih| = {max(diffs):.4f} mg/L (pembulatan 3 desimal)")
assert max(diffs) < 1e-3
r = client.get("/health").json(); assert r["model_loaded"] and r["feature_count"] == 122 and r["window_size"] == 24
print("[3] /health OK:", {k: r[k] for k in ["model_loaded", "window_size", "feature_count", "export_seed"]})
print("SEMUA UJI BACKEND LULUS")
