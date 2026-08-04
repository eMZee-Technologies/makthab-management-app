variable "project" { type = string }
variable "environment" { type = string }

locals {
  name = "${var.project}-${var.environment}"
}

resource "aws_ecr_repository" "api" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "production"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = local.name }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}

output "repository_url" { value = aws_ecr_repository.api.repository_url }
output "repository_arn" { value = aws_ecr_repository.api.arn }
output "repository_name" { value = aws_ecr_repository.api.name }
