#!/usr/bin/env bash
# Collect runtime proof from the Lightsail deployment: instance description, health, runtime identity
# (environment, OpenCV build, instance metadata) and a real OpenCV processing request with timing.
# Writes docs/evaluation/aws-proof.md.
#
# Usage: bash infrastructure/aws/lightsail/verify-lightsail.sh <http://ip> [name] [region]
set -euo pipefail
URL="${1:?usage: verify-lightsail.sh <http://ip> [name] [region]}"
NAME="${2:-boardguard}"
REGION="${3:-${AWS_REGION:-us-east-1}}"
URL="${URL%/}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="$ROOT/docs/evaluation/aws-proof.md"
FIXTURE="$(ls "$ROOT"/datasets/fixtures/images/*.jpg | head -n 1)"
TMP="$(mktemp)"
PY="$(command -v python3 || command -v python)"

{
  echo "# AWS runtime proof (Amazon Lightsail)"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) against \`${URL}\` (instance \`${NAME}\`, region \`${REGION}\`)."
  echo
  echo "## Instance (aws lightsail get-instance)"
  echo '```'
  aws lightsail get-instance --region "$REGION" --instance-name "$NAME" \
    --query 'instance.{name:name,state:state.name,blueprint:blueprintId,bundle:bundleId,zone:location.availabilityZone,publicIp:publicIpAddress,created:createdAt,cpus:hardware.cpuCount,ramGb:hardware.ramSizeInGb}' --output table
  echo '```'
  echo "## GET /api/health"
  echo '```json'
  curl -sS "${URL}/api/health"
  echo
  echo '```'
  echo "## GET /api/runtime"
  echo '```json'
  curl -sS "${URL}/api/runtime" | "$PY" -m json.tool
  echo '```'
  echo "## POST /api/vision/quality ($(basename "$FIXTURE"))"
  echo '```'
  curl -sS -o "$TMP" -D - -w "\ncurl total time: %{time_total}s\n" -F "file=@${FIXTURE}" "${URL}/api/vision/quality" | grep -iE "^(HTTP|x-boardguard-runtime|x-process-time-ms)|curl total"
  echo '```'
  echo '```json'
  "$PY" -m json.tool "$TMP" | head -n 40
  echo '```'
} | tee "$OUT"
rm -f "$TMP"
echo "Wrote $OUT"
