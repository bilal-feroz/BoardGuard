#!/bin/bash
# Lightsail launch script (rendered by deploy-lightsail.sh): builds BoardGuard from the public
# repository at a pinned commit (FastAPI + OpenCV 5 + static workstation UI) and runs it under
# systemd on port 80. No credentials are needed on the instance.
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive HOME=/root
REPO="__REPO__"
SHA="__GIT_SHA__"

# Headroom for the UI build on small bundles.
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile; fi
apt-get update -y
apt-get install -y python3-venv git curl xz-utils

# Node.js 22 LTS from nodejs.org, checksum-verified (only needed to build the static UI).
cd /tmp
DIST="https://nodejs.org/dist/latest-v22.x"
curl -fsSL "$DIST/SHASUMS256.txt" -o SHASUMS256.txt
NODE_TAR="$(grep -o 'node-v22[0-9.]*-linux-x64.tar.xz' SHASUMS256.txt | head -n 1)"
curl -fsSL "$DIST/$NODE_TAR" -o "$NODE_TAR"
grep " $NODE_TAR\$" SHASUMS256.txt | sha256sum -c -
tar -xJf "$NODE_TAR" -C /usr/local --strip-components=1

mkdir -p /opt/boardguard /var/lib/boardguard
git clone --filter=blob:none "$REPO" /opt/boardguard/src
cd /opt/boardguard/src
git checkout "$SHA"

(cd apps/web && npm ci --no-audit --no-fund && rm -f .env.production.local && NEXT_PUBLIC_API_BASE="" npx next build)

python3 -m venv /opt/boardguard/venv
grep -vE '^(boto3|mangum)==' services/vision-api/requirements.txt > /opt/boardguard/requirements.txt
/opt/boardguard/venv/bin/pip install --no-cache-dir -r /opt/boardguard/requirements.txt

id boardguard || useradd --system --home-dir /opt/boardguard --shell /usr/sbin/nologin boardguard
chown -R boardguard /var/lib/boardguard

cat > /etc/systemd/system/boardguard.service <<'UNIT'
[Unit]
Description=BoardGuard vision API and workstation UI
After=network-online.target
Wants=network-online.target

[Service]
User=boardguard
WorkingDirectory=/opt/boardguard/src/services/vision-api
Environment=BOARDGUARD_ENV=aws-lightsail
Environment=AWS_REGION=__REGION__
Environment=BOARDGUARD_LIGHTSAIL_BUNDLE=__BUNDLE__
Environment=BOARDGUARD_GIT_SHA=__GIT_SHA__
Environment=BOARDGUARD_STATIC_DIR=/opt/boardguard/src/apps/web/out
Environment=BOARDGUARD_FIXTURES_DIR=/opt/boardguard/src/datasets/fixtures
Environment=BOARDGUARD_DATA_DIR=/var/lib/boardguard
Environment=BOARDGUARD_RATE_PER_MIN=60
AmbientCapabilities=CAP_NET_BIND_SERVICE
ExecStart=/opt/boardguard/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 80 --workers 2
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now boardguard
