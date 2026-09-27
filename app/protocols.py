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
    # Track the last value mirrored into the OPC UA node. A server-side sync
    # after Modbus/DNP3/reset must NOT be interpreted as an external OPC UA
    # Write; an asynchronous subscription callback caused exactly that race.
    last_speed = int(plant.state.speed_setpoint)
    last_signal = int(plant.state.traffic_signal)
    await server.start()
    LOG.info("OPC UA disponible en 4840; namespace %s, nodos Planta/*", idx)
    try:
        while True:
            s = plant.state
            node_speed = int(await setpoint.read_value())
            node_signal = int(await signal.read_value())
            if node_speed != last_speed:
                plant.emit("OPC UA", "cliente → servidor", f"Write Planta/SpeedSetpoint = {node_speed}", "high")
                plant.command("OPC UA", "speed", node_speed)
                last_speed = node_speed
            elif s.speed_setpoint != last_speed:
                await setpoint.write_value(int(s.speed_setpoint))
                last_speed = int(s.speed_setpoint)
            if node_signal != last_signal:
                plant.emit("OPC UA", "cliente → servidor", f"Write Planta/TrafficSignal = {node_signal}", "warning")
                plant.command("OPC UA", "signal", node_signal)
                last_signal = node_signal
            elif s.traffic_signal != last_signal:
                await signal.write_value(int(s.traffic_signal))
                last_signal = int(s.traffic_signal)
            await level.write_value(float(s.tank_level))
            await asyncio.sleep(0.2)
    finally:
        await server.stop()


async def run_protocols(context: LabContext):
    tasks = [asyncio.create_task(run_modbus(context), name="modbus"),
             asyncio.create_task(run_opcua(), name="opcua")]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
