#!/usr/bin/env python3
"""
Riftbound Dev Server Launcher

Starts both the backend (ts-node-dev on :3001) and frontend (Vite on :5173)
as background processes and verifies they're healthy before returning.

Usage:
    python3 scripts/start_dev_servers.py        # start both servers
    python3 scripts/start_dev_servers.py --kill  # kill all dev servers
    python3 scripts/start_dev_servers.py --status # check if running
"""
import argparse
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BACKEND_DIR = Path(__file__).parent.parent / "backend"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
BACKEND_PORT = 3001
FRONTEND_PORT = 5173
HEALTH_RETRIES = 40
HEALTH_DELAY = 2  # seconds between retries


def kill_servers():
    """Kill any running ts-node-dev and vite processes."""
    for proc in ("ts-node-dev", "vite"):
        subprocess.run(["pkill", "-f", proc], stderr=subprocess.DEVNULL)
    print("[+] Servers stopped.")


def check_health(url: str) -> bool:
    """Return True if the URL returns HTTP 200."""
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


def wait_for(url: str, retries: int = HEALTH_RETRIES, delay: int = HEALTH_DELAY) -> bool:
    """Poll url until it responds, up to `retries` attempts."""
    for i in range(1, retries + 1):
        if check_health(url):
            return True
        if i < retries:
            time.sleep(delay)
    return False


def start_backend(log_bufsize: int = 1):
    """Spawn ts-node-dev in background, return True once backend/:3001 is healthy."""
    print(f"[*] Starting backend (ts-node-dev) on port {BACKEND_PORT} ...")
    log_file = open(BACKEND_DIR / "dev.log", "w", buffering=log_bufsize)
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(BACKEND_DIR),
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    print(f"    PID={proc.pid}  log=backend/dev.log")

    backend_ready = wait_for(f"http://localhost:{BACKEND_PORT}/health")
    if backend_ready:
        print(f"[+] Backend healthy on port {BACKEND_PORT}")
    else:
        print(f"[!] Backend failed to start — see backend/dev.log")
        _tail_log(BACKEND_DIR / "dev.log")
        sys.exit(1)
    return proc


def start_frontend(log_bufsize: int = 1):
    """Spawn Vite in background, return True once frontend/:5173 is healthy."""
    print(f"[*] Starting frontend (Vite) on port {FRONTEND_PORT} ...")
    log_file = open(FRONTEND_DIR / "dev.log", "w", buffering=log_bufsize)
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND_DIR),
        stdout=log_file,
        stderr=subprocess.STDOUT,
    )
    print(f"    PID={proc.pid}  log=frontend/dev.log")

    frontend_ready = wait_for(f"http://localhost:{FRONTEND_PORT}/")
    if frontend_ready:
        print(f"[+] Frontend healthy on port {FRONTEND_PORT}")
    else:
        print(f"[!] Frontend failed to start — see frontend/dev.log")
        _tail_log(FRONTEND_DIR / "dev.log")
        sys.exit(1)
    return proc


def _tail_log(path: Path, lines: int = 30):
    """Print the last `lines` of a log file."""
    print(f"\n--- tail {lines} {path} ---")
    try:
        with open(path) as f:
            content = f.read()
            tail = "\n".join(content.strip().splitlines()[-lines:])
            print(tail or "(empty)")
    except FileNotFoundError:
        print("(log file not found)")


def main():
    parser = argparse.ArgumentParser(description="Riftbound dev server launcher")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--kill", action="store_true", help="Kill running dev servers and exit")
    group.add_argument("--status", action="store_true", help="Check if servers are running and exit")
    args = parser.parse_args()

    if args.kill:
        kill_servers()
        return

    if args.status:
        b = check_health(f"http://localhost:{BACKEND_PORT}/health")
        f = check_health(f"http://localhost:{FRONTEND_PORT}/")
        print(f"Backend :{BACKEND_PORT}  {'✓ alive' if b else '✗ down'}")
        print(f"Frontend:{FRONTEND_PORT}  {'✓ alive' if f else '✗ down'}")
        sys.exit(0 if (b and f) else 1)

    # ── Start sequence ─────────────────────────────────────────────────────────
    print("=== Riftbound Dev Server Launcher ===\n")
    kill_servers()
    time.sleep(1)

    start_backend()
    start_frontend()

    print("\n=== Ready ===")
    print(f"  Frontend:  http://localhost:{FRONTEND_PORT}")
    print(f"  Backend:   http://localhost:{BACKEND_PORT}")
    print(f"\n  Logs:  backend/dev.log  frontend/dev.log")


if __name__ == "__main__":
    main()
