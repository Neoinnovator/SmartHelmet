"""
CMI Command Center · Piramid Solutions
Minimal FastAPI backend:
- Serves MQTT credentials from env to the static frontend (/api/config)
- Health check (/api/health)
"""
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

load_dotenv()

app = FastAPI(title="CMI Backend", version="14.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/")
def root():
    return {"ok": True, "service": "cmi-backend", "version": "14.1.0"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    """Returns runtime config for the frontend (MQTT broker credentials)."""
    return {
        "mqttUrl": os.environ.get("MQTT_URL", ""),
        "mqttUser": os.environ.get("MQTT_USER", ""),
        "mqttPass": os.environ.get("MQTT_PASS", ""),
    }
