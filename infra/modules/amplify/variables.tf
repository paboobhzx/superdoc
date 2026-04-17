variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "environment" { type = string }


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
