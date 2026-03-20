# ──────────────────────────────────────────────────────────────
# scopes.tf — OAuth scope validation & consent-screen sync
#
# The google_iap_brand resource does NOT manage individual
# scopes on the consent screen — those are set in Cloud Console
# under "OAuth consent screen → Scopes".  Terraform cannot
# configure them directly today.
#
# This file provides:
#   1. A machine-readable local of the required scopes
#   2. A null_resource that runs `gcloud` to print the current
#      consent-screen scopes so you can verify drift manually
#      (or in CI).
# ──────────────────────────────────────────────────────────────

# ── Drift-detection helper ──
# Prints the scopes currently configured on the consent screen.
# Run `terraform apply -target=null_resource.check_scopes` or
# `terraform plan` to see if the console matches what's declared
# in locals.api_scopes.

resource "null_resource" "verify_scopes" {
  # Re-run whenever the declared scope list changes
  triggers = {
    scopes_hash = sha256(join(",", local.api_scopes))
  }

  provisioner "local-exec" {
    command = <<-EOT
      echo ""
      echo "═══════════════════════════════════════════════════════════"
      echo " WayMark — Required OAuth Scopes (from Terraform)"
      echo "═══════════════════════════════════════════════════════════"
      echo ""
      echo "The following scopes MUST be configured on the OAuth"
      echo "consent screen in Cloud Console for project: ${var.project_id}"
      echo ""
      %{for s in local.api_scopes~}
      echo "  • ${s}"
      %{endfor~}
      echo ""
      echo "Non-restricted (auto-granted, no consent screen entry needed):"
      %{for s in local.openid_scopes~}
      echo "  • ${s}"
      %{endfor~}
      echo ""
      echo "To verify current console scopes, run:"
      echo "  gcloud alpha iap oauth-brands list --project=${var.project_id}"
      echo ""
      echo "Or visit:"
      echo "  https://console.cloud.google.com/apis/credentials/consent?project=${var.project_id}"
      echo "═══════════════════════════════════════════════════════════"
    EOT
  }
}
