#!/usr/bin/env bash
# After deploy: check the public URL, activate the newest gate-passing model,
# run a forecast and an optimization, so the dashboard is ready for the demo.
# Passwords are read from Secrets Manager and never printed.
set -euo pipefail

cd "$(dirname "$0")/../../.."
source infra/aws/scripts/_env.sh
TF=infra/aws/terraform
region=$(terraform -chdir="$TF" output -raw region)
url=$(terraform -chdir="$TF" output -raw public_url)
secret_arn=$(terraform -chdir="$TF" output -raw app_secret_arn)

secret_json=$(aws secretsmanager get-secret-value --region "$region" --secret-id "$secret_arn" --query SecretString --output text)
field() { python3 -c 'import json,sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$secret_json" "$1"; }
DEMO_USER_PASSWORD=$(field DEMO_USER_PASSWORD)
SMOKE_CLIENT_SECRET=$(field SMOKE_CLIENT_SECRET)
export PUBLIC_URL=$url DEMO_USER_PASSWORD SMOKE_CLIENT_SECRET

token() {
  DEMO_USERNAME=$1 bash scripts/token.sh | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}
api() { # user method path [curl args]
  local user=$1 method=$2 path=$3; shift 3
  curl --fail-with-body -sS -X "$method" "$url/api/v1$path" \
    -H "Authorization: Bearer $(token "$user")" -H "Idempotency-Key: $(uuidgen)" "$@"
}

echo "==> Waiting for $url"
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$url/api/v1/me" || true)
  [[ "$code" == "401" ]] && break
  sleep 10
done
[[ "$code" == "401" ]] || { echo "API is not answering (last status $code)" >&2; exit 1; }
echo "    API is up (401 without a token, as expected)"

echo "==> Signing in as each demo user"
for user in vic.viewer pat.planner max.manager ada.admin; do
  api "$user" GET /me | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d["username"], d["roles"])'
done

echo "==> Activating the newest model that passed the quality gate"
version=$(api ada.admin GET /models | python3 -c '
import json, sys
items = [m for m in json.load(sys.stdin)["items"] if m.get("passed_gate")]
items.sort(key=lambda m: m["created_at"], reverse=True)
print(items[0]["model_version"] if items else "")')
if [[ -z "$version" ]]; then
  echo "No gate-passing model yet. Run: infra/aws/scripts/run-task.sh train" >&2
  exit 1
fi
api ada.admin POST "/models/$version/activation" -H 'Content-Type: application/json' \
  -d '{"reason":"AWS deployment"}' >/dev/null
echo "    active: $version"

echo "==> Requesting a forecast run (the worker writes 112,000 rows in about 30 s)"
api pat.planner POST /forecast-runs >/dev/null
sleep 60

echo "==> Running optimization"
api pat.planner POST /optimization-runs | python3 -c '
import json, sys
print("    {cells} cells: {high} high, {medium} medium, {reorders} reorders, {transfers} transfers".format(**json.load(sys.stdin)))'

echo
echo "Ready: $url"
echo "Demo users: vic.viewer, pat.planner, max.manager, ada.admin"
echo "Their password: aws secretsmanager get-secret-value --region $region --secret-id $secret_arn --query SecretString --output text | python3 -c 'import json,sys; print(json.load(sys.stdin)[\"DEMO_USER_PASSWORD\"])'"
