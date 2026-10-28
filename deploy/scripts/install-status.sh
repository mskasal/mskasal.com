#!/usr/bin/env bash
# Runs scripts/status.py every 30 seconds with a systemd timer, as the user
# running this script (it needs Docker access). Re-run it after moving the repo.
#
#   scripts/install-status.sh            install or update
#   scripts/install-status.sh --remove   stop and remove the timer
set -euo pipefail
cd "$(dirname "$0")/.."
deploy=$(pwd)
user=$(id -un)
unit=/etc/systemd/system/mskasal-status

if [ "${1:-}" = --remove ]; then
  sudo systemctl disable --now mskasal-status.timer 2>/dev/null || true
  sudo rm -f "$unit.service" "$unit.timer"
  sudo systemctl daemon-reload
  echo "removed mskasal-status"
  exit 0
fi

docker info >/dev/null 2>&1 || { echo "$user can't reach Docker (add it to the docker group)." >&2; exit 1; }
mkdir -p status

sudo tee "$unit.service" >/dev/null <<EOF
[Unit]
Description=mskasal.com status for dashboards (scripts/status.py)
After=docker.service

[Service]
Type=oneshot
User=$user
WorkingDirectory=$deploy
ExecStart=/usr/bin/python3 $deploy/scripts/status.py
EOF

sudo tee "$unit.timer" >/dev/null <<EOF
[Unit]
Description=Refresh mskasal.com status every 30 seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=30s
AccuracySec=1s

[Install]
WantedBy=timers.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now mskasal-status.timer
sudo systemctl start mskasal-status.service
echo "installed: status/status.json refreshes every 30 s"
