variable "name_prefix" { type = string }
variable "common_tags" { type = map(string) }
variable "environment" { type = string }

variable "github_repo" {
  type    = string
  default = "https://github.com/pablobhz/superdoc"
}

variable "api_url" {
  type    = string
  default = ""
}
