"""Comprobación de extremo a extremo para ejecutarse DENTRO de trainer en red Docker aislada."""
import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = "http://plant:8000"


def call(path, method="GET", payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=23) as response:
        return json.load(response)


def scenario(name, state_key, expected):
    call("/api/scenario/reset", "POST")
    response = call("/api/scenario/" + name, "POST")
    assert response.get("ok") is True, f"{name} failed: {response}"
    for _ in range(8):
        state = call("/api/state")
        if state[state_key] == expected:
            print(f"PASS {name}: {state_key}={expected}", flush=True)
            return
        time.sleep(.4)
    raise AssertionError(f"{name}: expected {state_key}={expected}; got {state[state_key]}")


def main():
    started = datetime.now(timezone.utc)
    initial = call("/api/health")
    assert initial["protocols"] == {"modbus": 502, "opcua": 4840, "dnp3": 20000}
    scenario("modbus-write", "speed_setpoint", 85)
    scenario("opcua-write", "speed_setpoint", 75)
    scenario("dnp3-signal", "traffic_signal", 0)
    scenario("intercept", "speed_setpoint", 90)
    for _ in range(12):
        signatures = []
        for alert in call("/api/alerts")["alerts"]:
            if alert.get("engine") != "Suricata":
                continue
            when = datetime.fromisoformat(alert["ts"].replace("Z", "+00:00"))
            if when >= started:
                signatures.append(alert.get("signature", ""))
        if any("Modbus FC06" in text for text in signatures):
            print("PASS Suricata FC06: firma observada en tráfico real", flush=True)
            break
        time.sleep(.5)
    else:
        raise AssertionError("No hay firma de Suricata FC06; revisar interfaz eth1 y eve.json")
    events = call("/api/events")["events"]
    assert any(event.get("frame_before") and event.get("frame_after") for event in events)
    print("PASS proxy: trama original y modificada preservadas", flush=True)
    call("/api/scenario/reset", "POST")
    print("PASS TODOS LOS ESCENARIOS", flush=True)


if __name__ == "__main__":
    main()
