variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "enable_customer_managed_kms" {
  description = "Use a customer-managed KMS key for sensitive DynamoDB tables."
  type        = bool
  default     = false
}
