variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "enable_customer_managed_kms" {
  description = "Use a customer-managed KMS key for the media bucket instead of SSE-S3 AES256."
  type        = bool
  default     = false
}
variable "cors_allowed_origins" {
  description = "Browser origins allowed to upload/download directly from the media bucket."
  type        = list(string)
  default     = ["https://superdoc.pablobhz.cloud", "http://localhost:5173", "http://localhost:4173"]
}
