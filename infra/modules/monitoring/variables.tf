variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "alert_email" { type = string }

variable "media_bucket_name" {
  description = "S3 media bucket name for PutRequests alarm"
  type        = string
}

variable "api_name" {
  description = "API Gateway name for 4xx alarm"
  type        = string
}

variable "api_stage" {
  description = "API Gateway stage name"
  type        = string
}
