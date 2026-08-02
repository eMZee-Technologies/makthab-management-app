# Makthab AWS deployment runbook

Operational companion to
[`docs/architecture/redesign/02-cloud-deployment-aws.md`](../architecture/redesign/02-cloud-deployment-aws.md)
and [`infra/terraform/README.md`](../../infra/terraform/README.md).

## Targets (Phase 2)

| Metric | Value |
|---|---|
| RPO | 24h automated snapshots; PITR ~5 min within retention |
| RTO | 4 hours (manual restore runbook) |

## Secrets

| Secret | Source |
|---|---|
| `DATABASE_URL` | Secrets Manager → ECS task `secrets` |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Secrets Manager → ECS task `secrets` |
| `S3_FILES_BUCKET` / `FILE_STORAGE=s3` | ECS task environment (Terraform) |

Never bake secrets into the Docker image or commit `.tfvars` with real passwords.

## Smoke checklist (post-deploy / post-restore)

Mirror `BUILD_CONTRACT.md` §7 against the live environment:

1. `GET /health` through the ALB returns `{ data: { status: "ok" } }`.
2. SPA loads from CloudFront; CORS allows the CloudFront origin.
3. Login as admin → admit student → collect fee → confirm receipt exists in S3
   (`receipts/…` prefix) and is downloadable via the API.
4. Mark attendance → add expense → run a PDF and an Excel report.
5. Optional: kill one ECS task; ALB should drain it and a replacement become healthy.

## RDS restore (PITR or snapshot)

1. In RDS console (or CLI), restore to a **new** instance from the latest
   automated snapshot or a PITR timestamp. Do not overwrite the live instance
   until the restore is validated.
2. Update Secrets Manager `…/DATABASE_URL` to point at the new endpoint
   (keep `?sslmode=require`).
3. Force a new ECS deployment so tasks pick up the secret:
   ```bash
   aws ecs update-service --cluster makthab-staging --service makthab-staging-api --force-new-deployment
   ```
4. Run the smoke checklist above.
5. Only after success: retire the old instance (final snapshot if production).

## S3 file recovery

Files bucket versioning is enabled. To undelete/overwrite recovery:

```bash
aws s3api list-object-versions --bucket makthab-staging-files --prefix receipts/
# Restore a prior version with copy-object + VersionId, or undelete delete markers.
```

## Alarms

CloudWatch alarms publish to the `${project}-${env}-alarms` SNS topic
(ALB 5xx, ECS running count, RDS free storage, RDS CPU). Confirm the email
subscription after `terraform apply`.

## Local vs AWS file storage

| Mode | Env | Behaviour |
|---|---|---|
| Local (default) | `FILE_STORAGE=local` | Writes under `data/files/` |
| S3 | `FILE_STORAGE=s3` + `S3_FILES_BUCKET` | Same logical keys in S3; task role needs `s3:Put/Get/Delete` |

Receipt PDFs already go through `server/src/lib/storage`. Photos/payslips/reports
should migrate to the same adapter before scaling past one ECS task.
