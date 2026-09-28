import unittest

from app.core import DigitalTwin, plant
from app.protocols import LabContext, holding_values


class DigitalTwinTest(unittest.TestCase):
    def test_plant_limits_and_signal(self):
        twin = DigitalTwin()
        self.assertEqual(twin.state.speed_setpoint, 45)
        self.assertTrue(twin.command('test', 'speed', 85))
        self.assertEqual(twin.state.speed_setpoint, 85)
        self.assertFalse(twin.command('test', 'speed', 101))
        self.assertEqual(twin.state.speed_setpoint, 85)
        self.assertTrue(twin.command('test', 'signal', 0))
        self.assertEqual(twin.state.traffic_signal, 0)
        self.assertFalse(twin.command('test', 'signal', 3))
        twin.reset()
        self.assertEqual(twin.state.speed_setpoint, 45)
        self.assertEqual(twin.state.traffic_signal, 2)

    def test_modbus_register_2_maps_to_setpoint(self):
        plant.reset()
        context = LabContext()
        self.assertEqual(context.getValues(3, 2, 1), [45])
        context.setValues(6, 2, [86])
        self.assertEqual(plant.state.speed_setpoint, 86)
        self.assertEqual(context.getValues(3, 2, 1), [86])
        context.setValues(6, 2, [45])
        self.assertEqual(holding_values()[2], 45)

    def test_read_only_sensor_register_does_not_change_twin(self):
        plant.reset()
        context = LabContext()
        before = plant.snapshot()
        context.setValues(6, 0, [999])
        self.assertEqual(plant.state.tank_level, before['tank_level'])
        self.assertEqual(context.getValues(3, 0, 1), [int(before['tank_level'] * 10)])

    def test_interlock_rejects_rearm_until_reset(self):
        twin = DigitalTwin()
        twin.state.safety_trip = True
        twin.state.pump_enabled = False
        self.assertFalse(twin.command('test', 'pump', 1))
        self.assertFalse(twin.state.pump_enabled)
        twin.reset()
        self.assertTrue(twin.state.pump_enabled)


if __name__ == '__main__':
    unittest.main()
