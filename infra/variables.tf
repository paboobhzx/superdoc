variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name for naming and tagging"
  type        = string
  default     = "superdoc"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Must be dev or prod."
  }
}

variable "owner" {
  description = "Owner tag"
  type        = string
  default     = "pablo"
}

variable "alert_email" {
  description = "Email for budget alerts"
  type        = string
  default     = "pablobhz@gmail.com"
}

variable "domain_name" {
  description = "Root domain"
  type        = string
  default     = "pablobhz.cloud"
}

variable "subdomain" {
  description = "App subdomain"
  type        = string
  default     = "superdoc"
}

variable "lambda_handler_s3_bucket" {
  description = "S3 bucket storing Lambda zip packages (built by private repo CI)"
  type        = string
}

variable "lambda_runtime" {
  description = "Lambda Python runtime"
  type        = string
  default     = "python3.12"
}

variable "stripe_webhook_secret_ssm_path" {
  description = "SSM path for Stripe webhook secret"
  type        = string
  default     = "/superdoc/stripe/webhook_secret"
}

variable "rate_limit_enabled" {
  description = "Toggle the anonymous rate-limit + active-jobs cap on create_job Lambda. Default false during early launch; set true once auth + payments are live."
  type        = bool
  default     = false
}

variable "office_converter_image_tag" {
  description = "Tag for LibreOffice Lambda container images. Images are expected as <repository>:docx_to_pdf-<tag> and <repository>:xlsx_to_pdf-<tag>."
  type        = string
  default     = "latest"
}
