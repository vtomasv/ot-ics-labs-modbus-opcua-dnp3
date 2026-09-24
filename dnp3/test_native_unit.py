#!/usr/bin/env python3
import importlib.util
import sys
from pathlib import Path
p=Path(__file__).with_name('native_master.py')
s=importlib.util.spec_from_file_location('native_master', p)
m=importlib.util.module_from_spec(s)
sys.modules[s.name]=m
s.loader.exec_module(m)
assert m.crc_dnp(bytes.fromhex('056411c401000200')) == 0x5ac3
assert m.crc_dnp(bytes.fromhex('05640a4402000100')) == 0xf010
for fn in (m.build_direct_operate(0), m.build_direct_operate(1), m.build_direct_operate(2), m.build_read_analog()):
    b=bytearray(fn); f=m._take_frame(b); assert f and not b
    assert m.crc_dnp(f.raw[:8]) == int.from_bytes(f.raw[8:10],'little')
print('unit: crc/frame builders OK')
print('direct_operate_2=', m.build_direct_operate(2).hex())
print('read=', m.build_read_analog().hex())
