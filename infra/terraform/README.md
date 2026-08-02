# Makthab — AWS infrastructure (Terraform)

Implements Phase 2 of
[`docs/architecture/redesign/02-cloud-deployment-aws.md`](../../docs/architecture/redesign/02-cloud-deployment-aws.md):
VPC, RDS PostgreSQL, ECS Fargate + ALB, S3 (files + client), CloudFront, Secrets
Manager, ECR, CloudWatch alarms, and an AWS Budgets alert.

## Layout

```
infra/terraform/
  modules/
    networking/   # VPC, subnets, SGs, VPC endpoints (S3/ECR/Secrets/Logs)
    database/     # RDS PostgreSQL 16 Single-AZ
    ecr/          # API image repository
    storage/      # files + client S3 buckets
    secrets/      # DATABASE_URL, JWT secrets
    ecs/          # Fargate service + ALB + IAM
    cdn/          # CloudFront for SPA
    monitoring/   # Alarms + SNS (+ optional Budgets)
  envs/
    staging/      # Wire-up for the staging environment
```

## Prerequisites

- Terraform >= 1.5
- AWS credentials with rights to create the resources above
- Docker (for local image smoke tests)

## Bootstrap staging

```bash
cd infra/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars
# Edit tfvars: set db_password, jwt_secret, jwt_refresh_secret, alarm_email

export TF_VAR_db_password='…'
export TF_VAR_jwt_secret='…'
export TF_VAR_jwt_refresh_secret='…'

terraform init
terraform plan
terraform apply
```

Capture outputs (`ecr_repository_url`, `alb_dns_name`, `client_bucket_name`,
`cloudfront_domain_name`) for GitHub Actions secrets.

## First image push (manual)

```bash
AWS_REGION=us-east-1
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO=$(terraform -chdir=infra/terraform/envs/staging output -raw ecr_repository_url)

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -t "$REPO:bootstrap" -f Dockerfile .
docker push "$REPO:bootstrap"

aws ecs update-service \
  --cluster makthab-staging \
  --service makthab-staging-api \
  --force-new-deployment
```

## Cost posture

Default config avoids a NAT Gateway (`use_nat_gateway = false`) and uses VPC
endpoints instead — the largest monthly saving called out in the redesign doc.
RDS is Single-AZ `db.t4g.micro`. Expected ballpark: **~$50–65/mo** for staging
shaped like production.

## Related docs

- [AWS runbook](../../docs/deployment/AWS_RUNBOOK.md) — backup/restore + smoke checklist
- Application storage adapter: `server/src/lib/storage` (`FILE_STORAGE=local|s3`)
