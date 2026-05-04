variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "environment" { type = string }

variable "app_name" {
  description = "Display name for the Amplify app. Defaults to <name_prefix>-frontend."
  type        = string
  default     = ""
}

variable "repository" {
  description = "GitHub repository URL (https://github.com/owner/repo). When set, Amplify tracks the repo for auto-builds."
  type        = string
  default     = ""
}

variable "api_url" {
  type    = string
  default = ""
}

variable "cognito_user_pool_id" {
  type    = string
  default = ""
}

variable "cognito_client_id" {
  type    = string
  default = ""
}
