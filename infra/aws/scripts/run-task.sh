#!/usr/bin/env bash
# Run a one-off setup task on ECS, wait for it, print its logs, and fail if it failed.
# Usage: infra/aws/scripts/run-task.sh db-init|migrate|load-data|train
set -euo pipefail

job=${1:?usage: run-task.sh db-init|migrate|load-data|train}
cd "$(dirname "$0")/../../.."
TF=infra/aws/terraform

region=$(terraform -chdir="$TF" output -raw region)
cluster=$(terraform -chdir="$TF" output -raw cluster)
security_group=$(terraform -chdir="$TF" output -raw task_security_group)
log_group=$(terraform -chdir="$TF" output -raw log_group)
subnets=$(terraform -chdir="$TF" output -json subnets | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)))')
family=$(terraform -chdir="$TF" output -json job_families | python3 -c 'import json,sys; print(json.load(sys.stdin)[sys.argv[1]])' "$job")

started=$(date +%s)
task=$(aws ecs run-task --region "$region" --cluster "$cluster" --launch-type FARGATE \
  --task-definition "$family" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)
echo "==> $job started: ${task##*/}"

while true; do
  status=$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task" \
    --query 'tasks[0].lastStatus' --output text)
  [[ "$status" == "STOPPED" ]] && break
  printf '    %s after %ss\n' "$status" "$(( $(date +%s) - started ))"
  sleep 20
done

exit_code=$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].containers[0].exitCode' --output text)
reason=$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task" \
  --query 'tasks[0].stoppedReason' --output text)

echo "==> last log lines"
aws logs tail "$log_group" --region "$region" --log-stream-names "$job/$job/${task##*/}" --since 3h 2>/dev/null | tail -20 || true

echo "==> $job finished in $(( $(date +%s) - started ))s with exit code $exit_code ($reason)"
[[ "$exit_code" == "0" ]]
