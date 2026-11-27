# AWS-native monitoring: one CloudWatch dashboard for the AWS side of the stack
# (ECS services, load balancer, RDS, CloudFront, logs) and alarms that email
# alert_email. Grafana keeps the application metrics CloudWatch cannot see
# (RabbitMQ queues, model WAPE, circuit breaker, ETL quarantine).

locals {
  cw_region = var.region
  cw_search = "{AWS/ECS,ClusterName,ServiceName} ClusterName=\"${aws_ecs_cluster.main.name}\""
  alb       = aws_lb.main.arn_suffix
  db_id     = aws_db_instance.main.identifier
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "text", x = 0, y = 0, width = 24, height = 2
        properties = {
          markdown = "## Supply chain AI on AWS\nECS Fargate services, load balancer, RDS and CloudFront. Application metrics (queues, model WAPE, ETL) are in [Grafana](${local.public_url}/grafana/)."
        }
      },
      {
        type = "metric", x = 0, y = 2, width = 8, height = 6
        properties = {
          title   = "Running tasks per service"
          region  = local.cw_region
          view    = "timeSeries"
          stat    = "Average"
          period  = 60
          metrics = [[{ expression = "SEARCH('{ECS/ContainerInsights,ClusterName,ServiceName} ClusterName=\"${aws_ecs_cluster.main.name}\" MetricName=\"RunningTaskCount\"', 'Average', 60)", id = "tasks" }]]
        }
      },
      {
        type = "metric", x = 8, y = 2, width = 8, height = 6
        properties = {
          title   = "CPU % per service"
          region  = local.cw_region
          view    = "timeSeries"
          period  = 60
          metrics = [[{ expression = "SEARCH('${local.cw_search} MetricName=\"CPUUtilization\"', 'Average', 60)", id = "cpu" }]]
          yAxis   = { left = { min = 0, max = 100 } }
        }
      },
      {
        type = "metric", x = 16, y = 2, width = 8, height = 6
        properties = {
          title   = "Memory % per service"
          region  = local.cw_region
          view    = "timeSeries"
          period  = 60
          metrics = [[{ expression = "SEARCH('${local.cw_search} MetricName=\"MemoryUtilization\"', 'Average', 60)", id = "mem" }]]
          yAxis   = { left = { min = 0, max = 100 } }
        }
      },
      {
        type = "metric", x = 0, y = 8, width = 8, height = 6
        properties = {
          title  = "Load balancer requests"
          region = local.cw_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", local.alb, { label = "requests" }],
          ]
        }
      },
      {
        type = "metric", x = 8, y = 8, width = 8, height = 6
        properties = {
          title  = "Response time (s)"
          region = local.cw_region
          view   = "timeSeries"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", local.alb, { stat = "p95", label = "p95" }],
            ["...", { stat = "p50", label = "p50" }],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 8, width = 8, height = 6
        properties = {
          title  = "Errors (5xx) and healthy targets"
          region = local.cw_region
          view   = "timeSeries"
          period = 60
          metrics = [
            ["AWS/ApplicationELB", "HTTPCode_Target_5XX_Count", "LoadBalancer", local.alb, { stat = "Sum", label = "app 5xx" }],
            [".", "HTTPCode_ELB_5XX_Count", ".", ".", { stat = "Sum", label = "load balancer 5xx" }],
            [".", "HealthyHostCount", "TargetGroup", aws_lb_target_group.caddy.arn_suffix, "LoadBalancer", local.alb, { stat = "Minimum", label = "healthy caddy targets", yAxis = "right" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 14, width = 8, height = 6
        properties = {
          title  = "RDS CPU % and connections"
          region = local.cw_region
          view   = "timeSeries"
          stat   = "Average"
          period = 60
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", local.db_id, { label = "CPU %" }],
            [".", "DatabaseConnections", ".", ".", { label = "connections", yAxis = "right" }],
          ]
        }
      },
      {
        type = "metric", x = 8, y = 14, width = 8, height = 6
        properties = {
          title  = "RDS free memory and storage (GB)"
          region = local.cw_region
          view   = "timeSeries"
          stat   = "Average"
          period = 300
          metrics = [
            [{ expression = "m1/1073741824", label = "free memory GB", id = "e1" }],
            [{ expression = "m2/1073741824", label = "free storage GB", id = "e2", yAxis = "right" }],
            ["AWS/RDS", "FreeableMemory", "DBInstanceIdentifier", local.db_id, { id = "m1", visible = false }],
            [".", "FreeStorageSpace", ".", ".", { id = "m2", visible = false }],
          ]
        }
      },
      {
        type = "metric", x = 16, y = 14, width = 8, height = 6
        properties = {
          title  = "CloudFront requests and error rate"
          region = "us-east-1"
          view   = "timeSeries"
          period = 300
          metrics = [
            ["AWS/CloudFront", "Requests", "DistributionId", aws_cloudfront_distribution.main.id, "Region", "Global", { stat = "Sum", label = "requests" }],
            [".", "5xxErrorRate", ".", ".", ".", ".", { stat = "Average", label = "5xx %", yAxis = "right" }],
          ]
        }
      },
      {
        type = "metric", x = 0, y = 20, width = 12, height = 6
        properties = {
          title  = "High-risk alerts published (SNS)"
          region = local.cw_region
          view   = "timeSeries"
          stat   = "Sum"
          period = 60
          metrics = [
            ["AWS/SNS", "NumberOfMessagesPublished", "TopicName", aws_sns_topic.risk_alerts.name, { label = "published" }],
            [".", "NumberOfNotificationsFailed", ".", ".", { label = "delivery failed" }],
          ]
        }
      },
      {
        type = "metric", x = 12, y = 20, width = 12, height = 6
        properties = {
          title  = "High-risk alert queue (SQS)"
          region = local.cw_region
          view   = "timeSeries"
          stat   = "Maximum"
          period = 60
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", aws_sqs_queue.risk_alerts.name, { label = "waiting" }],
            [".", ".", ".", aws_sqs_queue.risk_alerts_dlq.name, { label = "dead-lettered" }],
          ]
        }
      },
      {
        type = "log", x = 0, y = 26, width = 24, height = 7
        properties = {
          title  = "Recent errors in service logs"
          region = local.cw_region
          view   = "table"
          query  = "SOURCE '${aws_cloudwatch_log_group.main.name}' | fields @timestamp, @logStream, @message | filter @message like /(?i)(error|exception|traceback)/ | sort @timestamp desc | limit 25"
        }
      },
    ]
  })
}

# Alarms email alert_email through SNS. AWS sends a confirmation email first.
resource "aws_sns_topic" "alerts" {
  count = var.alert_email == "" ? 0 : 1
  name  = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_cloudwatch_metric_alarm" "app_5xx" {
  count               = var.alert_email == "" ? 0 : 1
  alarm_name          = "${local.name}-app-5xx"
  alarm_description   = "The app returned more than 5 server errors in 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = local.alb }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  count               = var.alert_email == "" ? 0 : 1
  alarm_name          = "${local.name}-rds-cpu"
  alarm_description   = "RDS CPU above 80% for 10 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = local.db_id }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
  ok_actions          = [aws_sns_topic.alerts[0].arn]
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  count               = var.alert_email == "" ? 0 : 1
  alarm_name          = "${local.name}-rds-storage"
  alarm_description   = "RDS free storage below 2 GB."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = local.db_id }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2147483648
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts[0].arn]
}
