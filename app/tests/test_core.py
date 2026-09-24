from app.core import DigitalTwin
from app.protocols import LabContext, holding_values


def test_plant_limits_and_signal():
    twin = DigitalTwin()
    assert twin.state.speed_setpoint == 45
    assert twin.command("test", "speed", 85)
    assert twin.state.speed_setpoint == 85
    assert not twin.command("test", "speed", 101)
    assert twin.state.speed_setpoint == 85
    assert twin.command("test", "signal", 0)
    assert twin.state.traffic_signal == 0
    assert not twin.command("test", "signal", 3)
    twin.reset()
    assert twin.state.speed_setpoint == 45
    assert twin.state.traffic_signal == 2


def test_modbus_register_2_maps_to_setpoint():
    from app.core import plant
    plant.reset()
    context = LabContext()
    assert context.getValues(3, 2, 1) == [45]
    context.setValues(6, 2, [86])
    assert plant.state.speed_setpoint == 86
    assert context.getValues(3, 2, 1) == [86]
    context.setValues(6, 2, [45])
    assert holding_values()[2] == 45


def test_read_only_sensor_register_does_not_change_twin():
    from app.core import plant
    plant.reset()
    context = LabContext()
    before = plant.snapshot()
    context.setValues(6, 0, [999])
    assert plant.state.tank_level == before["tank_level"]
    assert context.getValues(3, 0, 1) == [int(before["tank_level"] * 10)]


def test_interlock_rejects_rearm_until_reset():
    twin = DigitalTwin()
    twin.state.safety_trip = True
    twin.state.pump_enabled = False
    assert not twin.command("test", "pump", 1)
    assert twin.state.pump_enabled is False
    twin.reset()
    assert twin.state.pump_enabled is True
