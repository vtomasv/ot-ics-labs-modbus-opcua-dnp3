import sys
import urllib.request

port = 8100 if len(sys.argv) > 1 and sys.argv[1] == "trainer" else 8000
path = "/health" if port == 8100 else "/api/health"
with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=3) as response:
    if response.status != 200:
        raise SystemExit(1)
