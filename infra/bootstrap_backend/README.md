# Terraform Backend Bootstrap

Creates the S3 bucket used for Terraform remote state.

Why this exists:
- The S3 backend bucket must already exist before running `terraform init` in `infra/environments/*`.
- This bootstrap uses local state by default so it can run first.

## Usage

From this folder:

```bash
terraform init
terraform apply -var='bucket_name=superdoc-tfstate-<account_id>' -var='region=us-east-1'
```

Then initialize an environment:

```bash
cd ../environments/dev
terraform init
terraform apply
```

