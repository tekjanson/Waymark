# ──────────────────────────────────────────────────────────────
# variables.tf — Input variables for WayMark GCP configuration
# ──────────────────────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "Default GCP region"
  type        = string
  default     = "us-central1"
}

# ── OAuth (reference only — managed in Cloud Console) ──
# The consent screen and OAuth client cannot be managed by
# Terraform after the IAP OAuth Admin API deprecation (July 2025).
# These locals document the expected configuration.

locals {
  oauth_client_id = "764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com"

  oauth_redirect_uris = [
    "https://swiftirons.com/waymark/auth/callback",
    "http://localhost:3000/auth/callback",
  ]

  oauth_javascript_origins = [
    "https://swiftirons.com",
    "http://localhost:3000",
  ]
}
