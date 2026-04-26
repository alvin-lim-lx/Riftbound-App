#!/usr/bin/env python3
"""
Riftbound Dev Server Manager

Starts both backend (port 3001) and frontend (port 5173) dev servers
as background processes with proper health checks.

Usage:
    python3 scripts/start_dev_servers.py        # start both servers
    python3 scripts/start_dev_servers.py --kill # stop all dev servers
    python3 scripts/start_dev_servers.py --status  # check health
"""

import subprocess
import time
import sys
import os
import signal
import re
from pathlib import Path

ROOT = Path("/home/panda/riftbound")
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
LOG_DIR = ROOT / ".dev_logs"
LOG_DIR.mkdir(exist_ok=True)

BACKEND_LOG = LOG_DIR / "backend.log"
FRONTEND_LOG = LOG_DIR / "frontend.log"

BACKEND_PORT = 3001
FRONTEND_PORT = 5173


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, capture=True, timeout=30):
    r = subprocess.run(
        cmd, shell=True, capture_output=capture, text=True, timeout=timeout
    )
    return r.stdout.strip() if capture else r.returncode == 0


def kill_all():
    """Kill all ts-node-dev and vite processes."""
    log("Killing existing dev servers...")
    for pattern in ["ts-node-dev", "vite", "GameServer"]:
        run(f"pkill -9 -f '{pattern}' 2>/dev/null || true")
    # Also kill anything holding the ports
    run(f"fuser -k {BACKEND_PORT}/tcp 2>/dev/null || true")
    run(f"fuser -k {FRONTEND_PORT}/tcp 2>/dev/null || true")
    time.sleep(2)
    log("All servers stopped.")


def is_port_open(port, host="localhost"):
    """Check if a port is accepting connections."""
    import socket
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def is_tailscale_running():
    """Check if tailscaled is running and connected to the tailnet."""
    try:
        r = subprocess.run(
            ["~/bin/tailscale", "status"],
            shell=True, capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0 and "100." in r.stdout:
            return True, r.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        pass
    return False, None


def get_tailscale_ip():
    """Get the Tailscale IP of this machine, or None."""
    try:
        r = subprocess.run(
            ["~/bin/tailscale", "status", "--json"],
            shell=True, capture_output=True, text=True, timeout=5
        )
        if r.returncode == 0:
            import json
            d = json.loads(r.stdout)
            return d.get("Self", {}).get("TailscaleIPs", [None])[0]
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError, json.JSONDecodeError):
        pass
    return None


def wait_for_backend(timeout=60):
    """Wait for backend to be healthy."""
    log(f"Waiting for backend (port {BACKEND_PORT}) to be ready...")
    start = time.time()
    while time.time() - start < timeout:
        if is_port_open(BACKEND_PORT):
            log(f"Backend is up on port {BACKEND_PORT}")
            return True
        time.sleep(2)
    log(f"TIMEOUT: Backend did not start within {timeout}s")
    return False


def start_backend():
    """Start the backend dev server."""
    log("Starting backend...")
    # Redirect output to log file
    stdout_f = open(BACKEND_LOG, "w")
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(BACKEND_DIR),
        stdout=stdout_f,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,  # new process group for clean kill
    )
    return proc


def start_frontend():
    """Start the frontend dev server."""
    log("Starting frontend...")
    stdout_f = open(FRONTEND_LOG, "w")
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(FRONTEND_DIR),
        stdout=stdout_f,
        stderr=subprocess.STDOUT,
        preexec_fn=os.setsid,
    )
    return proc


def check_status():
    """Check health of both servers and Tailscale network."""
    ts_ok, ts_output = is_tailscale_running()
    ts_ip = get_tailscale_ip() if ts_ok else None

    backend_ok = is_port_open(BACKEND_PORT)
    frontend_ok = is_port_open(FRONTEND_PORT)

    print()
    if ts_ok:
        log(f"Tailscale:  RUNNING ({ts_ip})")
    else:
        log("Tailscale:  DOWN — Windows/mobile cannot reach dev servers")

    if backend_ok:
        log(f"Backend  (port {BACKEND_PORT}): RUNNING")
    else:
        log(f"Backend  (port {BACKEND_PORT}): DOWN")

    if frontend_ok:
        log(f"Frontend (port {FRONTEND_PORT}): RUNNING")
    else:
        log(f"Frontend (port {FRONTEND_PORT}): DOWN")

    print()
    if ts_ok and backend_ok and frontend_ok:
        log("All services healthy.")
        log(f"  Local:    http://localhost:{FRONTEND_PORT} / http://localhost:{BACKEND_PORT}")
        log(f"  Network:   http://{ts_ip}:{FRONTEND_PORT} / http://{ts_ip}:{BACKEND_PORT}")
        return True
    else:
        missing = []
        if not ts_ok: missing.append("Tailscale")
        if not backend_ok: missing.append("Backend")
        if not frontend_ok: missing.append("Frontend")
        log(f"Missing: {', '.join(missing)}")
        return False


def main():
    if len(sys.argv) > 1:
        arg = sys.argv[1]
        if arg in ("--kill", "-k"):
            kill_all()
            return
        elif arg in ("--status", "-s"):
            check_status()
            return
        elif arg in ("--help", "-h"):
            print(__doc__)
            return

    log("=" * 50)
    log("Riftbound Dev Server Manager")
    log("=" * 50)

    # Pre-flight: check and start Tailscale if needed
    ts_ok, _ = is_tailscale_running()
    if ts_ok:
        ts_ip = get_tailscale_ip()
        log(f"Tailscale: RUNNING at {ts_ip}")
    else:
        log("Tailscale is not running. Starting it...")
        run("sudo mkdir -p /var/run/tailscale && sudo chown $(whoami):$(whoami) /var/run/tailscale 2>/dev/null || true")
        run("mkdir -p ~/.local/share/tailscale")
        # Start daemon in background
        run("~/bin/tailscaled --tun=userspace-networking &")
        time.sleep(4)
        # Authenticate with stored key (key is provisioned once; Tailscale stores session for auto-reconnect)
        TAILSCALE_AUTHKEY = os.environ.get("TAILSCALE_AUTHKEY", "<key>")
        up_result = run(f"~/bin/tailscale up --authkey={TAILSCALE_AUTHKEY} 2>&1 || true")
        ts_ok2, _ = is_tailscale_running()
        if ts_ok2:
            ts_ip = get_tailscale_ip()
            log(f"Tailscale: RUNNING at {ts_ip}")
        else:
            log("WARNING: Tailscale started but not connected. Network access may be unavailable.")
            log("  If authentication is needed, set the TAILSCALE_AUTHKEY env var or run:")
            log("  ~/bin/tailscale up --authkey=<your-auth-key>")

    # Kill existing
    kill_all()

    # Start backend first
    backend_proc = start_backend()

    # Wait for backend to be healthy
    if not wait_for_backend(timeout=90):
        log("FAILED: Backend did not start. Check logs:")
        log(f"  tail -f {BACKEND_LOG}")
        # Kill backend on failure
        try:
            os.killpg(os.getpgid(backend_proc.pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        sys.exit(1)

    # Small buffer
    time.sleep(2)

    # Start frontend
    frontend_proc = start_frontend()

    # Wait for frontend
    time.sleep(5)
    if is_port_open(FRONTEND_PORT):
        log(f"Frontend is up on port {FRONTEND_PORT}")
    else:
        log(f"WARNING: Frontend may not be ready yet. Check:")
        log(f"  tail -f {FRONTEND_LOG}")

    print()
    log("=" * 50)
    log("Servers started:")
    log(f"  Backend:  http://localhost:{BACKEND_PORT}")
    log(f"  Frontend: http://localhost:{FRONTEND_PORT}")
    ts_ip = get_tailscale_ip()
    if ts_ip:
        log(f"  Network:  http://{ts_ip}:{FRONTEND_PORT} / http://{ts_ip}:{BACKEND_PORT}")
    log(f"  Logs:     {LOG_DIR}/")
    log("=" * 50)
    log("To stop: python3 scripts/start_dev_servers.py --kill")


if __name__ == "__main__":
    main()
