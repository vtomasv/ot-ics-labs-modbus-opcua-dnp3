"""Read actual Ethernet frames captured by the passive Docker sensor.

This is a packet viewer, not a TCP reassembler or an IDS. Incomplete PDUs are
explicitly marked as segments. The source of truth for full protocol dissection
is the downloadable PCAP opened in Wireshark/Tshark.
"""
from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
import socket
import struct

import dpkt

CAPTURE_DIR = Path('/captures/live')
PORTS = {502: 'Modbus/TCP', 4840: 'OPC UA', 20000: 'DNP3'}
FUNCTIONS = {1: 'READ_COILS', 3: 'READ_HOLDING_REGISTERS', 4: 'READ_INPUT_REGISTERS',
             5: 'WRITE_SINGLE_COIL', 6: 'WRITE_SINGLE_REGISTER', 16: 'WRITE_MULTIPLE_REGISTERS'}
DNP_FUNCTIONS = {0: 'CONFIRM', 1: 'READ', 5: 'DIRECT_OPERATE', 129: 'RESPONSE', 130: 'UNSOLICITED_RESPONSE'}


def current_capture() -> Path | None:
    """The most recently modified rotating segment; never a user-supplied path."""
    files = [p for p in CAPTURE_DIR.glob('live.pcap*') if p.is_file()]
    return max(files, key=lambda p: p.stat().st_mtime_ns) if files else None


def describe_payload(protocol: str, payload: bytes, request: bool) -> str:
    if not payload:
        return 'Segmento TCP sin carga de aplicación'
    if protocol == 'Modbus/TCP':
        if len(payload) < 8:
            return 'Segmento TCP: PDU Modbus incompleta (sin reensamblar)'
        tx, proto, length, unit, fc = struct.unpack('>HHHBB', payload[:8])
        if proto != 0 or length < 2 or length > 254:
            return 'Segmento TCP: cabecera MBAP no válida o PDU fragmentada'
        full = 6 + length
        if len(payload) < full:
            return f'TID={tx} unidad={unit} FC{fc:02d}: PDU fragmentada (sin reensamblar)'
        label = FUNCTIONS.get(fc & 0x7f, 'función no catalogada')
        if fc & 0x80:
            return f'TID={tx} unidad={unit} excepción FC{fc:02d}'
        if request and fc == 6 and len(payload) >= 12:
            register, value = struct.unpack('>HH', payload[8:12])
            return f'TID={tx} unidad={unit} FC06 {label} registro={register} valor={value}'
        if request and fc == 3 and len(payload) >= 12:
            register, count = struct.unpack('>HH', payload[8:12])
            return f'TID={tx} unidad={unit} FC03 {label} inicio={register} cantidad={count}'
        return f'TID={tx} unidad={unit} FC{fc:02d} {label} ({"solicitud" if request else "respuesta"})'
    if protocol == 'OPC UA':
        # UACP message type is visible; service IDs can be encrypted or span TCP
        # segments, and are intentionally NOT guessed here.
        code = payload[:3].decode('ascii', errors='replace') if len(payload) >= 3 else '???'
        if code not in ('HEL', 'ACK', 'ERR', 'OPN', 'CLO', 'MSG'):
            return 'Segmento TCP OPC UA (no se reensambla ni descifra)'
        if len(payload) < 8:
            return f'OPC UA {code}: cabecera incompleta'
        size = int.from_bytes(payload[4:8], 'little')
        return f'OPC UA {code} longitud={size} ({"segmento parcial" if size > len(payload) else "mensaje en segmento"}; servicio no decodificado)'
    if protocol == 'DNP3':
        if len(payload) < 13 or payload[:2] != b'\x05\x64':
            return 'Segmento TCP DNP3 (cabecera incompleta / sin reensamblar)'
        length = payload[2]
        destination = int.from_bytes(payload[4:6], 'little')
        source = int.from_bytes(payload[6:8], 'little')
        # Header + first data block: transport control at 10, application
        # control at 11, application function at 12. Do not assert CRC validity.
        function = payload[12]
        return (f'DNP3 enlace longitud={length} {source}→{destination} '
                f'función={function:#04x} {DNP_FUNCTIONS.get(function, "no catalogada")} '
                '(CRC / fragmentación: validar en Wireshark)')
    return 'Segmento TCP'


def read_packets(limit: int = 80, protocol: str | None = None) -> dict:
    """Return last packets from the active local capture only, fail closed on errors."""
    path = current_capture()
    if path is None:
        return {'source': 'sensor pasivo / PCAP', 'available': False, 'packets': [],
                'message': 'Sensor sin captura; comprueba docker compose ps sensor y sus logs.'}
    packets = deque(maxlen=max(1, min(limit, 100)))
    try:
        with path.open('rb') as stream:
            reader = dpkt.pcap.Reader(stream)
            try:
                for timestamp, raw in reader:
                    try:
                        eth = dpkt.ethernet.Ethernet(raw)
                        ip = eth.data
                        if not isinstance(ip, dpkt.ip.IP) or not isinstance(ip.data, dpkt.tcp.TCP):
                            continue
                        tcp = ip.data
                        port = tcp.dport if tcp.dport in PORTS else tcp.sport
                        name = PORTS.get(port)
                        if not name or (protocol and name != protocol):
                            continue
                        data = bytes(tcp.data)
                        if not data:
                            continue  # ACK/SYN do not contain protocol messages
                        source = socket.inet_ntoa(ip.src)
                        destination = socket.inet_ntoa(ip.dst)
                        packets.append({'ts': datetime.fromtimestamp(timestamp, timezone.utc).isoformat(timespec='milliseconds'),
                                        'protocol': name, 'src': source, 'dst': destination,
                                        'src_port': tcp.sport, 'dst_port': tcp.dport,
                                        'bytes': len(data), 'hex': data[:192].hex(' ').upper(),
                                        'truncated_hex': len(data) > 192,
                                        'summary': describe_payload(name, data, tcp.dport == port),
                                        'evidence': 'PCAP REAL / Ethernet-IP-TCP; sin reensamblado'})
                    except (ValueError, dpkt.UnpackError, OSError):
                        continue
            except (dpkt.NeedData, ValueError):
                # tcpdump may still be writing its last frame; earlier ones survive.
                pass
        return {'source': 'sensor pasivo / PCAP', 'available': True, 'capture': path.name,
                'packets': list(reversed(packets)), 'message': 'Bytes capturados, no telemetría sintética.'}
    except (OSError, ValueError, dpkt.UnpackError) as exc:
        return {'source': 'sensor pasivo / PCAP', 'available': False, 'packets': [],
                'message': f'Captura todavía no legible: {type(exc).__name__}'}
