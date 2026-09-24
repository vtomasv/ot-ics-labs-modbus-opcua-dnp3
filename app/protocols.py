"""Servidores reales Modbus/TCP y OPC UA; configuración intencionalmente insegura SOLO en red Docker aislada."""
import asyncio
import logging

from asyncua import Server, ua
from pymodbus.datastore import ModbusSequentialDataBlock, ModbusServerContext, ModbusSlaveContext
from pymodbus.server import StartAsyncTcpServer

from .core import plant

LOG = logging.getLogger(__name__)

# Direcciones Modbus 0-based: 0 nivel x10 (RO); 1 bomba; 2 velocidad;
# 3 temperatura x10 (RO); 4 caudal x10 (RO); 5 semáforo; 6 cartel.
REGISTER_TO_COMPONENT = {1: "pump", 2: "speed", 5: "signal", 6: "sign"}


def holding_values():
    s = plant.state
    return [int(s.tank_level * 10), int(s.pump_enabled), s.speed_setpoint,
            int(s.temperature * 10), int(s.flow * 10), s.traffic_signal, s.sign_code]


class LabContext(ModbusSlaveContext):
    def __init__(self):
        # PyModbus suma 1 a la dirección solicitada antes de consultar el datablock.
        super().__init__(hr=ModbusSequentialDataBlock(1, holding_values() + [0] * 9),
                         ir=ModbusSequentialDataBlock(1, holding_values() + [0] * 9))

    def refresh(self):
        self.store["h"].setValues(1, holding_values())
        self.store["i"].setValues(1, holding_values())

    def getValues(self, fc_as_hex, address, count=1):
        self.refresh()
        if fc_as_hex in (3, 4) and address == 0:
            plant.emit("Modbus/TCP", "HMI → PLC", f"FC{fc_as_hex:02d} lectura de {count} registros desde {address}")
        return super().getValues(fc_as_hex, address, count)

    def setValues(self, fc_as_hex, address, values):
        if fc_as_hex not in (6, 16):
            plant.emit("Modbus/TCP", "RTU", f"Función de escritura no permitida: FC{fc_as_hex}", "high")
            return
        for offset, value in enumerate(values):
            register = address + offset
            component = REGISTER_TO_COMPONENT.get(register)
            plant.emit("Modbus/TCP", "maestro → PLC", f"FC{fc_as_hex:02d} reg {register} = {value}",
                       "high" if component else "warning")
            if component:
                plant.command("Modbus/TCP", component, value)
            else:
                plant.emit("Modbus/TCP", "RTU", f"Registro {register} no editable; sin efecto en proceso", "warning")
        self.refresh()


async def run_modbus(context: LabContext):
    await StartAsyncTcpServer(ModbusServerContext(slaves=context, single=True),
                              address=("0.0.0.0", 502))


class ChangeHandler:
    def __init__(self, speed_node, signal_node):
        self.speed_node = speed_node.nodeid
        self.signal_node = signal_node.nodeid

    async def datachange_notification(self, node, val, _data):
        if node.nodeid == self.speed_node and int(val) != plant.state.speed_setpoint:
            plant.emit("OPC UA", "cliente → servidor", f"Write Planta/SpeedSetpoint = {val}", "high")
            plant.command("OPC UA", "speed", int(val))
        elif node.nodeid == self.signal_node and int(val) != plant.state.traffic_signal:
            plant.emit("OPC UA", "cliente → servidor", f"Write Planta/TrafficSignal = {val}", "warning")
            plant.command("OPC UA", "signal", int(val))

    def event_notification(self, _event):
        pass


async def run_opcua():
    server = Server()
    await server.init()
    server.set_endpoint("opc.tcp://0.0.0.0:4840/ot-lab/")
    server.set_server_name("OT/ICS Labs / Gemelo de planta — SOLO LABORATORIO")
    # Modo None expone una debilidad de configuración para el ejercicio; no usar en producción.
    server.set_security_policy([ua.SecurityPolicyType.NoSecurity])
    idx = await server.register_namespace("urn:ot-ics-labs:planta")
    obj = await server.nodes.objects.add_object(idx, "Planta")
    setpoint = await obj.add_variable(idx, "SpeedSetpoint", int(plant.state.speed_setpoint))
    await setpoint.set_writable()
    level = await obj.add_variable(idx, "TankLevel", float(plant.state.tank_level))
    signal = await obj.add_variable(idx, "TrafficSignal", int(plant.state.traffic_signal))
    await signal.set_writable()
    handler = ChangeHandler(setpoint, signal)
    sub = None
    await server.start()
    LOG.info("OPC UA disponible en 4840; namespace %s, nodos Planta/*", idx)
    try:
        sub = await server.create_subscription(500, handler)
        await sub.subscribe_data_change([setpoint, signal])
        while True:
            s = plant.state
            # Las escrituras de servidor generan notificación, pero el callback solo reacciona a un valor divergente.
            if await setpoint.read_value() != s.speed_setpoint:
                await setpoint.write_value(int(s.speed_setpoint))
            if await signal.read_value() != s.traffic_signal:
                await signal.write_value(int(s.traffic_signal))
            await level.write_value(float(s.tank_level))
            await asyncio.sleep(1)
    finally:
        if sub:
            await sub.delete()
        await server.stop()


async def run_protocols(context: LabContext):
    tasks = [asyncio.create_task(run_modbus(context), name="modbus"),
             asyncio.create_task(run_opcua(), name="opcua")]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
