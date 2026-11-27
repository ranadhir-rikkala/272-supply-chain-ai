# Every password and token is generated here and stored in one Secrets Manager
# secret. Tasks read individual keys at start-up; nothing is in an image or env file.
# The values are also in the Terraform state, so keep the state file private.

locals {
  password_names = [
    "db_master", "rabbitmq", "forecast_db", "grafana_db", "api_db", "keycloak_db",
    "keycloak_admin", "smoke_client", "grafana_admin", "forecast_token", "origin_verify",
  ]
}

resource "random_password" "db_master" {
  length  = 32
  special = false
}

resource "random_password" "app" {
  for_each = toset([for name in local.password_names : name if name != "db_master"])
  length   = 32
  special  = false
}

# Keycloak requires an uppercase letter and a digit in the demo password.
resource "random_password" "demo_user" {
  length      = 16
  special     = false
  min_upper   = 1
  min_lower   = 1
  min_numeric = 1
}

locals {
  db_host       = aws_db_instance.main.address
  rabbitmq_user = "supplychain"

  secret_values = {
    POSTGRES_MASTER_PASSWORD = random_password.db_master.result
    POSTGRES_MASTER_URL      = "postgresql://${aws_db_instance.main.username}:${random_password.db_master.result}@${local.db_host}:5432/supplychain?sslmode=require"
    FORECAST_DATABASE_URL    = "postgresql://forecast_service:${random_password.app["forecast_db"].result}@${local.db_host}:5432/supplychain?sslmode=require"
    AMQP_URL                 = "amqp://${local.rabbitmq_user}:${random_password.app["rabbitmq"].result}@rabbitmq:5672/"
    RABBITMQ_PASSWORD        = random_password.app["rabbitmq"].result
    FORECAST_DB_PASSWORD     = random_password.app["forecast_db"].result
    GRAFANA_DB_PASSWORD      = random_password.app["grafana_db"].result
    API_DB_PASSWORD          = random_password.app["api_db"].result
    KEYCLOAK_DB_PASSWORD     = random_password.app["keycloak_db"].result
    KEYCLOAK_ADMIN_PASSWORD  = random_password.app["keycloak_admin"].result
    DEMO_USER_PASSWORD       = random_password.demo_user.result
    SMOKE_CLIENT_SECRET      = random_password.app["smoke_client"].result
    GRAFANA_ADMIN_PASSWORD   = var.grafana_admin_password != "" ? var.grafana_admin_password : random_password.app["grafana_admin"].result
    FORECAST_SERVICE_TOKEN   = random_password.app["forecast_token"].result
  }
}

resource "aws_secretsmanager_secret" "app" {
  name                    = "${local.name}/app"
  description             = "Passwords and tokens for the supply chain services"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.secret_values)
}

# ECS reads one key of the JSON secret with "<secret arn>:<key>::".
locals {
  secret = { for key in keys(local.secret_values) : key => "${aws_secretsmanager_secret.app.arn}:${key}::" }
}
