#!/usr/bin/env bash
# Full deploy from an empty AWS account. Each terraform apply stops for your "yes".
# Usage: infra/aws/scripts/deploy.sh [--skip-data]
#   --skip-data  skip loading feeds and training (use when the database already has them)
set -euo pipefail

cd "$(dirname "$0")/../../.."
TF=infra/aws/terraform
SCRIPTS=infra/aws/scripts
skip_data=false
[[ "${1:-}" == "--skip-data" ]] && skip_data=true

aws sts get-caller-identity --query Arn --output text >/dev/null || {
  echo "AWS credentials are not working. Run 'aws login' (or 'aws sso login') first." >&2
  exit 1
}

echo "==> 1/5 Infrastructure (network, RDS, S3, ECR, secrets, load balancer, CloudFront)"
terraform -chdir="$TF" init -input=false
terraform -chdir="$TF" apply -var services_enabled=false

echo "==> 2/5 Images"
"$SCRIPTS/push-images.sh"

echo "==> 3/5 Database: Keycloak role and database, then Flyway migrations"
"$SCRIPTS/run-task.sh" db-init
"$SCRIPTS/run-task.sh" migrate

echo "==> 4/5 Services"
terraform -chdir="$TF" apply -var services_enabled=true

if [[ "$skip_data" == false ]]; then
  echo "==> 5/5 Data: generate and load three years of feeds (~15 min), then train the model (~3 min)"
  "$SCRIPTS/run-task.sh" load-data
  "$SCRIPTS/run-task.sh" train
fi

echo
echo "Deployed: $(terraform -chdir="$TF" output -raw public_url)"
echo "Services take 2-4 minutes to become healthy. Then run: $SCRIPTS/post-deploy.sh"
