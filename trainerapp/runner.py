"""Operador del escenario: destinos y acciones cerrados, sin parámetros de red externos."""
import asyncio
import os
from pathlib import Path
import socket
import struct
import subprocess

import httpx
from asyncua import Client, ua
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from pymodbus.client import ModbusTcpClient

app = FastAPI(title="Operador didáctico de protocolos OT")
PLANT = "plant"
LAB_TOKEN = os.getenv("LAB_TOKEN", "edu-lab-only")


class Manual(BaseModel):
    value: int


def require_token(request: Request):
    if request.headers.get("x-lab-token") != LAB_TOKEN:
        raise HTTPException(403, "El endpoint es solo para la planta didáctica")


async def observe(protocol, detail, severity="info", **fields):
    record = {"protocol": protocol, "source": "operador contenedor", "detail": detail,
              "severity": severity, **fields}
    async with httpx.AsyncClient(timeout=3.0) as client:
        await client.post("http://plant:8000/api/internal/observation", json=record,
                          headers={"x-lab-token": LAB_TOKEN})


def modbus_write(register: int, value: int):
    with ModbusTcpClient(PLANT, port=502, timeout=3) as client:
        if not client.connect():
            raise ConnectionError("La estación Modbus no responde")
        response = client.write_register(register, value, slave=1)
        if response.isError():
            raise ValueError(f"La estación rechazó el FC06: {response}")
        return response


def modbus_read():
    with ModbusTcpClient(PLANT, port=502, timeout=3) as client:
        if not client.connect():
            return
        response = client.read_holding_registers(0, count=7, slave=1)
        if response.isError():
            return


async def baseline():
    while True:
        try:
            await asyncio.to_thread(modbus_read)
        except (OSError, ValueError):
            pass
        await asyncio.sleep(3)


@app.on_event("startup")
async def on_startup():
    app.state.baseline = asyncio.create_task(baseline())


@app.on_event("shutdown")
async def on_shutdown():
    app.state.baseline.cancel()


@app.get("/health")
def health():
    return {"ok": True, "role": "controlled_traffic_generator"}


@app.post("/manual/{component}")
async def manual(component: str, body: Manual, request: Request):
    require_token(request)
    registers = {"pump": (1, 0, 1), "speed": (2, 0, 60)}
    if component not in registers:
        raise HTTPException(400, "Solo bomba o velocidad")
    register, min_value, max_value = registers[component]
    if not min_value <= body.value <= max_value:
        raise HTTPException(400, "Fuera de intervalo nominal")
    await asyncio.to_thread(modbus_write, register, body.value)
    return {"ok": True, "message": f"Comando Modbus FC06 aplicado: {component}={body.value}."}


@app.post("/action/{name}")
async def action(name: str, request: Request):
    require_token(request)
    if name == "modbus-write":
        await asyncio.to_thread(modbus_write, 2, 85)
        return {"ok": True, "message": "FC06 auténtico: velocidad alterada a 85 Hz; inspecciona la alarma de proceso."}
    if name == "opcua-write":
        async with Client(url="opc.tcp://plant:4840/ot-lab/", timeout=5) as client:
            idx = await client.get_namespace_index("urn:ot-ics-labs:planta")
            node = await client.nodes.objects.get_child([f"{idx}:Planta", f"{idx}:SpeedSetpoint"])
            await node.write_value(75, ua.VariantType.Int64)
        await observe("OPC UA", "Cliente OPC UA real escribió el nodo Planta/SpeedSetpoint=75; endpoint de ensayo NoSecurity", "warning")
        return {"ok": True, "message": "OPC UA Write auténtico: nodo de velocidad = 75 Hz."}
    if name == "dnp3-signal":
        def run_master():
            result = subprocess.run(["python", str(Path(__file__).parents[1] / "dnp3" / "native_master.py"),
                                     "signal", "0"], capture_output=True, text=True, timeout=16, check=False)
            if result.returncode:
                raise RuntimeError((result.stderr or result.stdout or "DNP3 no confirmó comando")[-500:])
            return result.stdout[-500:]
        output = await asyncio.to_thread(run_master)
        await observe("DNP3", f"Maestro DNP3 → outstation, salida analógica índice 0 = señal roja; {output.strip()}", "high")
        return {"ok": True, "message": "Control DNP3 real: semáforo físico simulado en rojo."}
    if name == "intercept":
        # No escucha ni altera terceros. Provee proxy didáctico explícito de UNA trama
        # Modbus FC06 de valor nominal (45) hacia el único destino fijo `plant`.
        before = struct.pack(">HHHBBHH", 17, 0, 6, 1, 6, 2, 45)
        after = before[:-2] + struct.pack(">H", 90)
        def relay():
            with socket.create_connection((PLANT, 502), timeout=3) as conn:
                conn.sendall(after)
                response = conn.recv(12)
                if response != after:
                    raise ValueError(f"Respuesta Modbus no confirmó la trama: {response.hex()}")
        await asyncio.to_thread(relay)
        await observe("Modbus/TCP relay", "Proxy didáctico: PDU FC06 alterada 45→90 Hz, destino fijo plant:502; NO MITM transparente",
                      "high", frame_before=before.hex(" ").upper(), frame_after=after.hex(" ").upper())
        return {"ok": True, "message": "Proxy local cambió una trama Modbus real de 45 a 90 Hz; compara los bytes MBAP/PDU."}
    raise HTTPException(404, "Escenario no previsto")
