#!/usr/bin/env python3
"""Lecturas cíclicas SOLO al contenedor plant:502 dentro de la red Docker educativa."""
import argparse
import time
from pymodbus.client import ModbusTcpClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Línea base FC03 limitada a plant:502")
    parser.add_argument("--count", type=int, default=5, help="1 a 30 lecturas")
    args = parser.parse_args()
    if not 1 <= args.count <= 30:
        parser.error("count debe estar entre 1 y 30")
    with ModbusTcpClient("plant", port=502, timeout=3) as client:
        if not client.connect():
            raise RuntimeError("No se conectó a la planta Docker en plant:502")
        for n in range(args.count):
            reply = client.read_holding_registers(0, count=7, slave=1)
            if reply.isError():
                raise RuntimeError(f"FC03 rechazado: {reply}")
            print(f"lectura {n + 1}: {reply.registers}", flush=True)
            if n + 1 < args.count:
                time.sleep(1)


if __name__ == "__main__":
    main()
