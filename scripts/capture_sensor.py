#!/usr/bin/env python3
"""Passive, bounded Ethernet capture for the fixed Docker control interface.

Fallback for environments where tcpdump/libpcap fails on an emulated amd64
container (e.g. QEMU on ARM). Uses AF_PACKET only; it never transmits a frame.
It writes classic Ethernet PCAP segments compatible with Wireshark/dpkt.
"""
from __future__ import annotations
from pathlib import Path
import socket
import struct
import sys
import time

CAPTURE_DIR = Path('/captures/live')
LIMIT = 16 * 1024 * 1024
SEGMENTS = 3
SNAPLEN = 1024
PORTS = frozenset((502, 4840, 20000))
PCAP_HEADER = struct.pack('<IHHIIII', 0xa1b2c3d4, 2, 4, 0, 0, SNAPLEN, 1)


def is_ot_tcp_frame(frame: bytes) -> bool:
    """Accept only Ethernet/IPv4/TCP with an OT port; never inspect another iface."""
    if len(frame) < 14:
        return False
    ethertype = int.from_bytes(frame[12:14], 'big')
    offset = 14
    if ethertype in (0x8100, 0x88a8):
        if len(frame) < 18:
            return False
        ethertype = int.from_bytes(frame[16:18], 'big')
        offset = 18
    if ethertype != 0x0800 or len(frame) < offset + 20:
        return False
    ip_start = offset
    ihl = (frame[ip_start] & 0x0f) * 4
    if frame[ip_start] >> 4 != 4 or ihl < 20 or len(frame) < ip_start + ihl + 4:
        return False
    if frame[ip_start + 9] != 6 or int.from_bytes(frame[ip_start + 6:ip_start + 8], 'big') & 0x1fff:
        return False
    tcp_start = ip_start + ihl
    sport, dport = struct.unpack('>HH', frame[tcp_start:tcp_start + 4])
    return sport in PORTS or dport in PORTS


def open_segment(index: int):
    CAPTURE_DIR.mkdir(parents=True, exist_ok=True)
    stream = (CAPTURE_DIR / f'live.pcap{index}').open('wb')
    stream.write(PCAP_HEADER)
    stream.flush()
    return stream


def capture(interface: str):
    # The shell wrapper resolves the interface by the route to Docker trainer;
    # accepting only its local Linux interface name prevents path/options use.
    if not interface.startswith('eth') or not interface[3:].isdigit():
        raise ValueError('interfaz de control Docker inválida')
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0003)) as sock:
        sock.bind((interface, 0))
        print(f'Python AF_PACKET: capturando {interface} hacia PCAP rotativo', flush=True)
        index = 0
        stream = open_segment(index)
        try:
            while True:
                frame = sock.recv(65535)
                if not is_ot_tcp_frame(frame):
                    continue
                data = frame[:SNAPLEN]
                timestamp = time.time_ns()
                record = struct.pack('<IIII', timestamp // 1_000_000_000,
                                     (timestamp // 1000) % 1_000_000,
                                     len(data), len(frame)) + data
                if stream.tell() + len(record) > LIMIT:
                    stream.close()
                    index = (index + 1) % SEGMENTS
                    stream = open_segment(index)
                    print(f'PCAP: rotación a segmento {index}', flush=True)
                stream.write(record)
                stream.flush()  # the UI can read the last complete packet
        finally:
            stream.close()


if __name__ == '__main__':
    try:
        capture(sys.argv[1] if len(sys.argv) == 2 else '')
    except (OSError, ValueError) as exc:
        print(f'Sensor AF_PACKET no disponible: {exc}', file=sys.stderr)
        raise SystemExit(1) from exc
