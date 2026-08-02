terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      version               = "~> 5.60"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

variable "project" { type = string }
variable "environment" { type = string }
variable "client_bucket_id" { type = string }
variable "client_bucket_arn" { type = string }
variable "client_domain" {
  type    = string
  default = ""
}

locals {
  name             = "${var.project}-${var.environment}"
  has_custom_domain = var.client_domain != ""
}

resource "aws_cloudfront_origin_access_control" "client" {
  name                              = "${local.name}-client-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "client" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${local.name} SPA"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  aliases             = local.has_custom_domain ? [var.client_domain] : []

  origin {
    domain_name              = "${var.client_bucket_id}.s3.amazonaws.com"
    origin_id                = "s3-client"
    origin_access_control_id = aws_cloudfront_origin_access_control.client.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "s3-client"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }
  }

  # SPA fallback: unknown paths → index.html
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    cloudfront_default_certificate = !local.has_custom_domain
    acm_certificate_arn            = local.has_custom_domain ? aws_acm_certificate.client[0].arn : null
    ssl_support_method             = local.has_custom_domain ? "sni-only" : null
    minimum_protocol_version       = local.has_custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  tags = { Name = "${local.name}-cdn" }
}

resource "aws_acm_certificate" "client" {
  count                     = local.has_custom_domain ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.client_domain
  validation_method         = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_s3_bucket_policy" "client" {
  bucket = var.client_bucket_id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFront"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${var.client_bucket_arn}/*"
      Condition = {
        StringEquals = {
          "AWS:SourceArn" = aws_cloudfront_distribution.client.arn
        }
      }
    }]
  })
}

output "distribution_id" { value = aws_cloudfront_distribution.client.id }
output "distribution_domain_name" { value = aws_cloudfront_distribution.client.domain_name }
