import socket

for host, port in (("127.0.0.1", 502), ("127.0.0.1", 4840), ("127.0.0.1", 20000),
                   ("plant", 502), ("plant", 4840), ("plant", 20000)):
    try:
        with socket.create_connection((host, port), timeout=2):
            print(host, port, "OPEN", flush=True)
    except OSError as exc:
        print(host, port, type(exc).__name__, str(exc), flush=True)
