# SuperDoc — Agent Briefing & Execution Plan

You are building **SuperDoc**: a fully serverless file conversion and editing platform.
No bloat, no subscriptions, no dark patterns. Everything runs on AWS Lambda, API Gateway,
S3, DynamoDB and Amplify. Costs must stay under $3/month at zero traffic.

Read this entire file before doing anything. Follow the rounds in order.
Never skip a round. Never start a round without completing the previous one.
Mark each round complete only when all tests pass.

---

## Core Principles

- **Serverless first** — Lambda for everything. ECS only when explicitly stated.
- **Least privilege IAM** — every Lambda gets its own scoped role. Nothing shared.
- **SOLID + DRY + Gang of Four** — one handler per operation, shared utilities in layers.
- **Circuit breaker + exponential retry** — use `tenacity` in every Lambda that calls external services.
- **No hardcoded values** — everything via Terraform variables or SSM Parameter Store.
- **Cost tags everywhere** — Project=superdoc, Env=dev|prod, Owner=pablo on every resource.
- **Tests always ship with code** — pytest for Lambda, Vitest for React, Playwright for E2E.
- **No X-Ray** — too costly. Structured JSON logging to CloudWatch only.
- **No WAF** — replaced by API Gateway throttling + CloudFront Functions (both free).
- **Mobile first** — every UI decision must work on 390px viewport.
- **No carousels** — ever.
- **File retention** — 12h free/anon, 30 days Basic, forever (Glacier) Teams.
- **TTL_SECONDS = 43200** (12h) in all Lambda code.

---

## AWS Account Info

- Alert email: pablobhz@gmail.com
- Domain: pablobhz.cloud (hosted zone already exists)
- App URL: superdoc.pablobhz.cloud
- Region: us-east-1

---

## Repository Strategy

Public repo (this): infra/ + frontend/ + CLAUDE.md + README.md
Private repo: handlers/ + layers/ + tests/

Never commit .tfvars, terraform.tfstate, or secrets to either repo.
Lambda zips built in private repo, uploaded to private S3, referenced via Terraform variables.

---

## Definition of Done (every round)

1. All code written and committed
2. All tests pass (pytest / Vitest / Playwright)
3. terraform validate + fmt pass
4. No secrets or state files committed
5. docs/CODEBASE_INTELLIGENCE.md updated

---

## Cost Target

~$2/month at zero traffic. Budget alarm at $5 (80%). Auto-disable anonymous at $20.
