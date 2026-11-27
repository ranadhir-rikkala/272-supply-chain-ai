# High-risk alerts as events. After each optimization run, platform-api publishes to
# this SNS topic: one readable summary and one JSON event per HIGH-risk item.
# Subscribers pick what they want with a filter on the event_type attribute:
#   - SQS queue risk-alerts gets every item event (risk.high) for other services.
#   - alert_email gets only the summary (risk.high.summary), one email per run.

resource "aws_sns_topic" "risk_alerts" {
  name = "${local.name}-risk-alerts"
}

resource "aws_sqs_queue" "risk_alerts_dlq" {
  name                      = "${local.name}-risk-alerts-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "risk_alerts" {
  name                      = "${local.name}-risk-alerts"
  message_retention_seconds = 345600
  sqs_managed_sse_enabled   = true
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.risk_alerts_dlq.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_policy" "risk_alerts" {
  queue_url = aws_sqs_queue.risk_alerts.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "sns.amazonaws.com" }
      Action    = "sqs:SendMessage"
      Resource  = aws_sqs_queue.risk_alerts.arn
      Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.risk_alerts.arn } }
    }]
  })
}

resource "aws_sns_topic_subscription" "risk_alerts_queue" {
  topic_arn            = aws_sns_topic.risk_alerts.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.risk_alerts.arn
  raw_message_delivery = true
  filter_policy        = jsonencode({ event_type = ["risk.high"] })
}

resource "aws_sns_topic_subscription" "risk_alerts_email" {
  count         = var.alert_email == "" ? 0 : 1
  topic_arn     = aws_sns_topic.risk_alerts.arn
  protocol      = "email"
  endpoint      = var.alert_email
  filter_policy = jsonencode({ event_type = ["risk.high.summary"] })
}

# platform-api gets its own task role: it may publish to this topic and nothing else.
resource "aws_iam_role" "platform_task" {
  name               = "${local.name}-platform-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "platform_task" {
  name = "risk-alerts"
  role = aws_iam_role.platform_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sns:Publish"]
        Resource = [aws_sns_topic.risk_alerts.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel",
        ]
        Resource = "*"
      },
    ]
  })
}
