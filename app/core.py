"""Gemelo digital didáctico. Los efectos físicos son una simulación, nunca control de planta real."""
from collections import deque
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import asyncio
import json
import os
from pathlib import Path


def stamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class PlantState:
    tank_level: float = 48.0
    pump_enabled: bool = True
    speed_setpoint: int = 45
    temperature: float = 29.0
    flow: float = 22.5
    traffic_signal: int = 2  # 0 rojo, 1 ámbar, 2 verde
    sign_code: int = 0  # 0 OPERACIÓN, 1 MANTENIMIENTO, 2 DETENER, 3 EVACUAR
    safety_trip: bool = False
    updated_at: str = ""


class DigitalTwin:
    def __init__(self):
        self.state = PlantState(updated_at=stamp())
        self.events = deque(maxlen=240)
        self.traffic = deque(maxlen=240)
        self.alerts = deque(maxlen=120)
        self.lock = asyncio.Lock()
        self.log_path = Path(os.getenv("LAB_LOG_PATH", "/tmp/ot-events.jsonl"))

    def snapshot(self) -> dict:
        return asdict(self.state)

    def emit(self, protocol: str, source: str, detail: str, severity="info", **fields):
        record = {"ts": stamp(), "protocol": protocol, "source": source,
                  "detail": detail, "severity": severity, **fields}
        self.events.appendleft(record)
        if protocol in ("Modbus/TCP", "OPC UA", "DNP3", "Modbus/TCP relay"):
            self.traffic.appendleft({"ts": record["ts"], "protocol": protocol,
                                     "direction": source, "detail": detail})
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass
        return record

    def command(self, source: str, component: str, value: int) -> bool:
        """Valida en el proceso (no en el navegador); devuelve False si rechaza."""
        value = int(value)
        bounds = {"speed": (0, 100), "pump": (0, 1), "signal": (0, 2), "sign": (0, 3)}
        if component not in bounds or not bounds[component][0] <= value <= bounds[component][1]:
            self.emit(source, "RTU", f"Comando rechazado: {component}={value}", "high")
            return False
        if self.state.safety_trip and component == "pump" and value == 1:
            self.emit(source, "RTU", "Arranque rechazado: protección simulada enclavada", "high")
            return False
        name = {"speed": "speed_setpoint", "pump": "pump_enabled",
                "signal": "traffic_signal", "sign": "sign_code"}[component]
        before = getattr(self.state, name)
        setattr(self.state, name, bool(value) if component == "pump" else value)
        if component == "speed":
            if value >= 80:
                self.state.sign_code = 2  # Advertencia visual del proceso, no control remoto de un cartel real.
            elif value <= 60 and self.state.sign_code == 2:
                self.state.sign_code = 0
        self.state.updated_at = stamp()
        critical = (component == "speed" and value >= 80) or (component == "signal" and value == 0) or (component == "sign" and value >= 2)
        detail = f"{component}: {before} → {value} (efecto físico SIMULADO)"
        self.emit(source, "RTU", detail, "high" if critical else "info")
        if critical:
            self.alerts.appendleft({"ts": stamp(), "signature": "OT-ANOMALY cambio de parámetro fuera de línea base",
                                    "src_ip": source, "protocol": source})
        return True

    def reset(self):
        self.state = PlantState(updated_at=stamp())
        self.emit("Consola", "Instructor", "Planta reiniciada a línea base", "info")

    async def tick(self):
        while True:
            async with self.lock:
                s = self.state
                if s.pump_enabled and not s.safety_trip:
                    s.flow = round(s.speed_setpoint * 0.5, 1)
                    s.tank_level = min(100.0, s.tank_level + (s.speed_setpoint - 40) * 0.008)
                    s.temperature = round(min(100.0, s.temperature + max(0, s.speed_setpoint - 65) * 0.009 - 0.012), 1)
                else:
                    s.flow = 0
                    s.tank_level = max(0, s.tank_level - 0.04)
                    s.temperature = round(max(22, s.temperature - 0.025), 1)
                if (s.tank_level > 92 or s.temperature > 78) and not s.safety_trip:
                    s.safety_trip = True
                    s.pump_enabled = False
                    s.flow = 0
                    self.emit("SIS simulado", "Lógica local", "Protección: bomba detenida por umbral independiente", "high")
                s.tank_level = round(s.tank_level, 2)
                s.updated_at = stamp()
            await asyncio.sleep(1)


plant = DigitalTwin()
