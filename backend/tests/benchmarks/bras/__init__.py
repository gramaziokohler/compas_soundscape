"""BRAS RS2 benchmark of the PFFDTD pipeline (see README.md)."""
import sys

# The engines run in-process here, not in a worker: print UTF-8 as the workers do
# (workers/_subprocess_common.py), or a warning such as "Direct sound blocked: 'LS4' → 'MP4'"
# fails the whole compas_acoustics run when the output goes to a cp1252 log file.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")

# The repository's .env.local / .env, as the app and the workers load them (main.py), before any
# project module reads its settings: PFFDTD_PYTHON (the compas-pffdtd env) comes from there.
from dotenv import find_dotenv, load_dotenv

_env_local = find_dotenv(".env.local", raise_error_if_not_found=False, usecwd=False)
_env = find_dotenv(".env", raise_error_if_not_found=False, usecwd=False)
if _env_local:
    load_dotenv(_env_local, override=False)   # a variable set in the shell still wins
if _env:
    load_dotenv(_env)
