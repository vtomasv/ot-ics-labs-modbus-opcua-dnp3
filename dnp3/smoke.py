#!/usr/bin/env python3
"""Smoke checks for the educational real-OpenDNP3 lab files.

This imports the OpenDNP3 outstation binding, constructs a stack configuration,
and checks that the dependency-free DNP3 master CLI has no host option.
Run inside the built image with: python smoke.py
"""
from __future__ import annotations

import ast
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent


def main() -> int:
    subprocess.run([sys.executable, "-m", "py_compile", str(ROOT / "outstation.py"), str(ROOT / "native_master.py")], check=True)
    from pydnp3 import asiodnp3, opendnp3  # noqa: PLC0415

    # Native binding/API smoke: this is an OpenDNP3 object, not a JSON stand-in.
    cfg = asiodnp3.OutstationStackConfig(opendnp3.DatabaseSizes.AllTypes(2))
    cfg.dbConfig.analog[0].svariation = opendnp3.StaticAnalogVariation.Group30Var1
    cfg.dbConfig.aoStatus[0].svariation = opendnp3.StaticAnalogOutputStatusVariation.Group40Var1
    assert opendnp3.AnalogOutputInt32(2).value == 2

    source = (ROOT / "native_master.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    parser_calls = [
        node for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "ArgumentParser"
    ]
    assert parser_calls, "master CLI parser not found"
    assert "DNP3_HOST = \"plant\"" in source
    assert "add_argument(\"--host\"" not in source
    assert "urllib" not in source
    print("smoke: native pydnp3 import/configuration OK")
    print("smoke: fixed destination plant:20000 and local-only CLI guard OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
