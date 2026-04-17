variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "amplify_app_url" { type = string }
variable "api_invoke_url" {
  description = "API Gateway stage invoke URL, e.g. https://abc.execute-api.us-east-1.amazonaws.com/dev"
  type        = string
}
variable "acm_certificate_arn" { type = string }
variable "domain_name" { type = string }
variable "subdomain" { type = string }
