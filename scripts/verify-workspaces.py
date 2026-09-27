#!/usr/bin/env python3
"""Black-box integration checks against the Docker lab, never external targets."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import json
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = 'http://127.0.0.1:8080'


def request(path, method='GET', payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(BASE + path, data=data, method=method,
                  headers={'Content-Type': 'application/json'} if data is not None else {})
    with urlopen(req, timeout=28) as response:
        return json.load(response)


def expect_status(path, expected, payload):
    try:
        request(path, 'POST', payload)
    except HTTPError as exc:
        assert exc.code == expected, (path, exc.code, expected)
    else:
        raise AssertionError(f'Expected HTTP {expected}: {path}')


def until(predicate, seconds=12):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.4)
    raise AssertionError('No se observó la evidencia dentro del plazo de prueba')


def packets(protocol):
    from urllib.parse import quote
    return request('/api/packets?protocol=' + quote(protocol, safe=''))['packets']


def since(protocol, started):
    return [p for p in packets(protocol) if datetime.fromisoformat(p['ts']) >= started]


def main():
    assert request('/api/health')['ok']
    catalog = request('/api/labs')['labs']
    assert [lab['id'] for lab in catalog] == ['01-baseline','02-modbus','03-opcua','04-dnp3']
    for lab in catalog:
        detail = request('/api/labs/' + lab['id'])
        assert detail['steps'] and detail['mitre'] and detail['iec'] and detail['nodes'] and detail['links']
        with urlopen(BASE + '/labs/' + lab['id'], timeout=5) as response:
            assert response.status == 200 and b'packet-list' in response.read()
        with urlopen(BASE + '/docs/labs/' + lab['id'] + '.md', timeout=5) as response:
            assert response.status == 200 and len(response.read()) > 500
        print('PASS pantalla, guía, pasos y matriz:',lab['id'])
    expect_status('/api/labs/03-opcua/action/modbus-write', 404, {})
    expect_status('/api/labs/02-modbus/inject', 400, {'protocol':'modbus','operation':'write','value':500})
    expect_status('/api/labs/04-dnp3/inject', 400, {'protocol':'dnp3','operation':'signal','value':55})
    expect_status('/api/labs/01-baseline/inject', 400, {'protocol':'modbus','operation':'read','value':1})
    print('PASS acciones cruzadas y valores peligrosos rechazados')
    request('/api/labs/01-baseline/action/reset', 'POST')
    started = datetime.now(timezone.utc) - timedelta(seconds=1)
    result = request('/api/labs/01-baseline/inject', 'POST', {'protocol':'modbus','operation':'read','value':None})
    assert result['ok'] and result['function_code'] == 3
    until(lambda: any('FC03' in p['summary'] for p in since('Modbus/TCP', started)))
    print('PASS FC03 emitido y capturado')
    started = datetime.now(timezone.utc) - timedelta(seconds=1)
    result = request('/api/labs/02-modbus/inject', 'POST', {'protocol':'modbus','operation':'write','value':85})
    assert result['ok'] and result['function_code'] == 6 and request('/api/state')['speed_setpoint'] == 85
    until(lambda: any('FC06' in p['summary'] and 'valor=85' in p['summary'] for p in since('Modbus/TCP', started)))
    print('PASS FC06 / valor 85 en PCAP y gemelo')
    started = datetime.now(timezone.utc) - timedelta(seconds=1)
    result = request('/api/labs/03-opcua/inject', 'POST', {'protocol':'opcua','operation':'write','value':75})
    assert result['ok'] and result['readback'] == 75
    until(lambda: request('/api/state')['speed_setpoint'] == 75)
    until(lambda: len(since('OPC UA', started)) > 0)
    print('PASS Write OPC UA / Read y payload 4840')
    started = datetime.now(timezone.utc) - timedelta(seconds=1)
    result = request('/api/labs/04-dnp3/inject', 'POST', {'protocol':'dnp3','operation':'signal','value':0})
    assert result['ok'] and result['readback'] == 0 and request('/api/state')['traffic_signal'] == 0
    until(lambda: len(since('DNP3', started)) > 0)
    print('PASS Direct Operate DNP3 / Read y payload 20000')
    with urlopen(BASE + '/api/capture/download', timeout=5) as response:
        magic = response.read(4)
    assert magic in (bytes.fromhex('d4c3b2a1'), bytes.fromhex('a1b2c3d4'),
                     bytes.fromhex('4d3cb2a1'), bytes.fromhex('a1b23c4d')), magic
    print('PASS descarga de segmento PCAP real')
    request('/api/labs/04-dnp3/action/reset', 'POST')
    time.sleep(2)
    final_state = request('/api/state')
    assert final_state['speed_setpoint'] == 45 and final_state['traffic_signal'] == 2, final_state
    print('PASS TODOS LOS WORKSPACES; gemelo restablecido')


if __name__ == '__main__':
    main()
