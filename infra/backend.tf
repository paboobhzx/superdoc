# Remote state — S3 bucket and DynamoDB lock table must exist before first apply.
# Create them manually once:
#   aws s3 mb s3://superdoc-tfstate-<account_id> --region us-east-1
#   aws s3api put-bucket-versioning --bucket superdoc-tfstate-<account_id> \
#       --versioning-configuration Status=Enabled
#   aws dynamodb create-table --table-name superdoc-tfstate-lock \
#       --attribute-definitions AttributeName=LockID,AttributeType=S \
#       --key-schema AttributeName=LockID,KeyType=HASH \
#       --billing-mode PAY_PER_REQUEST

terraform {
  backend "s3" {
    # Fill in values via -backend-config flags or backend.hcl (never commit real values)
    bucket         = "superdoc-tfstate"
    key            = "superdoc/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "superdoc-tfstate-lock"
    encrypt        = true
  }
}
