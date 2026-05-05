terraform {
  backend "s3" {
    bucket                      = "superdoc-tfstate"
    key                         = "superdoc/prod/terraform.tfstate"
    region                      = "us-east-1"
    encrypt                     = true
    use_lockfile                = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
  }
}

module "superdoc" {
  source                               = "../../"
  environment                          = "prod"
  aws_region                           = "us-east-1"
  project_name                         = "superdoc"
  owner                                = "pablo"
  alert_email                          = "pablobhz@gmail.com"
  domain_name                          = "pablobhz.cloud"
  subdomain                            = "superdoc"
  lambda_handler_s3_bucket             = var.lambda_handler_s3_bucket
  enable_media_customer_managed_kms    = var.enable_media_customer_managed_kms
  enable_dynamodb_customer_managed_kms = var.enable_dynamodb_customer_managed_kms
  office_converter_package_type        = "Image"
  office_converter_image_tag           = "latest"
  amplify_app_name                     = "superdoc"
  amplify_repository                   = "https://github.com/paboobhzx/superdoc"
}

variable "lambda_handler_s3_bucket" {
  description = "S3 bucket for Lambda zips (from private repo CI)"
  type        = string
}

variable "enable_media_customer_managed_kms" {
  description = "Use customer-managed KMS for media S3 encryption."
  type        = bool
  default     = false
}

variable "enable_dynamodb_customer_managed_kms" {
  description = "Use customer-managed KMS for DynamoDB table encryption."
  type        = bool
  default     = false
}

# The previous hotfix attempt created these IAM resources through AWS CLI before
# the deployment was stopped. Import them so the next Terraform apply adopts and
# reconciles them instead of failing on already-existing names.
import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role.lambda
  id = "superdoc-prod-markdown-convert-role"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy_attachment.basic
  id = "superdoc-prod-markdown-convert-role/arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy.dynamodb
  id = "superdoc-prod-markdown-convert-role:superdoc-prod-markdown-convert-dynamo"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy.s3
  id = "superdoc-prod-markdown-convert-role:superdoc-prod-markdown-convert-s3"
}

import {
  to = module.superdoc.module.lambda_markdown_convert.aws_iam_role_policy.ssm
  id = "superdoc-prod-markdown-convert-role:superdoc-prod-markdown-convert-ssm"
}
