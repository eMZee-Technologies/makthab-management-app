variable "aws_region" {
  type        = string
  description = "Primary AWS region for API/RDS/S3 (not CloudFront ACM)."
  default     = "us-east-1"
}

variable "environment" {
  type        = string
  description = "Environment name (staging | production)."
  default     = "staging"
}

variable "project" {
  type    = string
  default = "makthab"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "Two AZs required for ALB."
  default     = ["us-east-1a", "us-east-1b"]
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_name" {
  type    = string
  default = "makthab"
}

variable "db_username" {
  type    = string
  default = "makthab"
}

variable "db_password" {
  type        = string
  description = "Initial RDS master password. Rotate via Secrets Manager after bootstrap."
  sensitive   = true
}

variable "jwt_secret" {
  type      = string
  sensitive = true
}

variable "jwt_refresh_secret" {
  type      = string
  sensitive = true
}

variable "backup_internal_token" {
  type        = string
  sensitive   = true
  description = "Shared secret injected as BACKUP_INTERNAL_TOKEN (X-Makthab-Backup-Token)."
}

variable "container_image" {
  type        = string
  description = "Full ECR image URI including tag (updated by CI on deploy)."
  default     = ""
}

variable "api_cpu" {
  type    = number
  default = 256 # 0.25 vCPU
}

variable "api_memory" {
  type    = number
  default = 512 # MB
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "client_domain" {
  type        = string
  description = "Public SPA hostname (e.g. app.example.com). Leave empty to skip custom domain."
  default     = ""
}

variable "api_domain" {
  type        = string
  description = "Public API hostname (e.g. api.example.com). Leave empty to use ALB DNS only."
  default     = ""
}

variable "alarm_email" {
  type        = string
  description = "Email subscribed to CloudWatch alarm SNS topic."
  default     = ""
}

variable "use_nat_gateway" {
  type        = bool
  description = "If false (default), use VPC endpoints instead of NAT to cut ~$32/mo."
  default     = false
}
