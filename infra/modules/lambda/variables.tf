variable "name_prefix" { type = string }
variable "function_name" { type = string }
variable "handler" { type = string }
variable "runtime" { type = string }
variable "memory_size" { type = number }
variable "timeout" { type = number }
variable "s3_bucket" { type = string }
variable "s3_key" { type = string }
variable "common_tags" { type = map(string) }
variable "media_bucket_arn" { type = string }

variable "dynamodb_table_arns" {
  description = "List of DynamoDB table ARNs (with index/* suffixes)"
  type        = list(string)
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "enable_eventbridge" {
  type    = bool
  default = false
}

variable "schedule_expression" {
  type    = string
  default = "rate(15 minutes)"
}

variable "enable_sns_trigger" {
  description = "Whether to subscribe this Lambda to an SNS topic"
  type        = bool
  default     = false
}

variable "sns_trigger_arn" {
  description = "SNS topic ARN to trigger this Lambda"
  type        = string
  default     = ""
}

variable "extra_iam_statements" {
  description = "Additional IAM policy statements for this Lambda"
  type = list(object({
    Effect   = string
    Action   = list(string)
    Resource = list(string)
  }))
  default = []
}
