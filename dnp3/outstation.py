#!/usr/bin/env python3
"""Educational DNP3 outstation for the local traffic-signal laboratory.

This process uses the real OpenDNP3 stack through the dnp3-python bindings.  HTTP is
used only at the plant API boundary; DNP3 traffic on TCP/20000 is never replaced by
JSON or another protocol.
"""
from __future__ import annotations

import json
import logging
import signal
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Optional

from pydnp3 import asiodnp3, asiopal, opendnp3, openpal

DNP3_BIND = "0.0.0.0"
DNP3_PORT = 20000
LOCAL_ADDR = 1
MASTER_ADDR = 2
STATE_URL = "http://127.0.0.1:8000/api/internal/state"
COMMAND_URL = "http://127.0.0.1:8000/api/internal/command"
POLL_SECONDS = 0.5
HTTP_TIMEOUT_SECONDS = 2.0

LOG = logging.getLogger("dnp3.outstation")
LOG_LEVELS = opendnp3.levels.NORMAL | opendnp3.levels.ALL_COMMS


class HttpPlantAPI:
    """Small, fixed-destination HTTP adapter for the API in the plant container."""

    @staticmethod
    def _json_request(request: urllib.request.Request) -> Any:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
            body = response.read()
            if not body:
                return None
            return json.loads(body.decode("utf-8"))

    @classmethod
    def read_signal(cls) -> Optional[int]:
        request = urllib.request.Request(
            STATE_URL,
            headers={"Accept": "application/json"},
            method="GET",
        )
        try:
            payload = cls._json_request(request)
            value = _find_signal_value(payload)
            if value is None:
                LOG.warning("plant state did not contain a signal value: %r", payload)
                return None
            if value not in (0, 1, 2):
                LOG.warning("plant state signal is outside 0..2: %r", value)
                return None
            return value
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            LOG.warning("GET %s failed: %s", STATE_URL, exc)
            return None

    @classmethod
    def apply_signal(cls, value: int) -> bool:
        body = json.dumps(
            {"source": "dnp3", "component": "signal", "value": int(value)},
            separators=(",", ":"),
        ).encode("utf-8")
        request = urllib.request.Request(
            COMMAND_URL,
            data=body,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
                response.read()
                if not 200 <= response.status < 300:
                    LOG.error("POST %s returned HTTP %s", COMMAND_URL, response.status)
                    return False
            LOG.info("DNP3 command applied through plant API: signal=%d", value)
            return True
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as exc:
            LOG.error("POST %s failed for signal=%d: %s", COMMAND_URL, value, exc)
            return False


def _find_signal_value(payload: Any) -> Optional[int]:
    """Accept the plant API's scalar or nested state shape without changing the wire protocol."""
    if isinstance(payload, bool):
        return None
    if isinstance(payload, int):
        return payload
    if isinstance(payload, float) and payload.is_integer():
        return int(payload)
    if isinstance(payload, dict):
        if "traffic_signal" in payload:
            candidate = _find_signal_value(payload["traffic_signal"])
            if candidate is not None:
                return candidate
        if "signal" in payload:
            candidate = _find_signal_value(payload["signal"])
            if candidate is not None:
                return candidate
        for key in ("value", "state", "component", "components", "plant", "data"):
            if key in payload:
                candidate = _find_signal_value(payload[key])
                if candidate is not None:
                    return candidate
    elif isinstance(payload, (list, tuple)):
        for item in payload:
            candidate = _find_signal_value(item)
            if candidate is not None:
                return candidate
    return None


class SignalOutstationApplication(opendnp3.IOutstationApplication):
    """OpenDNP3 application callbacks and the analog input/status update helpers."""

    def __init__(self) -> None:
        super().__init__()
        self.outstation = None
        self._last_state: Optional[int] = None
        self._update_lock = threading.Lock()

    def set_outstation(self, outstation: Any) -> None:
        self.outstation = outstation

    def apply_update(self, measurement: Any, index: int) -> None:
        if self.outstation is None:
            raise RuntimeError("outstation is not initialized")
        builder = asiodnp3.UpdateBuilder()
        builder.Update(measurement, index)
        self.outstation.Apply(builder.Build())

    def update_analog_input(self, value: int) -> None:
        with self._update_lock:
            if self._last_state == value:
                return
            self.apply_update(opendnp3.Analog(float(value)), 0)
            self._last_state = value
            LOG.info("plant state -> DNP3 analog input index=0 value=%d", value)

    def apply_command(self, value: int) -> bool:
        if not HttpPlantAPI.apply_signal(value):
            return False
        with self._update_lock:
            self.apply_update(opendnp3.AnalogOutputStatus(float(value)), 0)
        LOG.info("DNP3 analog output index=0 accepted value=%d", value)
        return True

    # IOutstationApplication: deliberately do not accept remote time/class writes.
    def SupportsWriteAbsoluteTime(self) -> bool:
        return False

    def SupportsWriteTimeAndInterval(self) -> bool:
        return False

    def SupportsAssignClass(self) -> bool:
        return False

    def GetApplicationIIN(self) -> Any:
        iin = opendnp3.ApplicationIIN()
        iin.configCorrupt = False
        iin.deviceTrouble = False
        iin.localControl = False
        iin.needTime = False
        return iin

    def ColdRestartSupport(self) -> Any:
        return opendnp3.RestartMode.UNSUPPORTED

    def WarmRestartSupport(self) -> Any:
        return opendnp3.RestartMode.UNSUPPORTED

    def OnStateChange(self, value: Any) -> None:
        LOG.debug("DNP3 link state changed: %s", value)

    def OnKeepAliveInitiated(self) -> None:
        LOG.debug("DNP3 keepalive initiated")

    def OnKeepAliveFailure(self) -> None:
        LOG.warning("DNP3 keepalive failure")

    def OnKeepAliveSuccess(self) -> None:
        LOG.debug("DNP3 keepalive succeeded")


class SignalCommandHandler(opendnp3.ICommandHandler):
    """Handle the real DNP3 analog-output command (group 41 variation 1), index 0."""

    application: SignalOutstationApplication

    @classmethod
    def create(cls, application: SignalOutstationApplication) -> "SignalCommandHandler":
        # The binding's ICommandHandler trampoline is intentionally constructed
        # without a Python __init__, as in the upstream dnp3-python examples.
        handler = cls()
        handler.application = application
        return handler

    def Start(self) -> None:
        LOG.debug("DNP3 command transaction started")

    def End(self) -> None:
        LOG.debug("DNP3 command transaction ended")

    @staticmethod
    def _validate(command: Any, index: int) -> Optional[int]:
        if index != 0:
            return None
        try:
            value = int(command.value)
        except (AttributeError, TypeError, ValueError):
            return None
        if float(command.value) != value or value not in (0, 1, 2):
            return None
        return value

    def Select(self, command: Any, index: int) -> Any:
        value = self._validate(command, index)
        LOG.info("DNP3 SELECT analog output index=%d value=%r", index, value)
        return opendnp3.CommandStatus.SUCCESS if value is not None else opendnp3.CommandStatus.OUT_OF_RANGE

    def Operate(self, command: Any, index: int, op_type: Any) -> Any:
        value = self._validate(command, index)
        LOG.info("DNP3 OPERATE analog output index=%d value=%r", index, value)
        if value is None:
            return opendnp3.CommandStatus.OUT_OF_RANGE
        if self.application.apply_command(value):
            return opendnp3.CommandStatus.SUCCESS
        return opendnp3.CommandStatus.DOWNSTREAM_FAIL


class ChannelListener(asiodnp3.IChannelListener):
    def __init__(self) -> None:
        super().__init__()

    def OnStateChange(self, state: Any) -> None:
        LOG.info("DNP3 TCP server state: %s", opendnp3.ChannelStateToString(state))


def build_stack() -> Any:
    config = asiodnp3.OutstationStackConfig(opendnp3.DatabaseSizes.AllTypes(2))
    config.outstation.eventBufferConfig = opendnp3.EventBufferConfig().AllTypes(10)
    config.outstation.params.allowUnsolicited = True
    config.link.LocalAddr = LOCAL_ADDR
    config.link.RemoteAddr = MASTER_ADDR
    config.link.KeepAliveTimeout = openpal.TimeDuration().Max()
    # Analog input index 0: group 30 variation 1 (32-bit with flags).
    config.dbConfig.analog[0].clazz = opendnp3.PointClass.Class2
    config.dbConfig.analog[0].svariation = opendnp3.StaticAnalogVariation.Group30Var1
    config.dbConfig.analog[0].evariation = opendnp3.EventAnalogVariation.Group32Var1
    # Analog output status index 0: group 40 variation 1.
    config.dbConfig.aoStatus[0].clazz = opendnp3.PointClass.Class2
    config.dbConfig.aoStatus[0].svariation = opendnp3.StaticAnalogOutputStatusVariation.Group40Var1
    config.dbConfig.aoStatus[0].evariation = opendnp3.EventAnalogOutputStatusVariation.Group42Var1
    return config


def state_poll_loop(application: SignalOutstationApplication, stop: threading.Event) -> None:
    while not stop.wait(POLL_SECONDS):
        value = HttpPlantAPI.read_signal()
        if value is not None:
            try:
                application.update_analog_input(value)
            except Exception:
                LOG.exception("could not publish plant state into DNP3 database")


def run() -> None:
    stop = threading.Event()
    application = SignalOutstationApplication()
    manager = asiodnp3.DNP3Manager(1, asiodnp3.ConsoleLogger().Create())
    listener = ChannelListener()
    retry = asiopal.ChannelRetry().Default()
    channel = manager.AddTCPServer("plant-server", LOG_LEVELS, retry, DNP3_BIND, DNP3_PORT, listener)
    handler = SignalCommandHandler.create(application)
    outstation = channel.AddOutstation("plant-outstation", handler, application, build_stack())
    application.set_outstation(outstation)
    outstation.Enable()
    application.update_analog_input(0)
    LOG.info("real OpenDNP3 outstation listening on %s:%d", DNP3_BIND, DNP3_PORT)
    poller = threading.Thread(target=state_poll_loop, args=(application, stop), name="plant-state-poller", daemon=True)
    poller.start()
    try:
        while not stop.wait(1.0):
            pass
    finally:
        stop.set()
        poller.join(timeout=2.0)
        try:
            manager.Shutdown()
        except Exception:
            LOG.exception("DNP3 manager shutdown failed")
        LOG.info("DNP3 outstation stopped")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    stop = threading.Event()
    # Install handlers that only request shutdown; run() owns the stack lifetime.
    def request_stop(signum: int, _frame: Any) -> None:
        LOG.info("received signal %s; stopping", signum)
        stop.set()

    # Keep the simple entry point compatible with Docker signal delivery.  The
    # local event is not used by run(), so SIGTERM is converted to KeyboardInterrupt.
    signal.signal(signal.SIGTERM, lambda _s, _f: (_ for _ in ()).throw(KeyboardInterrupt()))
    signal.signal(signal.SIGINT, lambda _s, _f: (_ for _ in ()).throw(KeyboardInterrupt()))
    try:
        run()
    except KeyboardInterrupt:
        LOG.info("shutdown requested")


if __name__ == "__main__":
    main()
