#!/usr/bin/env python3
import importlib.util
import sys
from pathlib import Path
from unittest.mock import patch
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

# First DNP3 READ may time out after a successful DIRECT_OPERATE on a fresh
# outstation. A new read-only connection may verify the applied value, but the
# control command must never be sent a second time on an ambiguous outcome.
calls = {'commands': 0, 'reads': 0, 'connections': 0}
reply = bytes.fromhex('C0 81 00 00 29 01 28 01 00 00 00 00 00 00 00')
def fake_init(self):
    calls['connections'] += 1
    self.app_seq = self.transport_seq = 0
def fake_command(self, frame, function):
    calls['commands'] += 1
    assert function == 0x05
    return reply
def fake_read(self):
    calls['reads'] += 1
    if calls['reads'] == 1:
        raise m.DNP3Error('first READ stalled after command response')
    return 0.0
with patch.object(m.NativeMaster, '__init__', fake_init), \
     patch.object(m.NativeMaster, 'close', lambda self: None), \
     patch.object(m.NativeMaster, '_request_response', fake_command), \
     patch.object(m.NativeMaster, 'observe', fake_read):
    master = m.NativeMaster()
    assert master.signal(0) == 0.0
assert calls == {'commands': 1, 'reads': 2, 'connections': 2}, calls
print('unit: DNP3 recovered by read-only reconnect, control sent exactly once')
