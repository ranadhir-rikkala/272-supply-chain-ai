#!/usr/bin/env bash
# Scale every service to zero. RDS, the load balancer and CloudFront keep running
# (about $2.50 a day); data, the model and users are kept. Resume with resume.sh.
set -euo pipefail

cd "$(dirname "$0")/../../.."
source infra/aws/scripts/_env.sh
terraform -chdir=infra/aws/terraform apply -input=false -auto-approve -var services_enabled=false
echo "Paused. Resume with: infra/aws/scripts/resume.sh"
