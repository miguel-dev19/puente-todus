#!/bin/bash
gunicorn -w 1 -b 0.0.0.0:10000 app:app --daemon
python puente.py
