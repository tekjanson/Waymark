# ──────────────────────────────────────────────────────────────
# outputs.tf — Useful values after apply
# ──────────────────────────────────────────────────────────────

output "project_id" {
  description = "GCP project ID"
  value       = var.project_id
}

# OAuth client ID and secret are managed in Cloud Console.
# The existing client ID is documented here for reference:
#   764742927885-fs0atq3ecenhndpdaaqkb0d0go1blt22.apps.googleusercontent.com

output "required_scopes" {
  description = "OAuth scopes that must be configured on the consent screen"
  value       = local.api_scopes
}

output "consent_screen_url" {
  description = "Direct link to the OAuth consent screen configuration"
  value       = "https://console.cloud.google.com/apis/credentials/consent?project=${var.project_id}"
}

output "credentials_url" {
  description = "Direct link to the OAuth credentials page"
  value       = "https://console.cloud.google.com/apis/credentials?project=${var.project_id}"
}
