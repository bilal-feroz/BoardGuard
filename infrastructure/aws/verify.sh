#!/usr/bin/env bash
# Collect runtime proof from a deployed BoardGuard endpoint: health, runtime
# identity, a real OpenCV processing request with timing, and the matching
# CloudWatch log lines. Writes docs/evaluation/aws-proof.md.
set -euo pipefail
URL="${1:?usage: verify.sh <function-url> [stack] [region]}"
STACK="${2:-boardguard}"
REGION="${3:-${AWS_REGION:-us-east-1}}"
URL="${URL%/}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/evaluation/aws-proof.md"
FIXTURE="$(ls "$ROOT"/datasets/fixtures/images/*.jpg | head -n 1)"

{
  echo "# AWS runtime proof"
  echo
  echo "Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) against \`${URL}\` (stack \`${STACK}\`, region \`${REGION}\`)."
  echo
  echo "## GET /api/health"
  echo '```json'
  curl -sS "${URL}/api/health"
  echo
  echo '```'
  echo "## GET /api/runtime"
  echo '```json'
  curl -sS "${URL}/api/runtime" | python -m json.tool
  echo '```'
  echo "## POST /api/vision/quality ($(basename "$FIXTURE"))"
  echo '```'
  curl -sS -o /tmp/bg-q.json -D - -w "\ncurl total time: %{time_total}s\n" -F "file=@${FIXTURE}" "${URL}/api/vision/quality" | grep -iE "^(HTTP|x-boardguard-runtime|x-process-time-ms)|curl total"
  echo '```'
  echo '```json'
  python -m json.tool /tmp/bg-q.json | head -n 60
  echo '```'
  echo "## CloudWatch log lines (last 10 minutes)"
  echo '```'
  # New lines take a few seconds to become searchable. MSYS_NO_PATHCONV stops Git Bash on Windows
  # from rewriting the /aws/... log-group name into a file path.
  for _ in 1 2 3 4 5 6; do
    LINES="$(MSYS_NO_PATHCONV=1 aws logs filter-log-events --region "$REGION" --log-group-name "/aws/lambda/${STACK}-vision" \
      --start-time $(( ($(date +%s) - 600) * 1000 )) --filter-pattern '"request POST"' \
      --query 'events[-10:].message' --output text | tr '\t' '\n')"
    [ -n "$LINES" ] && break
    sleep 5
  done
  echo "$LINES"
  echo '```'
} | tee "$OUT"
echo "Wrote $OUT"
