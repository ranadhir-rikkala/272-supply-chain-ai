#!/usr/bin/env bash
# Build every image for linux/arm64 (Fargate Graviton) and push it to ECR.
# Usage: infra/aws/scripts/push-images.sh [image ...]   (default: all images)
set -euo pipefail

cd "$(dirname "$0")/../../.."
source infra/aws/scripts/_env.sh
TF=infra/aws/terraform
TAG=${IMAGE_TAG:-latest}

region=$(terraform -chdir="$TF" output -raw region)
registry=$(terraform -chdir="$TF" output -raw ecr_registry)
repositories=$(terraform -chdir="$TF" output -json ecr_repositories)

aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "$registry"

# name | build context | Dockerfile
images=(
  "platform-api|services/platform-api|services/platform-api/Dockerfile"
  "forecast|.|infra/forecast/Dockerfile"
  "etl|.|infra/etl/Dockerfile"
  "caddy|dashboard|dashboard/Dockerfile"
  "keycloak|.|infra/aws/images/keycloak/Dockerfile"
  "flyway|.|infra/aws/images/flyway/Dockerfile"
  "prometheus|.|infra/aws/images/prometheus/Dockerfile"
  "grafana|.|infra/aws/images/grafana/Dockerfile"
)

wanted=("$@")
for spec in "${images[@]}"; do
  IFS='|' read -r name context dockerfile <<<"$spec"
  if [[ ${#wanted[@]} -gt 0 && ! " ${wanted[*]} " =~ " $name " ]]; then
    continue
  fi
  url=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$repositories" "$name")
  echo "==> $name -> $url:$TAG"
  # Plain docker build works with or without buildx; the daemon must be linux/arm64
  # (Apple silicon with Docker Desktop or Colima) or have arm64 emulation.
  docker build --platform linux/arm64 -f "$dockerfile" -t "$url:$TAG" "$context"
  docker push "$url:$TAG"
done
