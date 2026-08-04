variable "project" { type = string }
variable "environment" { type = string }
variable "alb_arn_suffix" { type = string }
variable "ecs_cluster_name" { type = string }
variable "ecs_service_name" { type = string }
variable "rds_instance_id" { type = string }
variable "alarm_email" {
  type    = string
  default = ""
}
variable "log_group_name" {
  type        = string
  description = "ECS API CloudWatch log group name for metric filters"
  default     = ""
}

locals {
  name      = "${var.project}-${var.environment}"
  has_email = var.alarm_email != ""
}

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "email" {
  count     = local.has_email ? 1 : 0
  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-alb-5xx"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 300
  statistic           = "Sum"
  threshold           = 5
  alarm_description   = "ALB 5xx rate elevated"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = {
    LoadBalancer = var.alb_arn_suffix
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_running" {
  alarm_name          = "${local.name}-ecs-running-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = 1
  alarm_description   = "ECS running task count below desired"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = {
    ClusterName = var.ecs_cluster_name
    ServiceName = var.ecs_service_name
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.name}-rds-storage-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 2147483648 # 2 GiB
  alarm_description   = "RDS free storage below 2 GiB"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "RDS CPU sustained above 80%"
  alarm_actions       = [aws_sns_topic.alarms.arn]
  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }
}

resource "aws_budgets_budget" "monthly" {
  count        = local.has_email ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = "100"
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alarm_email]
  }
}

# --- Security-relevant metric filters (Phase 3 §7) ---------------------------
# Login failure spikes and admin backup invocations, when log group is wired.

resource "aws_cloudwatch_log_metric_filter" "login_failures" {
  count          = var.log_group_name != "" ? 1 : 0
  name           = "${local.name}-login-failures"
  log_group_name = var.log_group_name
  pattern        = "{ $.action = \"login\" && $.outcome = \"failure\" }"
  metric_transformation {
    name      = "LoginFailureCount"
    namespace = "Makthab/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "login_failure_spike" {
  count               = var.log_group_name != "" ? 1 : 0
  alarm_name          = "${local.name}-login-failure-spike"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "LoginFailureCount"
  namespace           = "Makthab/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 20
  treat_missing_data  = "notBreaching"
  alarm_description   = "Login failure spike (possible credential stuffing)"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

resource "aws_cloudwatch_log_metric_filter" "admin_backup" {
  count          = var.log_group_name != "" ? 1 : 0
  name           = "${local.name}-admin-backup"
  log_group_name = var.log_group_name
  pattern        = "{ $.action = \"backup\" }"
  metric_transformation {
    name      = "AdminBackupCount"
    namespace = "Makthab/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "admin_backup" {
  count               = var.log_group_name != "" ? 1 : 0
  alarm_name          = "${local.name}-admin-backup"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "AdminBackupCount"
  namespace           = "Makthab/${var.environment}"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_description   = "Informational: admin/backup was invoked"
  alarm_actions       = [aws_sns_topic.alarms.arn]
}

output "sns_topic_arn" { value = aws_sns_topic.alarms.arn }
