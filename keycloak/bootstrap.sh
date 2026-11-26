#!/usr/bin/env bash
set -euo pipefail

KC_HOME=/opt/keycloak
KC_SERVER=http://127.0.0.1:8080/auth
ADMIN_CONFIG=/tmp/kcadm.config

"$KC_HOME/bin/kc.sh" start --import-realm &
keycloak_pid=$!
trap 'kill "$keycloak_pid" 2>/dev/null || true' TERM INT

until "$KC_HOME/bin/kcadm.sh" config credentials \
  --server "$KC_SERVER" \
  --realm master \
  --user "$KEYCLOAK_ADMIN" \
  --password "$KEYCLOAK_ADMIN_PASSWORD" \
  --config "$ADMIN_CONFIG" >/dev/null 2>&1
do
  if ! kill -0 "$keycloak_pid" 2>/dev/null; then
    wait "$keycloak_pid"
  fi
  sleep 2
done

for user_spec in \
  "vic.viewer:VIEWER:Vic:Viewer" \
  "pat.planner:PLANNER:Pat:Planner" \
  "max.manager:SUPPLY_MANAGER:Max:Manager" \
  "ada.admin:ADMIN:Ada:Admin"; do
  username=${user_spec%%:*}
  user_details=${user_spec#*:}
  role=${user_details%%:*}
  name=${user_details#*:}
  first_name=${name%%:*}
  last_name=${name#*:}
  users_json=$("$KC_HOME/bin/kcadm.sh" get users -r supplychain -q "username=$username" --config "$ADMIN_CONFIG")
  user_id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$users_json" | head -n 1)
  if [[ -z "$user_id" ]]; then
    "$KC_HOME/bin/kcadm.sh" create users -r supplychain \
      -s "username=$username" -s "firstName=$first_name" -s "lastName=$last_name" \
      -s enabled=true -s emailVerified=true \
      -s "email=$username@supplychain.local" --config "$ADMIN_CONFIG" >/dev/null
    users_json=$("$KC_HOME/bin/kcadm.sh" get users -r supplychain -q "username=$username" --config "$ADMIN_CONFIG")
    user_id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' <<<"$users_json" | head -n 1)
  fi
  if [[ -z "$user_id" ]]; then
    echo "Unable to resolve demo user $username in Keycloak" >&2
    exit 1
  fi
  "$KC_HOME/bin/kcadm.sh" update "users/$user_id" -r supplychain \
    -s "firstName=$first_name" -s "lastName=$last_name" --config "$ADMIN_CONFIG"
  "$KC_HOME/bin/kcadm.sh" set-password -r supplychain \
    --username "$username" --new-password "$DEMO_USER_PASSWORD" --config "$ADMIN_CONFIG"
  if "$KC_HOME/bin/kcadm.sh" get-roles -r supplychain --uusername "$username" --available --config "$ADMIN_CONFIG" \
      | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$role\""; then
    "$KC_HOME/bin/kcadm.sh" add-roles -r supplychain \
      --uusername "$username" --rolename "$role" --config "$ADMIN_CONFIG"
  fi
done

dashboard_client_id=$("$KC_HOME/bin/kcadm.sh" get clients -r supplychain -q clientId=dashboard --fields id \
  --config "$ADMIN_CONFIG" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if [[ -z "$dashboard_client_id" ]]; then
  echo "Unable to resolve dashboard client in Keycloak" >&2
  exit 1
fi
"$KC_HOME/bin/kcadm.sh" update "clients/$dashboard_client_id" -r supplychain \
  -s "redirectUris=[\"${PUBLIC_URL%/}/*\",\"http://localhost/*\"]" --config "$ADMIN_CONFIG"

smoke_client_id=$("$KC_HOME/bin/kcadm.sh" get clients -r supplychain -q clientId=smoke-test --fields id \
  --config "$ADMIN_CONFIG" | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)
if [[ -z "$smoke_client_id" ]]; then
  echo "Unable to resolve smoke-test client in Keycloak" >&2
  exit 1
fi
"$KC_HOME/bin/kcadm.sh" update "clients/$smoke_client_id" -r supplychain \
  -s "secret=$SMOKE_CLIENT_SECRET" --config "$ADMIN_CONFIG"

wait "$keycloak_pid"
