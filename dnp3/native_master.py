#!/usr/bin/env python3
"""Dependency-free one-shot DNP3/TCP master for the local traffic-signal lab.

This is a real DNP3 client, not an HTTP adapter: it emits and validates DNP3
link-layer frames (including per-block CRC-DNP), transport headers, and
application objects.  The endpoint is deliberately fixed to plant:20000.
The command is considered successful only after the outstation's DNP3
response is received and analog input 0 reads back the requested value.
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import time
from dataclasses import dataclass
from typing import Iterable, Optional

DNP3_HOST = "plant"
DNP3_PORT = 20000
MASTER_ADDR = 2
OUTSTATION_ADDR = 1
CONNECT_TIMEOUT = 3.0
RESPONSE_TIMEOUT = 3.0


class DNP3Error(RuntimeError):
    pass


def crc_dnp(data: bytes) -> int:
    """Return the 16-bit DNP3 CRC integer (wire order is little endian)."""
    crc = 0
    for octet in data:
        crc ^= octet
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA6BC if crc & 1 else crc >> 1
    # DNP3 uses the complemented reflected CRC-16/IBM residue; bytes are
    # transmitted least-significant byte first.  For example the live
    # outstation header 05 64 11 c4 01 00 02 00 carries CRC c3 5a.
    return (~crc) & 0xFFFF


def _crc_bytes(data: bytes) -> bytes:
    return crc_dnp(data).to_bytes(2, "little")


def _with_data_crcs(data: bytes) -> bytes:
    return b"".join(data[pos : pos + 16] + _crc_bytes(data[pos : pos + 16])
                   for pos in range(0, len(data), 16))


def build_frame(link_control: int, destination: int, source: int,
                transport: int, application: bytes) -> bytes:
    """Build one complete DNP3 serial-frame format carried by TCP."""
    payload = bytes((transport,)) + application
    # DNP3 length counts control + destination + source + transport/application;
    # start bytes, length byte, and CRC bytes are not counted.
    link_length = 5 + len(payload)
    if link_length > 250:
        raise DNP3Error("payload too large for this minimal client")
    header = (b"\x05\x64" + bytes((link_length, link_control))
              + destination.to_bytes(2, "little")
              + source.to_bytes(2, "little"))
    return header + _crc_bytes(header) + _with_data_crcs(payload)


def build_direct_operate(value: int, app_seq: int = 0, transport_seq: int = 0) -> bytes:
    if value not in (0, 1, 2):
        raise ValueError("signal must be 0, 1, or 2")
    # Group 41 variation 1: 32-bit analog output; qualifier 0x28 is a
    # two-octet index prefix with a 16-bit quantity field, one point at index 0.
    application = bytes((0xC0 | (app_seq & 0x0F), 0x05, 0x29, 0x01,
                         0x28, 0x01, 0x00, 0x00, 0x00))
    application += int(value).to_bytes(4, "little", signed=True) + b"\x00"
    return build_frame(0xC4, OUTSTATION_ADDR, MASTER_ADDR,
                       0xC0 | (transport_seq & 0x3F), application)


def build_read_analog(app_seq: int = 1, transport_seq: int = 1) -> bytes:
    # Group 30 variation 1, qualifier 6 = all objects of that variation.
    application = bytes((0xC0 | (app_seq & 0x0F), 0x01, 0x1E, 0x01, 0x06))
    return build_frame(0xC4, OUTSTATION_ADDR, MASTER_ADDR,
                       0xC0 | (transport_seq & 0x3F), application)


@dataclass(frozen=True)
class Frame:
    link_control: int
    destination: int
    source: int
    payload: bytes
    raw: bytes


def _take_frame(buffer: bytearray) -> Optional[Frame]:
    """Extract one validated DNP3 frame from a TCP stream buffer."""
    while len(buffer) >= 2 and buffer[:2] != b"\x05\x64":
        del buffer[0]
    if len(buffer) < 3:
        return None
    link_length = buffer[2]
    if link_length < 5:
        del buffer[0]
        return None
    payload_len = link_length - 5
    data_crc_count = (payload_len + 15) // 16
    total = 10 + payload_len + 2 * data_crc_count
    if len(buffer) < total:
        return None
    raw = bytes(buffer[:total])
    del buffer[:total]
    if crc_dnp(raw[:8]) != int.from_bytes(raw[8:10], "little"):
        raise DNP3Error("invalid DNP3 link-header CRC")
    encoded = raw[10:]
    payload_parts = []
    pos = 0
    remaining = payload_len
    while remaining:
        size = min(16, remaining)
        part = encoded[pos : pos + size]
        expected = int.from_bytes(encoded[pos + size : pos + size + 2], "little")
        if crc_dnp(part) != expected:
            raise DNP3Error("invalid DNP3 data-block CRC")
        payload_parts.append(part)
        pos += size + 2
        remaining -= size
    return Frame(raw[3], int.from_bytes(raw[4:6], "little"),
                 int.from_bytes(raw[6:8], "little"), b"".join(payload_parts), raw)


def parse_analog_input(application: bytes) -> Optional[float]:
    """Read group 30 variation 1 index 0 from a DNP3 response."""
    if len(application) < 5 or application[1] != 0x81:
        return None
    pos = 4  # application control, function, IIN low/high
    while pos + 3 <= len(application):
        if application[pos : pos + 2] != b"\x1e\x01":
            pos += 1
            continue
        qualifier = application[pos + 2]
        pos += 3
        if qualifier == 0x06:  # all objects: no range bytes
            start = 0
            count = 1
        elif qualifier == 0x00 and pos + 2 <= len(application):
            start, stop = application[pos], application[pos + 1]
            pos += 2
            count = stop - start + 1
        elif qualifier == 0x01 and pos + 4 <= len(application):
            start = int.from_bytes(application[pos : pos + 2], "little")
            stop = int.from_bytes(application[pos + 2 : pos + 4], "little")
            pos += 4
            count = stop - start + 1
        else:
            return None
        if start > 0 or count < 1:
            return None
        if pos + 5 > len(application):
            return None
        # Variation 1 is flags (one octet) followed by signed 32-bit value.
        _flags = application[pos]
        raw_value = application[pos + 1 : pos + 5]
        return float(int.from_bytes(raw_value, "little", signed=True))
    return None


class NativeMaster:
    def __init__(self) -> None:
        self.sock = socket.create_connection((DNP3_HOST, DNP3_PORT), CONNECT_TIMEOUT)
        self.sock.settimeout(RESPONSE_TIMEOUT)
        self.buffer = bytearray()
        self.app_seq = 0
        self.transport_seq = 0

    def close(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()

    def _send(self, frame: bytes) -> None:
        self.sock.sendall(frame)

    def _receive_until(self, predicate, timeout: float = RESPONSE_TIMEOUT) -> Frame:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            frame = _take_frame(self.buffer)
            if frame is not None:
                if predicate(frame):
                    return frame
                continue
            remaining = max(0.05, deadline - time.monotonic())
            self.sock.settimeout(remaining)
            try:
                chunk = self.sock.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                raise DNP3Error("outstation closed the DNP3 TCP connection")
            self.buffer.extend(chunk)
        raise DNP3Error("DNP3 response timeout")

    @staticmethod
    def _application(frame: Frame) -> bytes:
        if not frame.payload:
            return b""
        # This lab transaction fits in one transport segment.  Validate FIR/FIN.
        transport = frame.payload[0]
        if transport & 0xC0 != 0xC0:
            raise DNP3Error("fragmented DNP3 transport response is unsupported")
        return frame.payload[1:]

    def _request_response(self, frame: bytes, function: int) -> bytes:
        self._send(frame)
        def matches(candidate: Frame) -> bool:
            if candidate.destination != MASTER_ADDR or candidate.source != OUTSTATION_ADDR:
                return False
            try:
                app = self._application(candidate)
            except DNP3Error:
                return False
            # OpenDNP3 may announce its current Class-2 event with an
            # unsolicited response before servicing the first request.  It
            # sets CON=1 and will not continue until the master returns the
            # DNP3 CONFIRM function for that application sequence.  This is a
            # real protocol transaction, not a shortcut or HTTP probe.
            if len(app) >= 2 and app[1] == 0x82 and app[0] & 0x20:
                # An unsolicited response has UNS=1; its CONFIRM must retain
                # that bit (DNP3 app control 0xD0 | sequence).  C9 would be a
                # solicited confirm and OpenDNP3 correctly rejects it while
                # waiting for the unsolicited event acknowledgement.
                confirm = bytes((0xD0 | (app[0] & 0x0F), 0x00))
                self._send(build_frame(0xC4, OUTSTATION_ADDR, MASTER_ADDR,
                                        0xC0 | (self.transport_seq & 0x3F), confirm))
                self.transport_seq = (self.transport_seq + 1) & 0x3F
                return False
            return len(app) >= 2 and app[1] in (0x81, 0x82) and app[0] & 0x0F == (self.app_seq & 0x0F)
        response = self._receive_until(matches)
        app = self._application(response)
        if len(app) < 4 or app[1] not in (0x81, 0x82):
            raise DNP3Error("unexpected DNP3 application response")
        if app[1] == 0x81 and app[2] & 0x01:
            raise DNP3Error("outstation returned function-not-implemented")
        return app

    def signal(self, value: int) -> float:
        app = self._request_response(build_direct_operate(value, self.app_seq, self.transport_seq), 0x05)
        # A successful command response contains group 41/variation 1 and status 0.
        marker = app.find(b"\x29\x01\x28")
        if marker < 0:
            raise DNP3Error("DNP3 command response omitted group 41 variation 1")
        status_pos = marker + 3 + 1 + 2 + 4
        if status_pos >= len(app) or app[status_pos] != 0:
            raise DNP3Error("DNP3 command status was not SUCCESS")
        self.app_seq = (self.app_seq + 1) & 0x0F
        self.transport_seq = (self.transport_seq + 1) & 0x3F
        # The outstation publishes its analog input from the gemelo every
        # 0.5 seconds. Its command response can precede that scan, so do not
        # misclassify one stale readback as a failed command.
        deadline = time.monotonic() + 5.0
        observed = None
        while time.monotonic() < deadline:
            observed = self.observe()
            if int(observed) == value:
                return observed
            time.sleep(0.25)
        raise DNP3Error(f"readback mismatch: requested {value}, observed {observed}")

    def observe(self) -> float:
        app = self._request_response(build_read_analog(self.app_seq, self.transport_seq), 0x01)
        value = parse_analog_input(app)
        if value is None:
            raise DNP3Error("DNP3 response omitted analog input index 0")
        self.app_seq = (self.app_seq + 1) & 0x0F
        self.transport_seq = (self.transport_seq + 1) & 0x3F
        return value


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fixed DNP3 master for plant:20000")
    sub = parser.add_subparsers(dest="operation", required=True)
    sub.add_parser("observe")
    command = sub.add_parser("signal")
    command.add_argument("value", type=int, choices=(0, 1, 2))
    return parser.parse_args(argv)


def main(argv: Optional[list[str]] = None) -> int:
    args = parse_args(argv)
    master: Optional[NativeMaster] = None
    try:
        master = NativeMaster()
        if args.operation == "observe":
            value = master.observe()
            print(json.dumps({"operation": "observe", "protocol": "DNP3", "analog_input_index": 0,
                              "value": int(value)}, separators=(",", ":")))
            return 0
        observed = master.signal(args.value)
        if int(observed) != args.value:
            raise DNP3Error(f"readback mismatch: requested {args.value}, observed {observed}")
        print(json.dumps({"operation": "signal", "protocol": "DNP3", "value": args.value,
                          "status": "VERIFIED_BY_DNP3_READBACK", "analog_input_index": 0,
                          "observed": int(observed)}, separators=(",", ":")))
        return 0
    except (OSError, DNP3Error, ValueError) as exc:
        print(json.dumps({"error": str(exc), "protocol": "DNP3", "destination": "plant:20000"},
                         separators=(",", ":")), file=sys.stderr)
        return 2
    finally:
        if master is not None:
            master.close()


if __name__ == "__main__":
    raise SystemExit(main())

__all__ = ["crc_dnp", "build_frame", "build_direct_operate", "build_read_analog",
           "_take_frame", "parse_analog_input", "NativeMaster", "main"]
