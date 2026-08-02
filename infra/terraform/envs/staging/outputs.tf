output "vpc_id" {
  value = module.networking.vpc_id
}

output "ecr_repository_url" {
  value = module.ecr.repository_url
}

output "alb_dns_name" {
  value = module.ecs.alb_dns_name
}

output "api_url" {
  value = var.api_domain != "" ? "https://${var.api_domain}" : "http://${module.ecs.alb_dns_name}"
}

output "cloudfront_domain_name" {
  value = module.cdn.distribution_domain_name
}

output "client_bucket_name" {
  value = module.storage.client_bucket_name
}

output "files_bucket_name" {
  value = module.storage.files_bucket_name
}

output "rds_endpoint" {
  value = module.database.address
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_name" {
  value = module.ecs.service_name
}
