#!/usr/bin/env python3
"""ESCENARIO CONTROLADO DE LABORATORIO: FC06 al gemelo plant:502, jamás a objetivos externos."""
import argparse
from pymodbus.client import ModbusTcpClient


def main() -> None:
    parser = argparse.ArgumentParser(description="Laboratorio FC06: solo registro 2 del gemelo Docker")
    parser.add_argument("--lab-only", action="store_true", help="confirmar uso exclusivo en red Docker educativa")
    args = parser.parse_args()
    if not args.lab_only:
        parser.error("es obligatorio --lab-only; no existe argumento para cambiar el destino")
    with ModbusTcpClient("plant", port=502, timeout=3) as client:
        if not client.connect():
            raise RuntimeError("plant:502 no disponible en la red Docker del laboratorio")
        before = client.read_holding_registers(2, count=1, slave=1)
        if before.isError():
            raise RuntimeError(f"lectura FC03 falló: {before}")
        response = client.write_register(2, 85, slave=1)
        if response.isError():
            raise RuntimeError(f"escritura FC06 falló: {response}")
        after = client.read_holding_registers(2, count=1, slave=1)
        if after.isError() or after.registers[0] != 85:
            raise RuntimeError("la lectura de retorno no confirmó 85 Hz")
    print(f"ESCENARIO CONTROLADO: FC06 plant:502 registro=2 {before.registers[0]} -> 85 Hz")


if __name__ == "__main__":
    main()
