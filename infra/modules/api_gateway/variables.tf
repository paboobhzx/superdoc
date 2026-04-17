variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "environment" { type = string }

variable "cognito_user_pool_arn" {
  description = "Cognito user pool ARN for the API authorizer"
  type        = string
}

variable "lambda_integrations" {
  description = "Map of integration key → {invoke_arn, function_name}"
  type = map(object({
    invoke_arn    = string
    function_name = string
  }))
}
