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
  type        = list(any)
  default     = []
}

variable "layer_arns" {
  description = "List of Lambda layer ARNs to attach (max 5)"
  type        = list(string)
  default     = []
}

variable "reserved_concurrent_executions" {
  description = "Reserved concurrent executions (-1 = unreserved, 0 = throttled)"
  type        = number
  default     = -1
}

variable "enable_sqs_trigger" {
  description = "Enable SQS event source mapping (use with sqs_event_source_arn)"
  type        = bool
  default     = false
}

variable "sqs_event_source_arn" {
  description = "SQS queue ARN to use as event source (empty = no SQS trigger)"
  type        = string
  default     = ""
}

variable "sqs_filter_operation" {
  description = "Filter SQS messages by body.operation value (empty = no filter)"
  type        = string
  default     = ""
}

variable "package_type" {
  description = "Lambda package type: Zip or Image"
  type        = string
  default     = "Zip"
  validation {
    condition     = contains(["Zip", "Image"], var.package_type)
    error_message = "package_type must be Zip or Image."
  }
}

variable "image_uri" {
  description = "Container image URI when package_type is Image"
  type        = string
  default     = ""
}

variable "architectures" {
  description = "Optional Lambda instruction set architectures. Empty uses AWS defaults."
  type        = list(string)
  default     = []
}
