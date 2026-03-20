# ──────────────────────────────────────────────────────────────
# main.tf — WayMark GCP project configuration
#
# Manages: API enablement, OAuth consent screen, OAuth client.
# Ensures the exact scopes declared here match what the app
# requests at runtime (server/config.js SCOPES array).
# ──────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ── Canonical scope list ──
# This is the single source of truth. server/config.js must match.

locals {
  # Non-restricted scopes (no verification required)
  openid_scopes = [
    "openid",
    "email",
    "profile",
  ]

  # API scopes — only drive.file (non-restricted, no verification needed)
  # Google Picker grants drive.file access to user-selected files,
  # removing the need for drive.readonly and spreadsheets scopes.
  api_scopes = [
    "https://www.googleapis.com/auth/drive.file", # manage files created or selected via Picker
  ]

  all_scopes = concat(local.openid_scopes, local.api_scopes)
}

# ──────────────────────────────────────────────
# 1. Enable required Google APIs
# ──────────────────────────────────────────────

resource "google_project_service" "drive" {
  service            = "drive.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "sheets" {
  service            = "sheets.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "picker" {
  service            = "picker.googleapis.com"
  disable_on_destroy = false
}

resource "google_project_service" "people" {
  service            = "people.googleapis.com"
  disable_on_destroy = false
}

# ──────────────────────────────────────────────
# 2. OAuth consent screen & client
# ──────────────────────────────────────────────
# The google_iap_brand and google_iap_client resources
# were deprecated in July 2025 (IAP OAuth Admin API
# sunset). OAuth consent screen and client credentials
# must be managed in Cloud Console:
#
#   Consent screen: https://console.cloud.google.com/apis/credentials/consent?project=waymark-488818
#   Credentials:    https://console.cloud.google.com/apis/credentials?project=waymark-488818
#
# The required scopes and client config are documented
# in this Terraform as the canonical source of truth,
# even though Terraform cannot manage them directly.
