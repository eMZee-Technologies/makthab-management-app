module "networking" {
  source = "../../modules/networking"

  project           = var.project
  environment       = var.environment
  vpc_cidr          = var.vpc_cidr
  availability_zones = var.availability_zones
  use_nat_gateway   = var.use_nat_gateway
}

module "ecr" {
  source      = "../../modules/ecr"
  project     = var.project
  environment = var.environment
}

module "storage" {
  source      = "../../modules/storage"
  project     = var.project
  environment = var.environment
}

module "secrets" {
  source             = "../../modules/secrets"
  project            = var.project
  environment        = var.environment
  database_url       = "postgresql://${var.db_username}:${var.db_password}@${module.database.address}:5432/${var.db_name}?sslmode=require"
  jwt_secret         = var.jwt_secret
  jwt_refresh_secret = var.jwt_refresh_secret
}

module "database" {
  source = "../../modules/database"

  project            = var.project
  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  ecs_security_group_id = module.networking.ecs_security_group_id
  instance_class     = var.db_instance_class
  db_name            = var.db_name
  db_username        = var.db_username
  db_password        = var.db_password
}

module "ecs" {
  source = "../../modules/ecs"

  project               = var.project
  environment           = var.environment
  aws_region            = var.aws_region
  vpc_id                = module.networking.vpc_id
  public_subnet_ids     = module.networking.public_subnet_ids
  private_subnet_ids    = module.networking.private_subnet_ids
  alb_security_group_id = module.networking.alb_security_group_id
  ecs_security_group_id = module.networking.ecs_security_group_id
  container_image       = coalesce(var.container_image, "${module.ecr.repository_url}:latest")
  cpu                   = var.api_cpu
  memory                = var.api_memory
  desired_count         = var.desired_count
  files_bucket_name     = module.storage.files_bucket_name
  files_bucket_arn      = module.storage.files_bucket_arn
  secret_arns = {
    database_url       = module.secrets.database_url_arn
    jwt_secret         = module.secrets.jwt_secret_arn
    jwt_refresh_secret = module.secrets.jwt_refresh_secret_arn
  }
  client_origin = var.client_domain != "" ? "https://${var.client_domain}" : "*"
}

module "cdn" {
  source = "../../modules/cdn"

  providers = {
    aws           = aws
    aws.us_east_1 = aws.us_east_1
  }

  project           = var.project
  environment       = var.environment
  client_bucket_id  = module.storage.client_bucket_id
  client_bucket_arn = module.storage.client_bucket_arn
  client_domain     = var.client_domain
}

module "monitoring" {
  source = "../../modules/monitoring"

  project            = var.project
  environment        = var.environment
  alb_arn_suffix     = module.ecs.alb_arn_suffix
  ecs_cluster_name   = module.ecs.cluster_name
  ecs_service_name   = module.ecs.service_name
  rds_instance_id    = module.database.instance_id
  alarm_email        = var.alarm_email
}
