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

variable "office_converter_package_type" {
  description = "Office PDF converter package type. Keep Zip to match the current deployed Lambda functions; set Image only when the ECR images are deployed through Terraform."
  type        = string
  default     = "Zip"
  validation {
    condition     = contains(["Zip", "Image"], var.office_converter_package_type)
    error_message = "office_converter_package_type must be Zip or Image."
  }
}

variable "enable_media_customer_managed_kms" {
  description = "Use a customer-managed KMS key for the media S3 bucket. Adds KMS key/request cost when enabled."
  type        = bool
  default     = false
}

variable "enable_dynamodb_customer_managed_kms" {
  description = "Use a customer-managed KMS key for sensitive DynamoDB tables. Adds KMS key/request cost when enabled."
  type        = bool
  default     = false
}

variable "cors_allowed_origins" {
  description = "Approved browser origins for CORS. Include production and explicit local dev origins only."
  type        = list(string)
  default     = ["https://superdoc.pablobhz.cloud", "http://localhost:5173", "http://localhost:4173"]
}
