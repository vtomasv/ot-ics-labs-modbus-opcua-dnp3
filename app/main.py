"""API de la planta virtual: sin destinos configurables, restringida a un laboratorio aislado."""
from contextlib import asynccontextmanager
import asyncio
import json
import os
from pathlib import Path
import time

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .core import plant
from .capture import PORTS, current_capture, read_packets
from .labs import LABS, ACTIONS, INJECTIONS, get_lab
from .protocols import LabContext, run_protocols

static = Path(__file__).parent / "static"
context = LabContext()
protocol_tasks = []
SURICATA_EVE = Path(os.getenv("SURICATA_EVE", "/suricata/eve.json"))
TRAINER_URL = "http://trainer:8100"
LAB_TOKEN = os.getenv("LAB_TOKEN", "edu-lab-only")
last_injection: dict[str, float] = {}
injection_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    protocol_tasks.extend([asyncio.create_task(run_protocols(context)), asyncio.create_task(plant.tick())])
    plant.emit("Sistema", "Planta virtual", "Gemelo digital operativo: Modbus 502, OPC UA 4840, DNP3 20000")
    try:
        yield
    finally:
        for task in protocol_tasks:
            task.cancel()
        await asyncio.gather(*protocol_tasks, return_exceptions=True)


app = FastAPI(title="OT/ICS Labs — planta simulada", lifespan=lifespan)


class Command(BaseModel):
    source: str
    component: str
    value: int


class Observation(BaseModel):
    protocol: str
    source: str
    detail: str
    severity: str = "info"
    frame_before: str | None = None
    frame_after: str | None = None


class Injection(BaseModel):
    protocol: str
    operation: str
    value: int | None = None


@app.get("/api/health")
def health():
    return {"ok": True, "protocols": {"modbus": 502, "opcua": 4840, "dnp3": 20000},
            "mode": "SIMULATED_LAB_ONLY"}


@app.get("/api/state")
def state():
    return plant.snapshot()


@app.get("/api/internal/state")
def dnp_state(request: Request):
    if not request.client or request.client.host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "Solo outstation local")
    return plant.snapshot()


@app.get("/api/events")
def events():
    return {"events": list(plant.events)[:100]}


@app.get("/api/traffic")
def traffic():
    return {"traffic": list(plant.traffic)[:100], "source": "Eventos de aplicación, NO paquetes capturados"}


@app.get('/api/labs')
def labs():
    return {'labs': [{'id': lab_id, 'number': item['number'], 'title': item['title'],
                      'protocol': item['protocol'], 'duration': item['duration']}
                     for lab_id in LABS if (item := get_lab(lab_id)) is not None]}


@app.get('/api/labs/{lab_id}')
def lab(lab_id: str):
    item = get_lab(lab_id)
    if item is None:
        raise HTTPException(404, 'Laboratorio no disponible')
    return item


@app.get('/api/packets')
def packets(protocol: str | None = None, limit: int = 80):
    if protocol is not None and protocol not in PORTS.values():
        raise HTTPException(400, 'Protocolo fuera de lista blanca')
    return read_packets(max(1, min(limit, 100)), protocol)


@app.get('/api/capture/download')
def download_capture():
    path = current_capture()
    if path is None:
        raise HTTPException(503, 'Sensor aún no generó captura')
    return FileResponse(path, media_type='application/vnd.tcpdump.pcap',
                        filename='ot-ics-ultimo-segmento.pcap')


@app.get("/api/alerts")
def alerts():
    correlated = list(plant.alerts)
    if SURICATA_EVE.is_file():
        try:
            # Logs didácticos pequeños; no sigue ficheros arbitrarios configurados por navegador.
            with SURICATA_EVE.open("rb") as file:
                file.seek(max(0, file.seek(0, 2) - 350_000))
                for line in file.read().splitlines()[-200:]:
                    try:
                        obj = json.loads(line)
                    except ValueError:
                        continue
                    if obj.get("event_type") == "alert":
                        correlated.append({"ts": obj.get("timestamp"),
                                           "signature": obj.get("alert", {}).get("signature", "Firma Suricata"),
                                           "src_ip": obj.get("src_ip", "?"),
                                           "protocol": obj.get("app_proto", "tcp"),
                                           "engine": "Suricata"})
        except OSError:
            pass
    return {"alerts": sorted(correlated, key=lambda item: item.get("ts") or "", reverse=True)[:100]}


@app.post("/api/internal/command")
def dnp_command(command: Command, request: Request):
    # El outstation DNP3 comparte espacio de red con la planta y llama por loopback.
    if not request.client or request.client.host not in ("127.0.0.1", "::1"):
        raise HTTPException(403, "Solo outstation local")
    if command.source != "dnp3" or command.component != "signal":
        raise HTTPException(400, "Comando DNP3 no disponible")
    return {"ok": plant.command("DNP3", "signal", command.value)}


@app.post("/api/internal/observation")
def observe(event: Observation, request: Request):
    if request.headers.get("x-lab-token") != LAB_TOKEN:
        raise HTTPException(403, "Origen no autorizado")
    fields = event.model_dump(exclude_none=True)
    plant.emit(fields.pop("protocol"), fields.pop("source"), fields.pop("detail"),
               fields.pop("severity"), **fields)
    return {"ok": True}


SCENARIOS = {"modbus-write", "opcua-write", "dnp3-signal", "intercept", "reset"}


class ManualValue(BaseModel):
    value: int


@app.post("/api/manual/{component}")
async def manual(component: str, body: ManualValue):
    allowed = {"pump": (0, 1), "speed": (0, 60)}
    if component not in allowed or not allowed[component][0] <= body.value <= allowed[component][1]:
        raise HTTPException(400, "Comando fuera de intervalo autorizado")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.post(f"{TRAINER_URL}/manual/{component}",
                                         json={"value": body.value}, headers={"x-lab-token": LAB_TOKEN})
            response.raise_for_status()
            return response.json()
    except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as exc:
        raise HTTPException(503, f"No se pudo enviar el FC06: {exc}") from exc


@app.post("/api/scenario/{name}")
async def scenario(name: str):
    if name not in SCENARIOS:
        raise HTTPException(404, "Escenario no disponible")
    if name == "reset":
        plant.reset()
        context.refresh()
        return {"ok": True, "message": "Planta didáctica restablecida a línea base."}
    try:
        async with httpx.AsyncClient(timeout=19.0) as client:
            response = await client.post(f"{TRAINER_URL}/action/{name}", headers={"x-lab-token": LAB_TOKEN})
            response.raise_for_status()
            result = response.json()
    except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as exc:
        raise HTTPException(503, f"El operador del laboratorio no completó el escenario: {exc}") from exc
    return result


@app.post('/api/labs/{lab_id}/action/{name}')
async def lab_action(lab_id: str, name: str):
    if lab_id not in ACTIONS or name not in ACTIONS[lab_id]:
        raise HTTPException(404, 'Acción no disponible en este laboratorio')
    return await scenario(name)


@app.post('/api/labs/{lab_id}/inject')
async def lab_inject(lab_id: str, body: Injection):
    if lab_id not in INJECTIONS or (body.protocol, body.operation) != INJECTIONS[lab_id]:
        raise HTTPException(400, 'Inyección no autorizada para este laboratorio')
    if body.operation == 'read' and body.value is not None:
        raise HTTPException(400, 'FC03 no admite un valor de escritura')
    if body.operation == 'write' and (body.value is None or not 30 <= body.value <= 95):
        raise HTTPException(400, 'Valor fuera del intervalo didáctico 30..95')
    if body.operation == 'signal' and body.value not in (0, 1, 2):
        raise HTTPException(400, 'La salida simulada solo acepta 0, 1 o 2')
    async with injection_lock:
        now = time.monotonic()
        if now - last_injection.get(lab_id, 0) < 1.5:
            raise HTTPException(429, 'Espere 1,5 s entre comandos de práctica')
        last_injection[lab_id] = now
    try:
        async with httpx.AsyncClient(timeout=19.0) as client:
            response = await client.post(f'{TRAINER_URL}/inject', json=body.model_dump(),
                                         headers={'x-lab-token': LAB_TOKEN})
            response.raise_for_status()
            return response.json()
    except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as exc:
        raise HTTPException(503, f'Transacción OT no confirmada: {exc}') from exc


@app.get('/labs/{lab_id}')
def lab_page(lab_id: str):
    if lab_id not in LABS:
        raise HTTPException(404, 'Laboratorio no disponible')
    return FileResponse(static / 'index.html')


@app.get('/docs/labs/{lab_id}.md')
def lab_guide(lab_id: str):
    if lab_id not in LABS:
        raise HTTPException(404, 'Guía no disponible')
    path = Path(__file__).parent.parent / 'docs' / 'labs' / f'{lab_id}.md'
    if not path.is_file():
        raise HTTPException(404, 'Guía no disponible')
    return FileResponse(path, media_type='text/markdown; charset=utf-8')


@app.get("/")
def home():
    return FileResponse(static / "index.html")


app.mount("/", StaticFiles(directory=static, html=True), name="static")
