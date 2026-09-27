"""Fixed lab registry: no dynamic paths, Docker targets or arbitrary commands."""
from __future__ import annotations
import json
from pathlib import Path

CATALOG = Path(__file__).parent / 'lab_catalog'
LABS = ('01-baseline', '02-modbus', '03-opcua', '04-dnp3')
ACTIONS = {
    '01-baseline': frozenset(('reset',)),
    '02-modbus': frozenset(('modbus-write', 'intercept', 'reset')),
    '03-opcua': frozenset(('opcua-write', 'reset')),
    '04-dnp3': frozenset(('dnp3-signal', 'reset')),
}
INJECTIONS = {
    '01-baseline': ('modbus', 'read'),
    '02-modbus': ('modbus', 'write'),
    '03-opcua': ('opcua', 'write'),
    '04-dnp3': ('dnp3', 'signal'),
}


def get_lab(lab_id: str) -> dict | None:
    if lab_id not in LABS:
        return None
    try:
        with (CATALOG / f'{lab_id}.json').open(encoding='utf-8') as stream:
            item = json.load(stream)
        if item.get('id') != lab_id:
            return None
        item['allowed_actions'] = sorted(ACTIONS[lab_id])
        item['injection'] = {'protocol': INJECTIONS[lab_id][0], 'operation': INJECTIONS[lab_id][1]}
        return item
    except (OSError, ValueError):
        return None
