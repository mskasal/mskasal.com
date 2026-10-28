#!/usr/bin/env python3
"""Writes status/status.json and status/metrics.txt for dashboards.

Caddy serves them on STATUS_BIND:8090 (/status and /metrics). Run it every
30 seconds; scripts/install-status.sh sets up a systemd timer for that.

    scripts/status.py

Reads only: docker, /proc, /sys and the two public health URLs. Writes no
secrets: nothing from .env except the domains and the SITE/RESUME switches.
"""
import json
import os
import platform
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEPLOY = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(DEPLOY, "status")
# apt is slow to ask; its answer changes rarely.
UPDATES_EVERY_S = 6 * 3600


def env():
    values = {}
    with open(os.path.join(DEPLOY, ".env")) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values[key] = value
    return values


def run(*args):
    return subprocess.run(args, cwd=DEPLOY, capture_output=True, text=True, timeout=20).stdout


def fetch(url, timeout=5):
    # Cloudflare answers 403 to Python's default User-Agent.
    req = urllib.request.Request(url, headers={"User-Agent": "mskasal-status/1"})
    start = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body, code = r.read(4096), r.status
    except urllib.error.HTTPError as e:
        body, code = b"", e.code
    except Exception:
        return {"ok": False, "http": None, "latency_ms": None}, b""
    latency = round((time.monotonic() - start) * 1000)
    return {"ok": code == 200, "http": code, "latency_ms": latency}, body


def read(path, default=None):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def services():
    rows = [json.loads(line) for line in run("docker", "compose", "ps", "-a", "--format", "json").splitlines() if line.strip()]
    if not rows:
        return [], None
    inspected = json.loads(run("docker", "inspect", *[r["ID"] for r in rows]) or "[]")
    now = datetime.now(timezone.utc)
    out, tunnel_ip = [], None
    for c in sorted(inspected, key=lambda c: c["Config"]["Labels"].get("com.docker.compose.service", "")):
        name = c["Config"]["Labels"].get("com.docker.compose.service", c["Name"].lstrip("/"))
        state = c["State"]
        started = datetime.fromisoformat(state["StartedAt"][:26].rstrip("Z") + "+00:00") if state["Running"] else None
        used = read(f"/sys/fs/cgroup/system.slice/docker-{c['Id']}.scope/memory.current")
        limit = c["HostConfig"].get("Memory") or 0
        out.append({
            "name": name,
            "state": state["Status"],
            "health": (state.get("Health") or {}).get("Status"),
            "uptime_s": int((now - started).total_seconds()) if started else 0,
            "restarts": c["RestartCount"],
            "memory_mb": round(int(used) / 2**20, 1) if used else None,
            "memory_limit_mb": round(limit / 2**20) if limit else None,
        })
        if name == "cloudflared":
            tunnel_ip = next((n["IPAddress"] for n in c["NetworkSettings"]["Networks"].values() if n["IPAddress"]), None)
    return out, tunnel_ip


def tunnel(ip):
    if not ip:
        return {"connected": False, "connections": 0}
    _, body = fetch(f"http://{ip}:20241/ready", timeout=3)
    try:
        n = json.loads(body).get("readyConnections", 0)
    except ValueError:
        n = 0
    return {"connected": n > 0, "connections": n}


def updates_pending():
    cache = os.path.join(OUT, ".updates")
    try:
        if time.time() - os.path.getmtime(cache) < UPDATES_EVERY_S:
            return int(read(cache))
    except (OSError, TypeError, ValueError):
        pass
    try:
        n = sum(1 for line in run("apt-get", "-s", "-o", "Debug::NoLocking=1", "upgrade").splitlines() if line.startswith("Inst "))
    except (OSError, subprocess.SubprocessError):
        return None
    with open(cache, "w") as f:
        f.write(str(n))
    return n


def host():
    mem = {}
    for line in (read("/proc/meminfo") or "").splitlines():
        key, value = line.split(":", 1)
        mem[key] = int(value.split()[0]) // 1024
    disk = shutil.disk_usage("/")
    temp = read("/sys/class/thermal/thermal_zone0/temp")
    return {
        "model": (read("/proc/device-tree/model") or platform.machine()).rstrip("\x00"),
        "temp_c": round(int(temp) / 1000, 1) if temp else None,
        "load": [round(x, 2) for x in os.getloadavg()],
        "memory_mb": {"used": mem.get("MemTotal", 0) - mem.get("MemAvailable", 0), "total": mem.get("MemTotal", 0)},
        "swap_mb": {"used": mem.get("SwapTotal", 0) - mem.get("SwapFree", 0), "total": mem.get("SwapTotal", 0)},
        "disk_gb": {"used": round(disk.used / 1e9, 1), "total": round(disk.total / 1e9, 1)},
        "uptime_s": int(float((read("/proc/uptime") or "0").split()[0])),
        "kernel": platform.release(),
        "updates_pending": updates_pending(),
    }


def overall(public, tunnel_state, svc, h):
    if not tunnel_state["connected"] or not all(p["ok"] for p in public.values()):
        return "down"
    unhealthy = any(s["state"] != "running" or s["health"] not in (None, "healthy") for s in svc)
    near_limit = any(s["memory_limit_mb"] and s["memory_mb"] and s["memory_mb"] > 0.9 * s["memory_limit_mb"] for s in svc)
    hot = h["temp_c"] is not None and h["temp_c"] >= 80
    return "degraded" if unhealthy or near_limit or hot else "ok"


def metrics(status):
    # Prometheus wants each family's samples together, after its HELP/TYPE.
    families = {}

    def add(name, value, help_, labels=""):
        if value is None:
            return
        families.setdefault(name, (help_, []))[1].append(f"{name}{labels} {value}")

    add("mskasal_up", {"ok": 1, "degraded": 1, "down": 0}[status["overall"]], "1 unless the overall status is down")
    add("mskasal_degraded", int(status["overall"] == "degraded"), "1 when something is unhealthy but the sites answer")
    for host_, p in status["public"].items():
        add("mskasal_public_ok", int(p["ok"]), "Public health URL answers 200", f'{{host="{host_}"}}')
        add("mskasal_public_latency_ms", p["latency_ms"], "Public health URL latency", f'{{host="{host_}"}}')
    add("mskasal_tunnel_connections", status["tunnel"]["connections"], "Cloudflare Tunnel connections")
    for s in status["services"]:
        l = f'{{service="{s["name"]}"}}'
        add("mskasal_service_running", int(s["state"] == "running"), "Container is running", l)
        add("mskasal_service_healthy", None if s["health"] is None else int(s["health"] == "healthy"), "Container health check passes", l)
        add("mskasal_service_restarts", s["restarts"], "Container restarts", l)
        add("mskasal_service_memory_mb", s["memory_mb"], "Container memory use", l)
        add("mskasal_service_memory_limit_mb", s["memory_limit_mb"], "Container memory limit", l)
    h = status["host"]
    add("mskasal_host_temp_c", h["temp_c"], "SoC temperature")
    for i, period in enumerate(("1m", "5m", "15m")):
        add("mskasal_host_load", h["load"][i], "Load average", f'{{period="{period}"}}')
    add("mskasal_host_memory_used_mb", h["memory_mb"]["used"], "Memory in use")
    add("mskasal_host_memory_total_mb", h["memory_mb"]["total"], "Memory total")
    add("mskasal_host_swap_used_mb", h["swap_mb"]["used"], "Swap in use")
    add("mskasal_host_disk_used_gb", h["disk_gb"]["used"], "Root disk in use")
    add("mskasal_host_uptime_s", h["uptime_s"], "Host uptime")
    add("mskasal_host_updates_pending", h["updates_pending"], "Packages with updates")
    lines = []
    for name, (help_, samples) in families.items():
        lines += [f"# HELP {name} {help_}", f"# TYPE {name} gauge", *samples]
    return "\n".join(lines) + "\n"


def write(name, text):
    tmp = os.path.join(OUT, f".{name}.tmp")
    with open(tmp, "w") as f:
        f.write(text)
    os.chmod(tmp, 0o644)
    os.replace(tmp, os.path.join(OUT, name))


def main():
    os.makedirs(OUT, exist_ok=True)
    e = env()
    public = {}
    for domain, path in ((e.get("PUBLIC_DOMAIN"), "/healthz"), (e.get("ADMIN_DOMAIN"), "/api/health")):
        if domain:
            public[domain], _ = fetch(f"https://{domain}{path}")
    svc, tunnel_ip = services()
    tunnel_state = tunnel(tunnel_ip)
    h = host()
    status = {
        "generated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "overall": overall(public, tunnel_state, svc, h),
        "site_mode": {"site": e.get("SITE", "on") or "on", "resume": e.get("RESUME", "on") or "on"},
        "public": public,
        "tunnel": tunnel_state,
        "services": svc,
        "host": h,
    }
    write("status.json", json.dumps(status, indent=2) + "\n")
    write("metrics.txt", metrics(status))


if __name__ == "__main__":
    main()
