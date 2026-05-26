locals {
  common_tags = {
    Project               = var.project_name
    Environment           = var.environment
    Owner                 = var.owner
    ManagedBy             = "terraform"
    CostAllocationFeature = var.cost_allocation_feature
  }

  name_prefix = "${var.project_name}-${var.environment}"
}
