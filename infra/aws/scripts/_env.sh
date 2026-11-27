# Sourced by the other scripts: stop early if the AWS CLI is not signed in.
# Terraform and the AWS CLI both read the CLI sign-in (aws login, aws sso login or
# a profile) themselves and refresh it, so nothing is exported here; a copy of the
# temporary credentials would expire partway through a long deploy.
if ! aws sts get-caller-identity --query Account --output text >/dev/null 2>&1; then
  echo "AWS credentials are not working. Run 'aws login --region us-east-2' first." >&2
  exit 1
fi
