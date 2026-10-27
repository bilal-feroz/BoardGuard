#!/usr/bin/env bash
# Build the BoardGuard container, push it to Amazon ECR and deploy the
# CloudFormation stack (Lambda container + Function URL + private S3 + logs).
#
# Prerequisites: Docker running, AWS CLI v2 configured with credentials that may
# create ECR repositories, CloudFormation stacks, IAM roles, Lambda functions
# and S3 buckets in the target account.
#
# Usage: infrastructure/aws/deploy.sh [stack-name] [region]
set -euo pipefail

STACK="${1:-boardguard}"
REGION="${2:-${AWS_REGION:-us-east-1}}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REPO="${STACK}-vision"
TAG="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE="${REGISTRY}/${REPO}:${TAG}"

echo "==> Account ${ACCOUNT}, region ${REGION}, stack ${STACK}, image ${IMAGE}"

# Reserving 5 executions needs an account limit of at least 15 (10 must stay unreserved);
# new accounts start at 10, so cap concurrency only where the account allows it.
LIMIT="$(aws lambda get-account-settings --region "$REGION" --query AccountLimit.ConcurrentExecutions --output text)"
CONCURRENCY=5
if [ "$LIMIT" -lt 15 ]; then CONCURRENCY=0; echo "==> Lambda concurrency limit is ${LIMIT}: deploying without reserved concurrency"; fi

aws ecr describe-repositories --repository-names "$REPO" --region "$REGION" >/dev/null 2>&1 \
  || aws ecr create-repository --repository-name "$REPO" --region "$REGION" \
       --image-scanning-configuration scanOnPush=true --encryption-configuration encryptionType=AES256 >/dev/null
aws ecr put-lifecycle-policy --repository-name "$REPO" --region "$REGION" --lifecycle-policy-text \
  '{"rules":[{"rulePriority":1,"description":"keep last 5","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":5},"action":{"type":"expire"}}]}' >/dev/null

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"

echo "==> Building image (linux/amd64)"
docker build --platform linux/amd64 --provenance=false -t "$IMAGE" \
  --build-arg BUILDKIT_INLINE_CACHE=1 "$ROOT"
docker push "$IMAGE"
DIGEST="$(aws ecr describe-images --repository-name "$REPO" --image-ids imageTag="$TAG" --region "$REGION" --query 'imageDetails[0].imageDigest' --output text)"

echo "==> Deploying CloudFormation stack"
aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \
  --template-file "$ROOT/infrastructure/aws/template.yaml" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides "ImageUri=${REGISTRY}/${REPO}@${DIGEST}" "GitSha=${TAG}" "MaxConcurrency=${CONCURRENCY}"

URL="$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)"
echo "==> Deployed: ${URL}"
echo "==> Verify:   bash infrastructure/aws/verify.sh ${URL} ${STACK} ${REGION}"
