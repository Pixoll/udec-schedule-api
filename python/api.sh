#!/bin/bash

set -e
cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null
source .venv/bin/activate
pip install -r requirements.txt
python3 python/api.py
