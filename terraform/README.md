# WayMark — Terraform GCP Configuration

Manages the Google Cloud project configuration for WayMark, ensuring APIs and OAuth settings are defined as code.

## What Terraform manages

| Resource | Description |
|---|---|
| `google_project_service` | Enables Drive, Sheets, Picker, and People APIs |
| `google_iap_brand` | OAuth consent screen (application title, support email) |
| `google_iap_client` | OAuth 2.0 web client (client ID + secret) |
| `null_resource.verify_scopes` | Prints required scopes for manual verification |

## What must still be configured manually

The **OAuth consent screen scopes** cannot be managed by Terraform — the Google API does not expose this. After `terraform apply`, you must verify the scopes in Cloud Console match the list printed by the `verify_scopes` resource:

| Scope | Why |
|---|---|
| `https://www.googleapis.com/auth/drive.readonly` | Browse existing Drive folders and files |
| `https://www.googleapis.com/auth/drive.file` | Create/manage app-owned files (settings, snapshots) |
| `https://www.googleapis.com/auth/spreadsheets` | Read/write existing spreadsheets |

## Setup

```bash
# 1. Install Terraform (https://developer.hashicorp.com/terraform/install)

# 2. Authenticate with GCP
gcloud auth application-default login

# 3. Configure variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# 4. Initialize and apply
terraform init
terraform plan    # review changes
terraform apply   # apply changes
```

## Importing existing resources

If the GCP project already has these resources configured (it does), import them before the first apply:

```bash
# Import the existing IAP brand (consent screen)
terraform import google_iap_brand.waymark "projects/waymark-488818/brands/<BRAND_ID>"

# Import API services
terraform import google_project_service.drive "waymark-488818/drive.googleapis.com"
terraform import google_project_service.sheets "waymark-488818/sheets.googleapis.com"
terraform import google_project_service.picker "waymark-488818/picker.googleapis.com"
terraform import google_project_service.people "waymark-488818/people.googleapis.com"
```

To find your brand ID:
```bash
gcloud alpha iap oauth-brands list --project=waymark-488818
```

## Outputs

After apply, retrieve the OAuth credentials for your `.env`:

```bash
terraform output oauth_client_id
terraform output -raw oauth_client_secret
```

## Scope source of truth

The canonical scope list lives in `main.tf` under `locals.api_scopes`. This must match:
- `server/config.js` → `SCOPES` array
- Cloud Console → OAuth consent screen → Scopes
