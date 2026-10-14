"""Membuat gambar untuk disertasi: screenshot prototipe (Gambar 4.12) dan confusion matrix NLP (Gambar 4.13).
Prasyarat: backend :8000 dan web server :8080 berjalan (lihat README).
python tests/make_figures.py <folder_keluaran> [set_nlp]"""
import sys, json, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
NLP_SET = sys.argv[2] if len(sys.argv) > 2 else "test"

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
    pg.goto("http://127.0.0.1:8080/index_id.html"); pg.wait_for_selector("#mainStatus")
    pg.select_option("#pondSelect", "Gourami")
    pg.click("#settingsBtn"); pg.fill("#lstmUrl", "http://127.0.0.1:8000/predict"); pg.click("#applyModelBtn"); pg.click("#closeSettingsBtn")
    for _ in range(120):
        if pg.text_content("#forecast60").strip() not in ("-", ""): break
        time.sleep(0.5)
    time.sleep(1)
    pg.screenshot(path=str(OUT / "Gambar_4_12_tampilan_keseluruhan.png"), full_page=True)
    for q in ["Mengapa status kolam berisiko?", "Jam berapa DO paling rendah?"]:
        pg.fill("#assistantInput", q); pg.click("#assistantAskBtn"); time.sleep(0.8)
    chat = pg.locator("#assistantMessages").locator("xpath=ancestor::section[1]")
    (chat if chat.count() else pg.locator("#assistantMessages")).screenshot(path=str(OUT / "Gambar_4_12b_chatbot_nlp.png"))
    b.close()

import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt; import numpy as np
res = json.loads((ROOT / "tests" / "nlp" / f"result_{NLP_SET}.json").read_text())
labels = [k for k in res["confusion"]]
cols = labels + (["unknown"] if any(res["confusion"][r].get("unknown", 0) for r in labels) else [])
M = np.array([[res["confusion"][r].get(c, 0) for c in cols] for r in labels])
names = {"current_condition": "Kondisi saat ini", "risk_reason": "Alasan risiko", "do_forecast": "Prediksi DO", "recommended_action": "Rekomendasi",
         "limiting_parameter": "Parameter pembatas", "assessment_score": "Skor kesesuaian", "do_stability": "Stabilitas DO",
         "excursion_duration": "Durasi excursion", "dss_value": "Nilai DSS", "condition_summary": "Ringkasan kondisi", "unknown": "Tidak dikenali"}
fig, ax = plt.subplots(figsize=(9, 7.5), dpi=200)
ax.imshow(M, cmap="Blues")
ax.set_xticks(range(len(cols)), [names.get(c, c) for c in cols], rotation=45, ha="right", fontsize=9)
ax.set_yticks(range(len(labels)), [names.get(c, c) for c in labels], fontsize=9)
for i in range(M.shape[0]):
    for j in range(M.shape[1]):
        if M[i, j]: ax.text(j, i, M[i, j], ha="center", va="center", fontsize=9, color="white" if M[i, j] > M.max() / 2 else "black")
ax.set_xlabel("Intent hasil sistem"); ax.set_ylabel("Intent acuan (label)")
ax.set_title(f"Confusion matrix pengenalan intent ({res['correct']}/{res['n']} benar, set '{NLP_SET}')", fontsize=10)
fig.tight_layout(); fig.savefig(OUT / f"Gambar_4_13_confusion_matrix_{NLP_SET}.png"); print("selesai:", sorted(x.name for x in OUT.iterdir()))
