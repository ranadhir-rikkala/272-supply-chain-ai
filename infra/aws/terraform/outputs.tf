output "public_url" {
  description = "HTTPS URL of the dashboard, API (/api/v1), Keycloak (/auth) and Grafana (/grafana)."
  value       = local.public_url
}

output "region" {
  value = var.region
}

output "ecr_registry" {
  value = local.registry
}

output "ecr_repositories" {
  value = { for name, repo in aws_ecr_repository.images : name => repo.repository_url }
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "subnets" {
  value = aws_subnet.public[*].id
}

output "task_security_group" {
  value = aws_security_group.tasks.id
}

output "job_families" {
  description = "One-off task families for run-task.sh."
  value       = { for name, job in aws_ecs_task_definition.job : name => job.family }
}

output "log_group" {
  value = aws_cloudwatch_log_group.main.name
}

output "app_secret_arn" {
  description = "Read DEMO_USER_PASSWORD and the other passwords from here."
  value       = aws_secretsmanager_secret.app.arn
}

output "store_bucket" {
  value = aws_s3_bucket.store.bucket
}

output "database_endpoint" {
  value = aws_db_instance.main.address
}
