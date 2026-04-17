"""
CMI Command Center · Piramid Solutions — Backend (v14.3)
- /api/config        Runtime config for frontend (MQTT broker creds)
- /api/health        Health check
- /api/history       Fictitious 24h history per worker (stable seed)
- /api/analytics/report  Gemini HSE report (Spanish) — uses EMERGENT_LLM_KEY
"""
import asyncio
import hashlib
import math
import os
import uuid
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from emergentintegrations.llm.chat import LlmChat, UserMessage
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

load_dotenv()

app = FastAPI(title="CMI Backend", version="14.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------------------------------------------------------- config --
@app.get("/api/")
def root() -> dict[str, Any]:
    return {"ok": True, "service": "cmi-backend", "version": "14.3.0"}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
def config() -> dict[str, str]:
    return {
        "mqttUrl": os.environ.get("MQTT_URL", ""),
        "mqttUser": os.environ.get("MQTT_USER", ""),
        "mqttPass": os.environ.get("MQTT_PASS", ""),
    }


# ----------------------------------------------------------------- history --
@app.get("/api/history/{helmet_id}")
def history(helmet_id: str, hours: int = 24) -> dict[str, Any]:
    """
    Generate a stable 24h synthetic history for a given helmet_id
    (deterministic, so reloads show same values; looks real for demos).
    """
    seed = int(hashlib.md5(helmet_id.encode()).hexdigest()[:8], 16)
    points = min(max(hours, 1), 48) * 6  # 10-min granularity
    series_bat, series_acc, series_pit, series_act = [], [], [], []
    activities = ["caminando", "conduciendo", "quieto"]
    bat = 100.0
    for i in range(points):
        bat = max(5.0, bat - (0.06 + (seed % 7) * 0.01) - (0.4 if i > points * .8 else 0))
        acc = 9.6 + math.sin((i + seed) * 0.35) * 1.4 + ((seed >> 4) % 5) * 0.05
        pit = 160.0 + math.sin((i + seed) * 0.22) * 12
        act_idx = (i + seed) % 7
        act = activities[0] if act_idx < 3 else activities[1] if act_idx < 5 else activities[2]
        ts = i * 600  # seconds offset from 24h ago
        series_bat.append({"t": ts, "v": round(bat, 1)})
        series_acc.append({"t": ts, "v": round(acc, 2)})
        series_pit.append({"t": ts, "v": round(pit, 1)})
        series_act.append({"t": ts, "v": act})

    incidents = []
    for j in range(1 + seed % 3):
        incidents.append(
            {
                "t": ((seed * (j + 1)) % points) * 600,
                "type": ["Geofence breach", "Man-down", "Batería baja"][(seed + j) % 3],
                "zone": ["Z1", "Z2", "Z3", "Z4"][(seed + j) % 4],
            }
        )
    return {
        "helmet_id": helmet_id,
        "range_hours": hours,
        "granularity_sec": 600,
        "battery": series_bat,
        "accel": series_acc,
        "pitch": series_pit,
        "activity": series_act,
        "incidents": incidents,
        "summary": {
            "battery_avg": round(sum(p["v"] for p in series_bat) / len(series_bat), 1),
            "battery_min": min(p["v"] for p in series_bat),
            "walking_pct": round(100 * sum(1 for a in series_act if a["v"] == "caminando") / len(series_act), 1),
            "driving_pct": round(100 * sum(1 for a in series_act if a["v"] == "conduciendo") / len(series_act), 1),
            "still_pct": round(100 * sum(1 for a in series_act if a["v"] == "quieto") / len(series_act), 1),
            "incidents_count": len(incidents),
        },
    }


# ----------------------------------------------------------------- Gemini HSE --
class AnalyticsInput(BaseModel):
    fleet: list[dict[str, Any]] = Field(default_factory=list)
    incidents: list[dict[str, Any]] = Field(default_factory=list)
    exposure: list[dict[str, Any]] = Field(default_factory=list)
    period: str = "turno actual"


SYSTEM_PROMPT_HSE = """Eres un experto senior en HSE (Salud, Seguridad y Medio Ambiente) de la minería chilena.
Conoces el DS594 MINSAL (exposición térmica y ambiental), la Ley 16.744, y las mejores prácticas de ICMM y el Consejo Minero.
Tu tarea: generar reportes HSE accionables, concisos y en español, con recomendaciones priorizadas.

FORMATO (markdown estricto):
# Reporte HSE · {periodo}
## 1. Resumen ejecutivo (3 líneas máximo)
## 2. Indicadores clave
(tabla con valores numéricos)
## 3. Incidentes y hallazgos
(lista priorizada: Alta/Media/Baja)
## 4. Exposición DS594
(trabajadores sobre 80% del umbral)
## 5. Recomendaciones accionables
(5 bullets numerados, cada uno con responsable sugerido y plazo)
## 6. Score HSE
(número 0-100 con justificación breve)

Sé específico con nombres de trabajadores e IDs de casco cuando estén en los datos.
Nunca inventes datos que no estén en la entrada. Usa lenguaje técnico pero claro."""


@app.post("/api/analytics/report")
async def analytics_report(payload: AnalyticsInput) -> dict[str, Any]:
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY no configurada")

    session_id = f"hse-{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=SYSTEM_PROMPT_HSE,
    ).with_model("gemini", "gemini-2.5-flash")

    prompt = (
        f"Genera un reporte HSE para el período: **{payload.period}**.\n\n"
        f"Datos de flota (JSON):\n```json\n{payload.fleet}\n```\n\n"
        f"Incidentes registrados (JSON):\n```json\n{payload.incidents}\n```\n\n"
        f"Exposición DS594 por trabajador (horas):\n```json\n{payload.exposure}\n```\n\n"
        "Genera el reporte en markdown siguiendo exactamente el formato definido."
    )

    try:
        response = await asyncio.wait_for(
            chat.send_message(UserMessage(text=prompt)),
            timeout=50,
        )
    except asyncio.TimeoutError as err:
        raise HTTPException(status_code=504, detail="Gemini timeout") from err
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini error: {err}") from err

    return {
        "report": response,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": "gemini-2.5-flash",
        "session_id": session_id,
    }
