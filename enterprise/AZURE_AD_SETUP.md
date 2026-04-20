# Azure AD (Microsoft Entra ID) Setup

OpenClaw Enterprise supports Azure AD single sign-on. Users can choose "Sign in with Microsoft" or traditional Employee ID + Password on the login page.

This guide covers how to configure Azure AD for OpenClaw Enterprise.

## Prerequisites

- An Azure AD tenant (Microsoft Entra ID)
- Global Administrator or Application Administrator role

## Step 1: Register an Application

1. Go to [Azure Portal](https://portal.azure.com) > **Microsoft Entra ID** > **App registrations** > **New registration**
2. Fill in:
   - **Name**: `OpenClaw Enterprise`
   - **Supported account types**: *Accounts in this organizational directory only* (single tenant)
   - **Redirect URI**: skip for now
3. Click **Register**
4. Note down:
   - **Application (client) ID** — this is your `AZURE_CLIENT_ID`
   - **Directory (tenant) ID** — this is your `AZURE_TENANT_ID`

## Step 2: Configure Platform (SPA)

1. Go to **Authentication** > **Add a platform** > **Single-page application**
2. Add Redirect URIs based on your environment:

| Environment | Redirect URI |
|---|---|
| Local dev (Vite) | `http://localhost:3000` |
| EC2 via SSM port forwarding | `http://localhost:8099` |
| Production (with domain) | `https://your-domain.com` |

3. Under **Implicit grant and hybrid flows**, leave all checkboxes **unchecked** (the app uses Authorization Code Flow with PKCE)
4. Click **Save**

> **Note**: Azure AD allows HTTP only for `localhost`. Production must use HTTPS.

## Step 3: Set Environment Variables

### Local development

Create `enterprise/admin-console/.env`:

```env
VITE_AZURE_CLIENT_ID=<your-client-id>
VITE_AZURE_TENANT_ID=<your-tenant-id>
```

Create `enterprise/.env` (for the backend):

```env
AZURE_CLIENT_ID=<your-client-id>
AZURE_TENANT_ID=<your-tenant-id>
```

### EC2 deployment

Set in `/etc/openclaw/env`:

```env
AZURE_CLIENT_ID=<your-client-id>
AZURE_TENANT_ID=<your-tenant-id>
```

The `ec2-setup.sh` script injects these into the Vite build automatically:

```bash
VITE_AZURE_CLIENT_ID='${AZURE_CLIENT_ID}' \
VITE_AZURE_TENANT_ID='${AZURE_TENANT_ID}' \
npx vite build
```

## Step 4: Link Azure AD Users to DynamoDB

Azure AD authenticates the user, but **roles and permissions come from DynamoDB**. Each Azure AD user needs a matching employee record with a matching `email` field.

Example DynamoDB item:

| Field | Value |
|---|---|
| PK | `ORG#acme` |
| SK | `EMP#emp-jsmith` |
| email | `jsmith@yourcompany.com` |
| role | `admin` / `manager` / `employee` |
| departmentId | `dept-engineering` |
| ... | ... |

When a user signs in with Microsoft, the backend:
1. Validates the Azure AD token (RS256, via JWKS)
2. Extracts the email from the token claims
3. Looks up the DynamoDB employee record by email
4. Returns the employee's role and permissions

> **External / Guest users**: Azure AD encodes guest emails as `user_domain.com#EXT#@tenant.onmicrosoft.com`. The backend handles this automatically.

## How It Works

```
Browser
  → "Sign in with Microsoft"
  → Azure AD login page (Authorization Code + PKCE)
  → Redirect back with auth code
  → MSAL.js exchanges code for ID token
  → Frontend sends ID token to backend
  → Backend validates RS256 token via Azure AD JWKS endpoint
  → Backend maps email → DynamoDB employee
  → Returns user profile + role
```

The app never sees the user's Microsoft password. All token validation happens server-side using Azure AD's public keys.

## Optional: Disable Azure AD

If you don't need Azure AD, simply leave the environment variables empty. The login page will still show the Microsoft button, but clicking it will log a console error. Users can still sign in with Employee ID + Password.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Click "Sign in with Microsoft" → returns to login page | Redirect URI mismatch | Check Azure AD > Authentication > Redirect URIs matches your URL exactly |
| Login succeeds but shows "Employee not found" | No DynamoDB record with matching email | Create an employee record with the correct `email` field |
| `AADSTS50011` error | Redirect URI not registered | Add the exact URI (including port) to Azure AD |
| `AADSTS700054` error | Wrong response_type | Ensure platform type is **Single-page application**, not Web |
