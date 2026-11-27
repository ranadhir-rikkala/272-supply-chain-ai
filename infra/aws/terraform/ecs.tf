# One ECS Fargate (ARM64) service per container from compose.yaml. Service Connect
# gives them the same short names they use locally (platform-api:8080,
# keycloak:8080, forecast-api:8000, rabbitmq:5672 ...), so their configuration
# barely changes between the laptop and AWS.

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  service_connect_defaults {
    namespace = aws_service_discovery_http_namespace.main.arn
  }
}

resource "aws_service_discovery_http_namespace" "main" {
  name        = local.name
  description = "Service Connect namespace for ${local.name}"
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/ecs/${local.name}"
  retention_in_days = 7
}

locals {
  registry = split("/", aws_ecr_repository.images["platform-api"].repository_url)[0]
  image    = { for name in local.repositories : name => "${aws_ecr_repository.images[name].repository_url}:${var.image_tag}" }

  forecast_env = {
    STORE              = "s3"
    S3_BUCKET          = aws_s3_bucket.store.bucket
    AWS_REGION         = var.region
    AWS_DEFAULT_REGION = var.region
    LOCAL_STORE_ROOT   = "/tmp"
  }

  # port: { name, port, http (bool), alias (Service Connect name or null) }
  services = {
    caddy = {
      image   = local.image["caddy"]
      cpu     = 256
      memory  = 512
      command = ["caddy", "run", "--config", "/etc/caddy/Caddyfile.aws", "--adapter", "caddyfile"]
      env     = { PUBLIC_HOST = local.public_host }
      secrets = []
      ports   = [{ name = "http", port = 80, http = true, alias = null }]
      role    = aws_iam_role.task.arn
    }

    platform-api = {
      image   = local.image["platform-api"]
      cpu     = 512
      memory  = 1024
      command = null
      env = {
        PLATFORM_DATABASE_URL = "jdbc:postgresql://${local.db_host}:5432/supplychain?sslmode=require"
        POSTGRES_DB           = "supplychain"
        PUBLIC_URL            = local.public_url
        KEYCLOAK_INTERNAL_URL = "http://keycloak:8080/auth"
        FORECAST_API_URL      = "http://forecast-api:8000"
      }
      secrets = ["API_DB_PASSWORD", "FORECAST_SERVICE_TOKEN"]
      ports   = [{ name = "platform-api", port = 8080, http = true, alias = "platform-api" }]
      role    = aws_iam_role.task.arn
    }

    keycloak = {
      image   = local.image["keycloak"]
      cpu     = 1024
      memory  = 2048
      command = null
      env = {
        KEYCLOAK_ADMIN        = "admin"
        PUBLIC_URL            = local.public_url
        KC_DB                 = "postgres"
        KC_DB_URL_HOST        = local.db_host
        KC_DB_URL_DATABASE    = "keycloak"
        KC_DB_USERNAME        = "keycloak"
        KC_HTTP_ENABLED       = "true"
        KC_HTTP_RELATIVE_PATH = "/auth"
        KC_HOSTNAME           = "${local.public_url}/auth"
        KC_HOSTNAME_STRICT    = "true"
        KC_PROXY_HEADERS      = "xforwarded"
        KC_HEALTH_ENABLED     = "true"
        KC_METRICS_ENABLED    = "true"
      }
      secrets = ["KEYCLOAK_ADMIN_PASSWORD", "DEMO_USER_PASSWORD", "SMOKE_CLIENT_SECRET", "KC_DB_PASSWORD=KEYCLOAK_DB_PASSWORD"]
      ports   = [{ name = "keycloak", port = 8080, http = true, alias = "keycloak" }]
      role    = aws_iam_role.task.arn
    }

    forecast-api = {
      image   = local.image["forecast"]
      cpu     = 512
      memory  = 2048
      command = ["scforecast", "serve", "--port", "8000"]
      env     = merge(local.forecast_env, { SERVICE_NAME = "forecast-api" })
      secrets = ["DATABASE_URL=FORECAST_DATABASE_URL", "AMQP_URL", "FORECAST_SERVICE_TOKEN"]
      ports   = [{ name = "forecast-api", port = 8000, http = true, alias = "forecast-api" }]
      role    = aws_iam_role.forecast_task.arn
    }

    forecast-worker = {
      image   = local.image["forecast"]
      cpu     = 1024
      memory  = 4096
      command = ["scforecast", "worker"]
      env     = merge(local.forecast_env, { SERVICE_NAME = "forecast-worker", METRICS_PORT = "9100" })
      secrets = ["DATABASE_URL=FORECAST_DATABASE_URL", "AMQP_URL", "FORECAST_SERVICE_TOKEN"]
      ports   = [{ name = "forecast-worker", port = 9100, http = true, alias = "forecast-worker" }]
      role    = aws_iam_role.forecast_task.arn
    }

    rabbitmq = {
      image   = "public.ecr.aws/docker/library/rabbitmq:3.13-management-alpine"
      cpu     = 512
      memory  = 1024
      command = ["sh", "-c", "rabbitmq-plugins enable --offline rabbitmq_prometheus && exec docker-entrypoint.sh rabbitmq-server"]
      env     = { RABBITMQ_DEFAULT_USER = local.rabbitmq_user }
      secrets = ["RABBITMQ_DEFAULT_PASS=RABBITMQ_PASSWORD"]
      ports = [
        { name = "amqp", port = 5672, http = false, alias = "rabbitmq" },
        { name = "rabbitmq-metrics", port = 15692, http = true, alias = "rabbitmq-metrics" },
      ]
      role = aws_iam_role.task.arn
    }

    prometheus = {
      image   = local.image["prometheus"]
      cpu     = 512
      memory  = 1024
      command = null
      env     = {}
      secrets = []
      ports   = [{ name = "prometheus", port = 9090, http = true, alias = "prometheus" }]
      role    = aws_iam_role.task.arn
    }

    grafana = {
      image   = local.image["grafana"]
      cpu     = 512
      memory  = 1024
      command = null
      env = {
        GF_SERVER_ROOT_URL            = "${local.public_url}/grafana/"
        GF_SERVER_SERVE_FROM_SUB_PATH = "true"
        GF_SECURITY_ADMIN_USER        = "admin"
        GF_SECURITY_COOKIE_SECURE     = "true"
        # CloudFront sends the load balancer's name as Host, so Grafana's CSRF check
        # rejects the browser's Origin ("origin not allowed") unless it is trusted.
        GF_SECURITY_CSRF_TRUSTED_ORIGINS          = local.public_host
        GF_SECURITY_DISABLE_GRAVATAR              = "true"
        GF_USERS_ALLOW_SIGN_UP                    = "false"
        GF_AUTH_ANONYMOUS_ENABLED                 = "false"
        GF_ANALYTICS_REPORTING_ENABLED            = "false"
        GF_ANALYTICS_CHECK_FOR_UPDATES            = "false"
        GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH = "/var/lib/grafana/dashboards/supply-chain.json"
        POSTGRES_HOST                             = local.db_host
        POSTGRES_DB                               = "supplychain"
      }
      secrets = ["GF_SECURITY_ADMIN_PASSWORD=GRAFANA_ADMIN_PASSWORD", "GRAFANA_DB_PASSWORD"]
      ports   = [{ name = "grafana", port = 3000, http = true, alias = "grafana" }]
      role    = aws_iam_role.task.arn
    }
  }
}

# "NAME" reads the secret key NAME; "NAME=KEY" exposes secret key KEY as NAME.
locals {
  container_secrets = {
    for service, spec in local.services : service => [
      for entry in spec.secrets : {
        name      = split("=", entry)[0]
        valueFrom = local.secret[length(split("=", entry)) > 1 ? split("=", entry)[1] : entry]
      }
    ]
  }
}

resource "aws_ecs_task_definition" "service" {
  for_each                 = local.services
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = each.value.role

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([merge(
    {
      name        = each.key
      image       = each.value.image
      essential   = true
      environment = [for name, value in each.value.env : { name = name, value = value }]
      secrets     = local.container_secrets[each.key]
      portMappings = [for port in each.value.ports : merge(
        { name = port.name, containerPort = port.port, protocol = "tcp" },
        port.http ? { appProtocol = "http" } : {},
      )]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.main.name
          awslogs-region        = var.region
          awslogs-stream-prefix = each.key
        }
      }
    },
    each.value.command == null ? {} : { command = each.value.command },
  )])
}

resource "aws_ecs_service" "main" {
  for_each               = local.services
  name                   = each.key
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.service[each.key].arn
  desired_count          = var.services_enabled ? 1 : 0
  launch_type            = "FARGATE"
  enable_execute_command = true
  wait_for_steady_state  = false

  health_check_grace_period_seconds = each.key == "caddy" ? 60 : null

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = true
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = each.key == "caddy" ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.caddy.arn
      container_name   = "caddy"
      container_port   = 80
    }
  }

  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn

    dynamic "service" {
      for_each = [for port in each.value.ports : port if port.alias != null]
      content {
        port_name      = service.value.name
        discovery_name = service.value.name
        client_alias {
          port     = service.value.port
          dns_name = service.value.alias
        }

        # Service Connect ends HTTP requests after 15 s by default; optimization
        # and the first Keycloak sign-in can take longer.
        dynamic "timeout" {
          for_each = service.value.http ? [1] : []
          content {
            per_request_timeout_seconds = 120
            idle_timeout_seconds        = 300
          }
        }
      }
    }

    log_configuration {
      log_driver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.main.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "${each.key}-service-connect"
      }
    }
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront]
}

# One-off tasks for setup, run with infra/aws/scripts/run-task.sh.
locals {
  jobs = {
    db-init = {
      image  = "public.ecr.aws/docker/library/postgres:16-alpine"
      cpu    = 256
      memory = 512
      role   = aws_iam_role.task.arn
      # Creates the Keycloak role and database, which compose gets from its own container.
      command = ["sh", "-c", <<-EOT
        psql -v ON_ERROR_STOP=1 -v kcpw="$KEYCLOAK_DB_PASSWORD" <<'SQL'
        SELECT format('CREATE ROLE keycloak LOGIN PASSWORD %L', :'kcpw')
          WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak')\gexec
        SELECT format('ALTER ROLE keycloak LOGIN PASSWORD %L', :'kcpw')\gexec
        GRANT keycloak TO CURRENT_USER;
        SELECT 'CREATE DATABASE keycloak OWNER keycloak'
          WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
        SQL
        EOT
      ]
      env = {
        PGHOST     = local.db_host
        PGUSER     = aws_db_instance.main.username
        PGDATABASE = "supplychain"
        PGSSLMODE  = "require"
      }
      secrets = ["PGPASSWORD=POSTGRES_MASTER_PASSWORD", "KEYCLOAK_DB_PASSWORD"]
    }

    migrate = {
      image   = local.image["flyway"]
      cpu     = 256
      memory  = 512
      role    = aws_iam_role.task.arn
      command = ["-connectRetries=60", "-outOfOrder=true", "migrate"]
      env = {
        FLYWAY_URL       = "jdbc:postgresql://${local.db_host}:5432/supplychain?sslmode=require"
        FLYWAY_USER      = aws_db_instance.main.username
        FLYWAY_LOCATIONS = "filesystem:/flyway/sql"
      }
      secrets = [
        "FLYWAY_PASSWORD=POSTGRES_MASTER_PASSWORD",
        "FLYWAY_PLACEHOLDERS_FORECAST_DB_PASSWORD=FORECAST_DB_PASSWORD",
        "FLYWAY_PLACEHOLDERS_GRAFANA_DB_PASSWORD=GRAFANA_DB_PASSWORD",
        "FLYWAY_PLACEHOLDERS_API_DB_PASSWORD=API_DB_PASSWORD",
      ]
    }

    load-data = {
      image   = local.image["etl"]
      cpu     = 1024
      memory  = 4096
      role    = aws_iam_role.task.arn
      command = ["sh", "-c", "scgen --output /tmp/data && scetl load-master --root /tmp/data && scetl load-eval --root /tmp/data"]
      env     = {}
      secrets = ["DATABASE_URL=POSTGRES_MASTER_URL"]
    }

    train = {
      image   = local.image["forecast"]
      cpu     = 2048
      memory  = 8192
      role    = aws_iam_role.forecast_task.arn
      command = ["scforecast", "train", "--requested-by", "aws-bootstrap"]
      env     = merge(local.forecast_env, { SERVICE_NAME = "forecast-train" })
      secrets = ["DATABASE_URL=FORECAST_DATABASE_URL"]
    }
  }
}

resource "aws_ecs_task_definition" "job" {
  for_each                 = local.jobs
  family                   = "${local.name}-${each.key}"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = each.value.cpu
  memory                   = each.value.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = each.value.role

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([{
    name        = each.key
    image       = each.value.image
    essential   = true
    command     = each.value.command
    environment = [for name, value in each.value.env : { name = name, value = value }]
    secrets = [for entry in each.value.secrets : {
      name      = split("=", entry)[0]
      valueFrom = local.secret[length(split("=", entry)) > 1 ? split("=", entry)[1] : entry]
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.main.name
        awslogs-region        = var.region
        awslogs-stream-prefix = each.key
      }
    }
  }])
}
