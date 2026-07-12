#!/bin/sh
set -eu
if [ -x .venv/bin/python ]; then exec .venv/bin/python -m unittest discover -s tests -v; fi
exec python3 -m unittest discover -s tests -v
