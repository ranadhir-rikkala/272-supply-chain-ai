#!/usr/bin/env bash
# Delete everything Terraform created (database, bucket, images, logs). Asks for "yes".
set -euo pipefail
cd "$(dirname "$0")/../../.."
source infra/aws/scripts/_env.sh
terraform -chdir=infra/aws/terraform destroy
