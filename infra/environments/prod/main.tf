terraform {
  backend "s3" {
    bucket         = "superdoc-tfstate"
    key            = "superdoc/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "superdoc-tfstate-lock"
    encrypt        = true
  }
}

module "superdoc" {
  source                   = "../../"
  environment              = "prod"
  aws_region               = "us-east-1"
  project_name             = "superdoc"
  owner                    = "pablo"
  alert_email              = "pablobhz@gmail.com"
  domain_name              = "pablobhz.cloud"
  subdomain                = "superdoc"
  lambda_handler_s3_bucket = var.lambda_handler_s3_bucket
}

variable "lambda_handler_s3_bucket" {
  description = "S3 bucket for Lambda zips (from private repo CI)"
  type        = string
}
