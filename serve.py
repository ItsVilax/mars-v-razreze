#!/usr/bin/env python3
"""Локальный сервер для атласа «Марс в разрезе».

Браузер не разрешает fetch локальных файлов через file://, поэтому проект
запускается так:

    python serve.py

Скрипт поднимает HTTP-сервер только на 127.0.0.1 и открывает браузер.
"""
from __future__ import annotations

import os
import socket
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
HOST = "127.0.0.1"
DEFAULT_PORT = 8000


class AtlasHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".img": "application/octet-stream",
        ".lbl": "text/plain; charset=utf-8",
        ".xml": "application/xml; charset=utf-8",
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Keep the console readable: only report errors.
        if args and str(args[0]).startswith(("4", "5")):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


def make_server(port: int) -> ThreadingHTTPServer:
    try:
        return ThreadingHTTPServer((HOST, port), AtlasHandler)
    except OSError:
        if port != 0:
            return make_server(0)
        raise


def main() -> int:
    os.chdir(ROOT)
    port = DEFAULT_PORT
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            print(f"Не понимаю порт {sys.argv[1]!r}; использую {DEFAULT_PORT}.")
    httpd = make_server(port)
    actual = httpd.server_address[1]
    url = f"http://{HOST}:{actual}/"
    print("=" * 64)
    print("  МАРС В РАЗРЕЗЕ · интерактивный 3D-атлас")
    print("=" * 64)
    print(f"  Открываю: {url}")
    print("  Остановить сервер: Ctrl+C в этом окне.")
    print("=" * 64)
    threading.Timer(0.45, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
