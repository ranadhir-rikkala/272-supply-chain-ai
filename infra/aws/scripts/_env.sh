# Sourced by the other scripts. Turns the current AWS CLI sign-in (aws login,
# aws sso login or a profile) into temporary environment credentials, so
# Terraform and the SDKs use the same session. Nothing is written to disk.
if [[ -z "${AWS_ACCESS_KEY_ID:-}" ]]; then
  if ! creds=$(aws configure export-credentials --format env 2>/dev/null); then
    echo "AWS credentials are not working. Run 'aws login --region us-east-2' first." >&2
    exit 1
  fi
  eval "$creds"
  unset creds
fi
