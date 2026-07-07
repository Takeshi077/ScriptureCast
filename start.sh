#!/usr/bin/env bash
set -e

echo "=== Installing Python dependencies ==="
pip install -r backend/requirements.txt

echo "=== Setting up data directories ==="
mkdir -p data/embeddings
mkdir -p frontend/downloads
mkdir -p frontend/images

echo "=== Checking Bible database ==="
if [ ! -f data/bible.db ]; then
    echo "  bible.db not found — attempting to import..."
    if [ -f data/import_bible.py ]; then
        python data/import_bible.py
    else
        echo "  WARNING: No import script found. bible.db must be provided."
    fi
fi

echo "=== Build complete ==="
