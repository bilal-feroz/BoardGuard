#!/usr/bin/env bash
# Deploy BoardGuard to one Amazon Lightsail instance: the same FastAPI + OpenCV 5 service, serving the
# static workstation UI on port 80. For accounts where Lambda/CloudFormation are not available (for
# example sandbox accounts whose service control policies deny them); otherwise prefer deploy-zip.sh.
#
# The instance's launch script builds the pushed commit from the public repository, so nothing but
# the launch script leaves this machine and no credentials are placed on the instance.
#
# Prerequisites: AWS CLI v2 with credentials, curl; the current commit pushed to the repository.
# Usage: bash infrastructure/aws/lightsail/deploy-lightsail.sh [name] [region] [bundle]
set -euo pipefail

NAME="${1:-boardguard}"
REGION="${2:-${AWS_REGION:-us-east-1}}"
BUNDLE="${3:-small_3_0}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
REPO="${BOARDGUARD_REPO:-https://github.com/bilal-feroz/BoardGuard.git}"
SHA="$(git -C "$ROOT" rev-parse HEAD)"
OUT="$ROOT/dist/lightsail"
winpath() { command -v cygpath >/dev/null && cygpath -w "$1" || echo "$1"; }

git -C "$ROOT" fetch -q origin
git -C "$ROOT" branch -r --contains "$SHA" | grep -q . || { echo "Commit ${SHA} is not pushed; push it first." >&2; exit 1; }
echo "==> Region ${REGION}, instance ${NAME} (${BUNDLE}), commit ${SHA:0:7}"

mkdir -p "$OUT"
sed -e "s|__REPO__|${REPO}|" -e "s|__GIT_SHA__|${SHA}|g" -e "s|__REGION__|${REGION}|" -e "s|__BUNDLE__|${BUNDLE}|" \
  "$HERE/user-data.sh" > "$OUT/user-data.sh"
aws lightsail create-instances --region "$REGION" --instance-names "$NAME" --availability-zone "${REGION}a" \
  --blueprint-id ubuntu_24_04 --bundle-id "$BUNDLE" --user-data "file://$(winpath "$OUT/user-data.sh")" \
  --tags key=project,value=boardguard >/dev/null
until [ "$(aws lightsail get-instance-state --region "$REGION" --instance-name "$NAME" --query state.name --output text)" = "running" ]; do sleep 5; done
IP="$(aws lightsail get-instance --region "$REGION" --instance-name "$NAME" --query instance.publicIpAddress --output text)"

echo "==> Instance running at ${IP}; waiting for http://${IP}/api/health (first boot builds the release, ~10 min)"
for _ in $(seq 1 120); do
  if curl -sf -m 5 "http://${IP}/api/health" >/dev/null; then
    echo "==> Deployed: http://${IP}/"
    echo "==> Verify:   bash infrastructure/aws/lightsail/verify-lightsail.sh http://${IP} ${NAME} ${REGION}"
    exit 0
  fi
  sleep 10
done
echo "Instance is running but the service did not answer yet; check it with: aws lightsail get-instance --instance-name ${NAME}" >&2
exit 1
