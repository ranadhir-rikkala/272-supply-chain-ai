#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL=${PUBLIC_URL:-https://localhost}
DEMO_USERNAME=${DEMO_USERNAME:-pat.planner}
: "${DEMO_USER_PASSWORD:?DEMO_USER_PASSWORD must be set}"
: "${SMOKE_CLIENT_SECRET:?SMOKE_CLIENT_SECRET must be set}"

curl --fail --silent --show-error \
  --request POST "${PUBLIC_URL%/}/auth/realms/supplychain/protocol/openid-connect/token" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=smoke-test" \
  --data-urlencode "client_secret=$SMOKE_CLIENT_SECRET" \
  --data-urlencode "username=$DEMO_USERNAME" \
  --data-urlencode "password=$DEMO_USER_PASSWORD"
