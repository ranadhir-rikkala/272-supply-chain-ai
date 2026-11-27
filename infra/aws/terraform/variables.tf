variable "region" {
  description = "AWS region for every resource."
  type        = string
  default     = "us-east-2"
}

variable "project" {
  description = "Name prefix for resources."
  type        = string
  default     = "supplychain-ai"
}

variable "image_tag" {
  description = "Tag of the images in ECR that the services run."
  type        = string
  default     = "latest"
}

variable "services_enabled" {
  description = "Run one task per service. Leave false until the database is migrated."
  type        = bool
  default     = false
}

variable "db_instance_class" {
  description = "RDS instance size. AWS Free plan accounts only allow micro sizes; use db.t4g.medium or larger on a paid plan."
  type        = string
  default     = "db.t4g.micro"
}

variable "alert_email" {
  description = "Email for AWS budget alerts. Leave empty to skip the budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly cost that triggers budget alerts (at 50, 80 and 100 percent)."
  type        = number
  default     = 50
}
