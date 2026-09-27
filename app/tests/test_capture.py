import socket
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import dpkt
from app import capture
from scripts.capture_sensor import PCAP_HEADER, is_ot_tcp_frame


class CaptureTest(unittest.TestCase):
    def test_modbus_request_and_fragment(self):
        adu = struct.pack('>HHHBBHH', 24, 0, 6, 1, 6, 2, 85)
        self.assertIn('FC06', capture.describe_payload('Modbus/TCP', adu, True))
        self.assertIn('registro=2 valor=85', capture.describe_payload('Modbus/TCP', adu, True))
        self.assertIn('fragmentada', capture.describe_payload('Modbus/TCP', adu[:9], True))

    def test_opcua_does_not_claim_to_decode_write(self):
        message = b'MSGF' + (18).to_bytes(4, 'little') + b'0123456789'
        summary = capture.describe_payload('OPC UA', message, True)
        self.assertIn('servicio no decodificado', summary)
        self.assertNotIn('Write', summary)

    def test_read_only_real_pcap(self):
        payload = struct.pack('>HHHBBHH', 24, 0, 6, 1, 6, 2, 85)
        tcp = dpkt.tcp.TCP(sport=49000, dport=502, data=payload)
        tcp.off = 5
        ip = dpkt.ip.IP(src=socket.inet_aton('10.1.1.2'), dst=socket.inet_aton('10.1.1.3'), p=6, data=tcp)
        ip.len = len(ip)
        eth = dpkt.ethernet.Ethernet(src=b'\x00' * 6, dst=b'\x01' * 6,
                                    type=dpkt.ethernet.ETH_TYPE_IP, data=ip)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'live.pcap0'
            with path.open('wb') as stream:
                writer = dpkt.pcap.Writer(stream)
                writer.writepkt(bytes(eth), ts=1720000000.0)
                writer.close()
            with patch.object(capture, 'CAPTURE_DIR', Path(directory)):
                result = capture.read_packets()
        self.assertTrue(result['available'])
        self.assertEqual(len(result['packets']), 1)
        packet = result['packets'][0]
        self.assertEqual(packet['src'], '10.1.1.2')
        self.assertEqual(packet['dst_port'], 502)
        self.assertIn('FC06', packet['summary'])
        self.assertEqual(packet['hex'], payload.hex(' ').upper())
        self.assertIn('PCAP REAL', packet['evidence'])

    def test_fallback_filters_only_ot_tcp(self):
        tcp = dpkt.tcp.TCP(sport=49000, dport=502, data=b'\x00')
        tcp.off = 5
        ip = dpkt.ip.IP(src=socket.inet_aton('10.1.1.2'), dst=socket.inet_aton('10.1.1.3'), p=6, data=tcp)
        ip.len = len(ip)
        eth = dpkt.ethernet.Ethernet(src=b'\x00' * 6, dst=b'\x01' * 6,
                                    type=dpkt.ethernet.ETH_TYPE_IP, data=ip)
        self.assertTrue(is_ot_tcp_frame(bytes(eth)))
        tcp.dport = 80
        self.assertFalse(is_ot_tcp_frame(bytes(eth)))
        self.assertFalse(is_ot_tcp_frame(b'\x00' * 8))
        self.assertEqual(len(PCAP_HEADER), 24)


if __name__ == '__main__':
    unittest.main()
