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
ACTIVITIES = ("caminando", "conduciendo", "quieto")
INCIDENT_TYPES = ("Geofence breach", "Man-down", "Batería baja")
INCIDENT_ZONES = ("Z1", "Z2", "Z3", "Z4")


def _seed_from(helmet_id: str) -> int:
    """Deterministic non-cryptographic seed from helmet id.

    SHA-256 is used for availability across environments (not for security);
    only 32 bits of the digest are consumed.
    """
    digest = hashlib.sha256(helmet_id.encode()).hexdigest()
    return int(digest[:8], 16)


def _pick_activity(act_idx: int) -> str:
    if act_idx < 3:
        return ACTIVITIES[0]
    if act_idx < 5:
        return ACTIVITIES[1]
    return ACTIVITIES[2]


def _build_series(points: int, seed: int) -> dict[str, list[dict[str, Any]]]:
    series = {"battery": [], "accel": [], "pitch": [], "activity": []}
    bat = 100.0
    drop_step = 0.06 + (seed % 7) * 0.01
    for i in range(points):
        bat = max(5.0, bat - drop_step - (0.4 if i > points * 0.8 else 0))
        acc = 9.6 + math.sin((i + seed) * 0.35) * 1.4 + ((seed >> 4) % 5) * 0.05
        pit = 160.0 + math.sin((i + seed) * 0.22) * 12
        ts = i * 600  # seconds offset from 24h ago
        series["battery"].append({"t": ts, "v": round(bat, 1)})
        series["accel"].append({"t": ts, "v": round(acc, 2)})
        series["pitch"].append({"t": ts, "v": round(pit, 1)})
        series["activity"].append({"t": ts, "v": _pick_activity((i + seed) % 7)})
    return series


def _build_incidents(seed: int, points: int) -> list[dict[str, Any]]:
    return [
        {
            "t": ((seed * (j + 1)) % points) * 600,
            "type": INCIDENT_TYPES[(seed + j) % len(INCIDENT_TYPES)],
            "zone": INCIDENT_ZONES[(seed + j) % len(INCIDENT_ZONES)],
        }
        for j in range(1 + seed % 3)
    ]


def _summarize(series: dict[str, list[dict[str, Any]]], incidents_count: int) -> dict[str, Any]:
    bat = series["battery"]
    act = series["activity"]
    total = len(act) or 1
    pct = lambda name: round(100 * sum(1 for a in act if a["v"] == name) / total, 1)  # noqa: E731
    return {
        "battery_avg": round(sum(p["v"] for p in bat) / len(bat), 1),
        "battery_min": min(p["v"] for p in bat),
        "walking_pct": pct("caminando"),
        "driving_pct": pct("conduciendo"),
        "still_pct": pct("quieto"),
        "incidents_count": incidents_count,
    }


@app.get("/api/history/{helmet_id}")
def history(helmet_id: str, hours: int = 24) -> dict[str, Any]:
    """Synthetic history for a helmet.

    Granularity adapts to range to keep payload size manageable:
      <= 48h  → 10-min steps (144 points)
      <= 168h → 1-hour steps (168 points, 7 días)
      <= 720h → 3-hour steps (240 points, 30 días)
      > 720h  → 6-hour steps (up to 360 points, 90 días)
    """
    hours = max(1, min(hours, 2160))  # cap at 90 days
    seed = _seed_from(helmet_id)
    if hours <= 48:
        step_sec = 600   # 10 min
    elif hours <= 168:
        step_sec = 3600  # 1 h
    elif hours <= 720:
        step_sec = 10800  # 3 h
    else:
        step_sec = 21600  # 6 h
    points = max(1, (hours * 3600) // step_sec)

    series = _build_series(points, seed)
    incidents = _build_incidents(seed, points)
    return {
        "helmet_id": helmet_id,
        "range_hours": hours,
        "granularity_sec": step_sec,
        "point_count": points,
        "battery": series["battery"],
        "accel": series["accel"],
        "pitch": series["pitch"],
        "activity": series["activity"],
        "incidents": incidents,
        "summary": _summarize(series, len(incidents)),
    }


@app.get("/api/fleet-summary")
def fleet_summary(days: int = 90, ids: str = "") -> dict[str, Any]:
    """Lightweight aggregated stats per helmet for the given period.

    Used as compact context for Chat IA. Returns only summaries (no time series).
    `ids` = comma-separated list of helmet IDs. If empty, returns empty.
    """
    days = max(1, min(days, 90))
    hours = days * 24
    step_sec = 21600 if hours > 720 else 10800
    points = max(1, (hours * 3600) // step_sec)

    id_list = [x.strip() for x in ids.split(",") if x.strip()]
    result = []
    for hid in id_list[:25]:
        seed = _seed_from(hid)
        series = _build_series(points, seed)
        incs = _build_incidents(seed, points)
        summ = _summarize(series, len(incs))
        bat = [p["v"] for p in series["battery"]]
        acc = [p["v"] for p in series["accel"]]
        pit = [p["v"] for p in series["pitch"]]
        result.append(
            {
                "helmet_id": hid,
                "days": days,
                "points": points,
                "battery": {
                    "avg": summ["battery_avg"],
                    "min": summ["battery_min"],
                    "max": max(bat),
                },
                "accel": {
                    "avg": round(sum(acc) / len(acc), 2),
                    "min": round(min(acc), 2),
                    "max": round(max(acc), 2),
                },
                "pitch": {
                    "avg": round(sum(pit) / len(pit), 1),
                    "min": round(min(pit), 1),
                    "max": round(max(pit), 1),
                },
                "activity_pct": {
                    "caminando": summ["walking_pct"],
                    "conduciendo": summ["driving_pct"],
                    "quieto": summ["still_pct"],
                },
                "incidents": {
                    "total": len(incs),
                    "by_type": _count_by(incs, "type"),
                    "by_zone": _count_by(incs, "zone"),
                },
            }
        )
    return {"days": days, "helmets": result}


def _count_by(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    out: dict[str, int] = {}
    for it in items:
        k = str(it.get(key, ""))
        out[k] = out.get(k, 0) + 1
    return out


# ----------------------------------------------------------------- Gemini HSE --
class AnalyticsInput(BaseModel):
    fleet: list[dict[str, Any]] = Field(default_factory=list)
    incidents: list[dict[str, Any]] = Field(default_factory=list)
    exposure: list[dict[str, Any]] = Field(default_factory=list)
    period: str = "turno actual"


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatInput(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)  # fleet snapshot


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

    response: str = ""
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


# ----------------------------------------------------------------- Chat IA --
SYSTEM_PROMPT_CHAT = """Eres el Asistente HSE de Piramid CMI Command Center, experto en operación minera y seguridad.
Tienes acceso al estado en tiempo real de la flota (cascos inteligentes) y a un resumen histórico de 90 días por casco.

ESTRUCTURA DEL CONTEXTO:
- `context.fleet`: lista de 20 trabajadores con datos actuales (solo Luis Campusano/CMI-001 tiene `tiempo_real: true`, el resto son datos operativos sintéticos)
- `context.historico_90dias`: resumen agregado de 90 días por casco con avg/min/max de batería/accel/pitch, % de tiempo en cada actividad, incidentes por tipo y por zona
- `context.evac_active`: si hay evacuación activa
- `context.mqtt_live`: si el broker MQTT está conectado

Reglas:
- Responde en español, conciso (3-6 líneas salvo que pidan detalle)
- Usa nombres y IDs de casco (ej. CMI-003) cuando sea relevante
- Si te preguntan tendencias / promedios / histórico → usa los datos de `historico_90dias`
- Si te preguntan ubicación actual → usa `fleet[].gps` / `ubicacion`
- Nunca inventes datos que no estén en el contexto
- Destaca con **negritas** métricas críticas (baterías <30%, incidentes altos, zonas peligrosas)
- Si hay un man-down activo en la flota, menciónalo aunque no se pregunte
- Para recomendaciones, sé específico (responsable + plazo + acción)
- Si se pide comparar trabajadores, usa el resumen histórico para contrastar
"""


@app.post("/api/chat")
async def chat_ia(payload: ChatInput) -> dict[str, Any]:
    """Conversational endpoint with fleet context. Stateless — frontend manages history."""
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY no configurada")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages vacío")

    # Build system message with fleet context inline (deterministic, no DB needed)
    ctx_json = payload.context or {}
    sys_msg = SYSTEM_PROMPT_CHAT + f"\n\n## Estado actual de la flota (JSON)\n```json\n{ctx_json}\n```\n"

    session_id = f"chat-{uuid.uuid4().hex[:8]}"
    chat = LlmChat(
        api_key=api_key,
        session_id=session_id,
        system_message=sys_msg,
    ).with_model("gemini", "gemini-2.5-flash")

    # Replay conversation: send each message in order. Last user message gets the response.
    last_user_text = ""
    for m in payload.messages:
        if m.role == "user":
            last_user_text = m.content
    if not last_user_text:
        raise HTTPException(status_code=400, detail="último mensaje debe ser del usuario")

    response: str = ""
    try:
        response = await asyncio.wait_for(
            chat.send_message(UserMessage(text=last_user_text)),
            timeout=40,
        )
    except asyncio.TimeoutError as err:
        raise HTTPException(status_code=504, detail="Gemini timeout") from err
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini error: {err}") from err

    return {
        "reply": response,
        "model": "gemini-2.5-flash",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


# ----------------------------------------------------------------- Predictive --
@app.post("/api/analytics/predictive")
async def predictive(payload: AnalyticsInput) -> dict[str, Any]:
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY no configurada")

    sys = (
        "Eres analista predictivo HSE. Devuelve SOLO JSON válido (sin markdown, sin texto extra) "
        "con esta estructura exacta:\n"
        '{"forecast_8h":[{"hour":"00:00","risk":0.0}],"peak_hour":"HH:MM","peak_risk":0.0,'
        '"top_worker":{"id":"CMI-XXX","name":"...","reason":"..."},'
        '"confidence":0.85,"patterns":[{"name":"...","impact":"alto|medio|bajo","note":"..."}]}'
        "\nLa lista forecast_8h debe tener 8 entradas (próximas 8 horas). risk es 0-1."
    )

    chat = LlmChat(
        api_key=api_key,
        session_id=f"pred-{uuid.uuid4().hex[:8]}",
        system_message=sys,
    ).with_model("gemini", "gemini-2.5-flash")

    prompt = (
        f"Analiza esta flota minera y predice riesgo de incidentes próximas 8h:\n"
        f"FLOTA:\n{payload.fleet}\n\nINCIDENTES_RECIENTES:\n{payload.incidents}\n"
        f"EXPOSICIÓN:\n{payload.exposure}\n\nResponde SOLO el JSON."
    )

    raw: str = ""
    try:
        raw = await asyncio.wait_for(
            chat.send_message(UserMessage(text=prompt)),
            timeout=40,
        )
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini error: {err}") from err

    import json as _json
    import re as _re
    # Try to extract JSON from response (Gemini sometimes wraps in ```json ... ```)
    text = raw.strip()
    m = _re.search(r"\{.*\}", text, _re.DOTALL)
    try:
        data = _json.loads(m.group(0)) if m else _json.loads(text)
    except Exception:  # noqa: BLE001
        data = {"raw": raw, "error": "JSON parsing failed"}

    return {**data, "model": "gemini-2.5-flash"}


# ----------------------------------------------------------------- Prescriptive --
@app.post("/api/analytics/prescriptive")
async def prescriptive(payload: AnalyticsInput) -> dict[str, Any]:
    api_key = os.getenv("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="EMERGENT_LLM_KEY no configurada")

    sys = (
        "Eres analista prescriptivo HSE minero. Devuelve SOLO JSON válido sin markdown:\n"
        '{"actions":[{"priority":"alta|media|baja","action":"...","responsible":"...","deadline":"..."}]}\n'
        "Genera 5-7 acciones concretas y accionables, ordenadas por prioridad."
    )
    chat = LlmChat(
        api_key=api_key,
        session_id=f"presc-{uuid.uuid4().hex[:8]}",
        system_message=sys,
    ).with_model("gemini", "gemini-2.5-flash")
    prompt = f"Datos:\n{payload.fleet}\nIncidentes:\n{payload.incidents}\nExposición:\n{payload.exposure}\nResponde SOLO JSON."
    raw: str = ""
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=40)
    except Exception as err:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Gemini error: {err}") from err
    import json as _json
    import re as _re
    m = _re.search(r"\{.*\}", raw, _re.DOTALL)
    try:
        data = _json.loads(m.group(0)) if m else {"actions": []}
    except Exception:  # noqa: BLE001
        data = {"actions": [], "raw": raw}
    return {**data, "model": "gemini-2.5-flash"}
