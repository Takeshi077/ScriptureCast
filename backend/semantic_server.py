#!/usr/bin/env python3
"""Local semantic search server for ScriptureCast Tauri app.
Usage: python semantic_server.py [port]

Returns TF-IDF search results via HTTP POST at /search.
Optionally uses sentence-transformers for re-ranking if installed.
"""
import json
import http.server
import sys
import os
import socket

# Ensure backend dir is on path
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from semantic import ensure_embeddings, search_similar_verses

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9876


def find_free_port(start=9876, max_attempts=100):
    for port in range(start, start + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port
    return start


class SemanticHandler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path == '/search':
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            try:
                params = json.loads(body)
                results = search_similar_verses(
                    params.get('query', ''),
                    translation=params.get('translation'),
                    context_book=params.get('context_book'),
                    context_chapter=params.get('context_chapter'),
                    top_k=params.get('top_k', 5),
                )
                self._json(200, results)
            except Exception as e:
                self._json(500, {'error': str(e)})
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {'ok': True})
        else:
            self.send_response(404)
            self.end_headers()

    def _json(self, status, data):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        if os.environ.get('SEMANTIC_DEBUG'):
            super().log_message(format, *args)


if __name__ == '__main__':
    port = find_free_port(PORT)
    print(f'Initializing semantic search index...')
    ensure_embeddings()
    server = http.server.HTTPServer(('127.0.0.1', port), SemanticHandler)
    print(f'SEMANTIC_READY:{port}')
    sys.stdout.flush()
    server.serve_forever()
