variable "bucket_name" {
  description = "S3 bucket name for Terraform state (must be globally unique)."
  type        = string
}

variable "region" {
  description = "AWS region for the state bucket."
  type        = string
  default     = "us-east-1"
}

