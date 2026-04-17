variable "name_prefix" { type = string }
variable "layer_name" { type = string }
variable "s3_bucket" { type = string }
variable "s3_key" { type = string }
variable "compatible_runtimes" {
  type    = list(string)
  default = ["python3.12"]
}
variable "common_tags" { type = map(string) }
