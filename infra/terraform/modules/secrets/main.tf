variable "project" { type = string }
variable "environment" { type = string }
variable "database_url" {
  type      = string
  sensitive = true
}
variable "jwt_secret" {
  type      = string
  sensitive = true
}
variable "jwt_refresh_secret" {
  type      = string
  sensitive = true
}

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_secretsmanager_secret" "database_url" {
  name = "${local.name}/DATABASE_URL"
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id     = aws_secretsmanager_secret.database_url.id
  secret_string = var.database_url
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name = "${local.name}/JWT_SECRET"
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = var.jwt_secret
}

resource "aws_secretsmanager_secret" "jwt_refresh_secret" {
  name = "${local.name}/JWT_REFRESH_SECRET"
}

resource "aws_secretsmanager_secret_version" "jwt_refresh_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_refresh_secret.id
  secret_string = var.jwt_refresh_secret
}

output "database_url_arn" { value = aws_secretsmanager_secret.database_url.arn }
output "jwt_secret_arn" { value = aws_secretsmanager_secret.jwt_secret.arn }
output "jwt_refresh_secret_arn" { value = aws_secretsmanager_secret.jwt_refresh_secret.arn }
