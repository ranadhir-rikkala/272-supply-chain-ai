#!/usr/bin/env bash
# Start the paused services again (data, model and users are kept in RDS and S3).
# Takes about 5 minutes. Usage: infra/aws/scripts/resume.sh
set -euo pipefail

cd "$(dirname "$0")/../../.."
source infra/aws/scripts/_env.sh
TF=infra/aws/terraform

terraform -chdir="$TF" apply -input=false -auto-approve -var services_enabled=true
region=$(terraform -chdir="$TF" output -raw region)
cluster=$(terraform -chdir="$TF" output -raw cluster)

echo "==> Waiting for the services to start"
aws ecs wait services-stable --region "$region" --cluster "$cluster" \
  --services rabbitmq keycloak platform-api forecast-api forecast-worker prometheus grafana caddy

# Service Connect only gives a task the names of services that were running when it
# started, so restart the services that call others (see deploy.sh).
echo "==> Restarting the services that call others"
for service in platform-api forecast-api forecast-worker prometheus grafana caddy; do
  aws ecs update-service --region "$region" --cluster "$cluster" --service "$service" \
    --force-new-deployment --query 'service.serviceName' --output text >/dev/null
done
aws ecs wait services-stable --region "$region" --cluster "$cluster" \
  --services platform-api forecast-api forecast-worker prometheus grafana caddy

url=$(terraform -chdir="$TF" output -raw public_url)
for _ in $(seq 1 30); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "$url/api/v1/me")" == "401" ]] && break
  sleep 10
done
echo "Running: $url"
