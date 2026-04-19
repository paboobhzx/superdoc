# SuperDoc

Convert, edit and transform any file. Free, serverless, no dark patterns.

[superdoc.pablobhz.cloud](https://superdoc.pablobhz.cloud)

## What it does

- **PDF Tools** — merge, split, compress, rotate, annotate, extract text
- **Documents** — convert PDF↔DOCX, edit Word and Excel
- **Images** — convert formats, resize, remove background
- **Video** — trim, convert, extract audio, transcribe, hardcode subtitles ($1/video)
- **Convert Anything** — drop any file, get options

## Stack

| Layer | Service |
|---|---|
| Frontend | React + Vite → Amplify |
| CDN | CloudFront |
| API | API Gateway + Lambda (Python 3.12) |
| Queue | SQS Standard |
| Database | DynamoDB (PAY_PER_REQUEST, TTL 24h) |
| Storage | S3 (lifecycle delete after 24h) |
| DNS | Route53 → superdoc.pablobhz.cloud |
| IaC | Terraform (modular, remote state) |
| CI/CD | GitHub Actions (OIDC — no static credentials) |

## Cost

~$0.55/month at low traffic (Route53 hosted zone dominates).

## Development

```bash
# Frontend
cd frontend
npm install
# Configure API base URL
cp .env.example .env.local  # then set VITE_API_URL
npm run dev

# Terraform backend bootstrap (one-time)
cd infra/bootstrap_backend
terraform init
terraform apply -var='bucket_name=superdoc-tfstate-<account_id>'

# Recommended entrypoint for real infra applies
cd ../environments/dev
terraform init
terraform apply

# Terraform validate
cd infra
terraform fmt -recursive
terraform validate

# Infra tests
pip install pytest python-hcl2
pytest infra/tests/ -v
```

## Architecture

```
User → CloudFront → Amplify (React SPA)
                 ↓
         API Gateway
             ↓
      Lambda handlers (per operation)
         ↓           ↓
      DynamoDB      S3 (24h TTL)
```

Lambda handler code lives in a separate private repository.
