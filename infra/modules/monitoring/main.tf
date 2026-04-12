# ── SNS Topic ────────────────────────────────────────────────────────────────

resource "aws_sns_topic" "alerts" {
  name = "${var.name_prefix}-alerts"
  tags = var.common_tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── SNS Topic for auto-disable (triggers disable_anonymous Lambda) ───────────

resource "aws_sns_topic" "auto_disable" {
  name = "${var.name_prefix}-auto-disable"
  tags = var.common_tags
}

resource "aws_sns_topic_subscription" "auto_disable_email" {
  topic_arn = aws_sns_topic.auto_disable.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ── Billing alarms ───────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "billing_warn" {
  alarm_name          = "${var.name_prefix}-billing-10usd-warn"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600
  statistic           = "Maximum"
  threshold           = 10
  alarm_description   = "Estimated charges exceeded $10"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.common_tags

  dimensions = {
    Currency = "USD"
  }
}

resource "aws_cloudwatch_metric_alarm" "billing_critical" {
  alarm_name          = "${var.name_prefix}-billing-20usd-disable"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "EstimatedCharges"
  namespace           = "AWS/Billing"
  period              = 21600
  statistic           = "Maximum"
  threshold           = 20
  alarm_description   = "Estimated charges exceeded $20 — auto-disabling anonymous access"
  alarm_actions       = [aws_sns_topic.alerts.arn, aws_sns_topic.auto_disable.arn]
  tags                = var.common_tags

  dimensions = {
    Currency = "USD"
  }
}

# ── S3 PutRequests alarm ─────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "s3_puts" {
  alarm_name          = "${var.name_prefix}-s3-puts-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "PutRequests"
  namespace           = "AWS/S3"
  period              = 3600
  statistic           = "Sum"
  threshold           = 2000
  alarm_description   = "S3 PutRequests > 2000/hr"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.common_tags

  dimensions = {
    BucketName = var.media_bucket_name
    FilterId   = "EntireBucket"
  }
}

# ── API 4xx alarm ────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "api_4xx" {
  alarm_name          = "${var.name_prefix}-api-4xx-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "4XXError"
  namespace           = "AWS/ApiGateway"
  period              = 300
  statistic           = "Sum"
  threshold           = 500
  alarm_description   = "API 4xx errors > 500 in 5min"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = var.common_tags

  dimensions = {
    ApiName = var.api_name
    Stage   = var.api_stage
  }
}
