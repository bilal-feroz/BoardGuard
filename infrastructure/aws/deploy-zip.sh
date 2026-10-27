#!/usr/bin/env bash
# Docker-free deployment: Python 3.12 Lambda zip (OpenCV 5 manylinux wheels) +
# Function URL + private S3 evidence store + CloudWatch logs.
#
# Prerequisites: AWS CLI v2 with credentials, Python 3.11+, uv, Node 22.
# Usage: bash infrastructure/aws/deploy-zip.sh [stack-name] [region]
set -euo pipefail

STACK="${1:-boardguard}"
REGION="${2:-${AWS_REGION:-us-east-1}}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
CODE_BUCKET="${STACK}-code-${ACCOUNT}-${REGION}"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
KEY="lambda/boardguard-${TAG}-$(date +%s).zip"

echo "==> Account ${ACCOUNT}, region ${REGION}, stack ${STACK}"

# Reserving 5 executions needs an account limit of at least 15 (10 must stay unreserved);
# new accounts start at 10, so cap concurrency only where the account allows it.
LIMIT="$(aws lambda get-account-settings --region "$REGION" --query AccountLimit.ConcurrentExecutions --output text)"
CONCURRENCY=5
if [ "$LIMIT" -lt 15 ]; then CONCURRENCY=0; echo "==> Lambda concurrency limit is ${LIMIT}: deploying without reserved concurrency"; fi

if [ -n "${SKIP_BUILD:-}" ] && [ -f "$ROOT/dist/boardguard-lambda.zip" ]; then
  echo "==> Reusing dist/boardguard-lambda.zip (SKIP_BUILD)"
else
  echo "==> Building static UI (same-origin API)"
  (cd "$ROOT/apps/web" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && rm -f .env.production.local && NEXT_PUBLIC_API_BASE="" npx next build)

  echo "==> Packaging Lambda zip"
  python "$ROOT/infrastructure/aws/package_lambda.py"
fi

if ! aws s3api head-bucket --bucket "$CODE_BUCKET" 2>/dev/null; then
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$CODE_BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket --bucket "$CODE_BUCKET" --region "$REGION" --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
  fi
  aws s3api put-public-access-block --bucket "$CODE_BUCKET" --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  aws s3api put-bucket-encryption --bucket "$CODE_BUCKET" --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
fi
aws s3 cp "$ROOT/dist/boardguard-lambda.zip" "s3://${CODE_BUCKET}/${KEY}" --region "$REGION"

echo "==> Deploying CloudFormation stack"
aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$ROOT/infrastructure/aws/template-zip.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "CodeBucket=${CODE_BUCKET}" "CodeKey=${KEY}" "GitSha=${TAG}" "MaxConcurrency=${CONCURRENCY}"

URL="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)"
echo "==> Deployed: ${URL}"
echo "==> Verify:   bash infrastructure/aws/verify.sh ${URL} ${STACK} ${REGION}"
