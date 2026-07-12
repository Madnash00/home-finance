#!/bin/sh
set -eu
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
mkdir -p data
echo "Installazione completata. Avvia con ./start.sh"
