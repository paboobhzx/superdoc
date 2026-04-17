variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }

variable "alerts_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarm actions"
  type        = string
}
