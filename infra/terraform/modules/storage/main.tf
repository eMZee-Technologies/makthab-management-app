variable "project" { type = string }
variable "environment" { type = string }
variable "kms_key_arn" {
  type        = string
  description = "Customer-managed KMS key ARN for SSE-KMS (null → AES256)"
  default     = null
}

locals {
  name         = "${var.project}-${var.environment}"
  use_kms      = var.kms_key_arn != null
  sse_algorithm = local.use_kms ? "aws:kms" : "AES256"
}

resource "aws_s3_bucket" "files" {
  bucket = "${local.name}-files"
  tags   = { Name = "${local.name}-files" }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.sse_algorithm
      kms_master_key_id = local.use_kms ? var.kms_key_arn : null
    }
    bucket_key_enabled = local.use_kms
  }
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    id     = "archive-old-docs"
    status = "Enabled"
    filter { prefix = "" }
    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }
  }
}

resource "aws_s3_bucket" "client" {
  bucket = "${local.name}-client"
  tags   = { Name = "${local.name}-client" }
}

resource "aws_s3_bucket_public_access_block" "client" {
  bucket                  = aws_s3_bucket.client.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "client" {
  bucket = aws_s3_bucket.client.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.sse_algorithm
      kms_master_key_id = local.use_kms ? var.kms_key_arn : null
    }
    bucket_key_enabled = local.use_kms
  }
}

output "files_bucket_name" { value = aws_s3_bucket.files.bucket }
output "files_bucket_arn" { value = aws_s3_bucket.files.arn }
output "client_bucket_name" { value = aws_s3_bucket.client.bucket }
output "client_bucket_id" { value = aws_s3_bucket.client.id }
output "client_bucket_arn" { value = aws_s3_bucket.client.arn }
