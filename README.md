# Thoughts and Reflections

A production-grade, privacy-first personal reflection and journaling companion powered by the **Gemini 3.6 Flash API**, **Firebase Authentication**, **Cloud Firestore**, and **Google Maps Platform**.

The platform provides end-to-end user isolation, dual authentication (Google Sign-In and salted SHA-256 email/password accounts), server-side role-based access control (RBAC), outbound SSRF defense for external notifications, dual-key geospatial privacy, and comprehensive administrative moderation—built to adhere strictly to OWASP Top 10 Web & LLM standards.

---

## Key Features & Security Architecture

* **Multi-Turn AI Reflective Dialogue**: Conversational coaching powered by `@google/genai` on an Express backend with an automated 4-tier model fallback ladder (`gemini-3.6-flash`, `gemini-3.1-flash-lite`, `gemini-flash-latest`, `gemini-3.7-flash`).
* **Dual Authentication Engine**:
  * *Google One-Click Sign-In*: Instant federated authentication via Firebase Auth with popup.
  * *Separated Email Sign Up & Sign In*: Dedicated registration and login workflows with client-salted SHA-256 password hashing, minimum 6-character complexity, and defense against duplicate registrations.
* **Mood & Sentiment Trend Dashboard**:
  * Constrained structured output schema on Gemini responses extracting bounded valence scores (`-1.0` to `+1.0`) and sentiment labels.
  * Strict per-user scoped trend timelines and chart visualizations with zero cross-user leakage.
* **Google Maps Dual-Key Architecture**:
  * *Browser Key*: Restricted strictly by HTTP referrer in Google Cloud Console, used only for the interactive Maps JavaScript client.
  * *Server Key*: Restricted by IP address and accessed strictly via Secret Manager on the backend for geocoding and reverse lookup proxies.
  * *Coordinate Validation & Data Minimization*: Server-side lat/lng range verification (`[-90, 90]` / `[-180, 180]`), optional ~100m privacy rounding, and SSRF-safe address resolution.
* **Administrative RBAC & Anti-Self-Elevation**:
  * Authoritative server-side role resolution (roles never accepted from client input or tokens).
  * Firestore rules explicitly block users from mutating their own `role` field.
  * Full content moderation suite with note attachment and deletion capabilities.
  * Immutable audit logging (`/adminAuditLog/{logId}`) capturing who, what, before/after states, and timestamps; writable exclusively by the backend Admin SDK.
* **External Notification Pipeline & SSRF Guard**:
  * Automated Slack Block Kit alerts dispatched when a user flags a reflection as `crisis_support` ("Crisis & Urgent Support").
  * Org-wide webhook stored in Google Cloud Secret Manager (`SLACK_WEBHOOK_URL`) with zero client-side exposure.
  * Comprehensive SSRF defense (`isPrivateOrRestrictedIp`): Pre-flight DNS resolution blocking cloud metadata (`169.254.169.254`), loopback (`127.0.0.1`), RFC1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), carrier-grade NAT, non-standard ports, and HTTP redirects (`redirect: 'error'`).
  * Domain allowlist enforcement (`hooks.slack.com`, `discord.com`, `discordapp.com`).
  * Anti-ping payload sanitization disarming broadcast mentions (`@everyone`, `@here`, `<@...>`) and escaping Slack formatting brackets.
  * Per-user sliding token bucket rate limiter (max 5 alerts / 10m window) and 24-hour revision-based idempotency cache (`slack_${entryId}_${turnCount}`) with bounded memory management (CWE-400 mitigation).
* **Expiring Shareable Read Links**:
  * 192-bit cryptographic entropy URLs with time-to-live expiration and instant one-click author revocation.
  * Field minimization stripping location and telemetry by default.

---

## Architecture Overview

| Component | Technology | Purpose & Security Controls |
| :--- | :--- | :--- |
| **User Identity** | Firebase Auth & Encrypted Auth | Federated Google Sign-In with popup + Salted SHA-256 Email/Password accounts. |
| **Database** | Cloud Firestore | Owner-isolated collections (`/users/{userId}/entries`) with zero-insecure defaults, coordinate shape rules, and mood score validation. |
| **AI Processing** | Gemini API (`@google/genai`) | Multi-turn coaching, brainstorming, summarization, and executive synthesis. |
| **Geospatial** | Google Maps Platform | Referrer-restricted browser JS API + IP-restricted server geocoding proxy. |
| **Notifications** | Slack Webhook Engine | Outbound SSRF pre-flight check, DNS IP validation, anti-ping sanitization, and idempotency. |
| **Admin Hub** | React 19 + Lucide Icons | 4-tab admin center: Moderation, Immutable Audit Logs, RBAC Exploit Testing, and SSRF Validator. |
| **Server Backend** | Express (Node/TS) + Vite | API gateway, Secret Manager integration, rate limiting, and SSRF inspection endpoints. |
| **Secrets** | GCP Secret Manager | Zero hardcoded credentials for Gemini, Google Maps, and Slack. |

---

## 1. Prerequisites & Environment Setup

Ensure you have Node.js (v20+) and the Google Cloud CLI (`gcloud`) installed:

```bash
# Authenticate with Google Cloud
gcloud auth login

# Set your target project ID
export PROJECT_ID="YOUR_PROJECT_ID"
gcloud config set project $PROJECT_ID

# Enable required GCP APIs
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  identitytoolkit.googleapis.com
```

---

## 2. Secret Management Setup (Zero-Hardcoding Hygiene)

Store application secrets in Google Cloud Secret Manager to ensure they are never committed to version control or included in client bundles:

```bash
# 1. Create and populate the Gemini API key secret
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# 2. Create Google Maps Server Key (IP-restricted)
gcloud secrets create GOOGLE_MAPS_SERVER_KEY --replication-policy="automatic"
echo -n "YOUR_MAPS_SERVER_KEY" | gcloud secrets versions add GOOGLE_MAPS_SERVER_KEY --data-file=-

# 3. Create Organization Slack Webhook URL
gcloud secrets create SLACK_WEBHOOK_URL --replication-policy="automatic"
echo -n "https://hooks.slack.com/services/T000/B000/XXXX" | gcloud secrets versions add SLACK_WEBHOOK_URL --data-file=-

# 4. Grant the default Cloud Run service account access to read secrets
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

for SECRET in GOOGLE_MAPS_SERVER_KEY SLACK_WEBHOOK_URL; do
  gcloud secrets add-iam-policy-binding $SECRET \
    --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 3. Database Security Rules (`firestore.rules`)

Deploy the comprehensive security rules enforcing owner data isolation, server-side RBAC, anti-self-elevation, and geospatial coordinate shape validation:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Zero-Insecure Defaults: Deny all unhandled operations
    match /{document=**} {
      allow read, write: if false;
    }

    // Server-Side Role Helper
    function isAdmin() {
      return request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // User Profiles with Anti-Self-Elevation
    match /users/{userId} {
      allow read: if request.auth != null && (request.auth.uid == userId || isAdmin());
      // Initial profile creation: Must be standard 'user' or unset
      allow create: if request.auth != null && request.auth.uid == userId
        && (!("role" in request.resource.data) || request.resource.data.role == 'user');
      // Anti-self-elevation: Users can update profile fields, but NEVER change their role
      allow update: if request.auth != null && request.auth.uid == userId
        && request.resource.data.role == resource.data.role;
      // Privileged role assignments require existing admin credentials
      allow write: if isAdmin();
    }

    // Immutable Admin Audit Log (written exclusively by backend Admin SDK)
    match /adminAuditLog/{logId} {
      allow read: if isAdmin();
      allow write: if false;
    }

    // User Interactions with Location & Mood Shape Validation
    match /users/{userId}/interactions/{interactionId} {
      allow create: if request.auth != null && request.auth.uid == userId
        && (!("location" in request.resource.data) ||
            (request.resource.data.location.lat is number &&
             request.resource.data.location.lat >= -90 &&
             request.resource.data.location.lat <= 90 &&
             request.resource.data.location.lng is number &&
             request.resource.data.location.lng >= -180 &&
             request.resource.data.location.lng <= 180))
        && (!("moodScore" in request.resource.data) ||
            (request.resource.data.moodScore is number &&
             request.resource.data.moodScore >= -1 &&
             request.resource.data.moodScore <= 1));
      allow read, update, delete: if request.auth != null && (request.auth.uid == userId || isAdmin());
    }

    // User Entries Data Isolation
    match /users/{userId}/entries/{entryId} {
      allow create: if request.auth != null && request.auth.uid == userId
        && (!("location" in request.resource.data) ||
            request.resource.data.location == null ||
            (request.resource.data.location.lat is number &&
             request.resource.data.location.lat >= -90 &&
             request.resource.data.location.lat <= 90 &&
             request.resource.data.location.lng is number &&
             request.resource.data.location.lng >= -180 &&
             request.resource.data.location.lng <= 180));
      allow update: if (request.auth != null && request.auth.uid == userId
        && (!("location" in request.resource.data) ||
            request.resource.data.location == null ||
            (request.resource.data.location.lat is number &&
             request.resource.data.location.lat >= -90 &&
             request.resource.data.location.lat <= 90 &&
             request.resource.data.location.lng is number &&
             request.resource.data.location.lng >= -180 &&
             request.resource.data.location.lng <= 180)))
        || isAdmin();
      allow read, delete: if request.auth != null && (request.auth.uid == userId || isAdmin());
    }

    // Expiring Share Links: Backend-only access via Admin SDK
    match /shareLinks/{token} {
      allow read, write: if false;
    }
  }
}
```

Deploy the rules via Firebase CLI:
```bash
firebase deploy --only firestore:rules
```

---

## 4. Local Development

Initialize your local environment file:

```bash
cp .env.example .env
```

Configure your `.env` parameters:
* `GEMINI_API_KEY`: Gemini Developer API key.
* `VITE_FIREBASE_*`: Firebase Client web SDK configuration values.
* `VITE_GOOGLE_MAPS_BROWSER_KEY`: Maps JavaScript API browser key (referrer-restricted).
* `GOOGLE_MAPS_SERVER_KEY`: Geocoding / Places lookup backend key (IP-restricted).
* `SLACK_WEBHOOK_URL`: Org-wide Slack incoming webhook URL for alert notifications.

Run the development server:

```bash
npm install
npm run dev
```

The unified full-stack server starts on `http://localhost:3000`.

---

## 5. Cloud Run Production Deployment

Deploy the container to Google Cloud Run with Secret Manager environment bindings:

```bash
# 1. Build and deploy container to Cloud Run
gcloud run deploy thoughts-and-reflections \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-secrets \
    GEMINI_API_KEY=GEMINI_API_KEY:latest,\
    GOOGLE_MAPS_SERVER_KEY=GOOGLE_MAPS_SERVER_KEY:latest,\
    SLACK_WEBHOOK_URL=SLACK_WEBHOOK_URL:latest

# 2. Apply campaign verification resource labels
gcloud run services update thoughts-and-reflections \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=us-central1
```

---

## 6. Functional & Security Verification Walkthrough

The following test cases verify end-to-end functionality and security compliance:

### Test Case 1: Authentication & Landing Page Isolation
* **Action**: Navigate to `/`.
* **Expected Result**: Clean landing view with security badges, "Continue with Google Sign-In", and an expandable Email Sign Up / Sign In form. No user reflections or personal data are exposed before authentication.

### Test Case 2: Email Sign Up with Salted Password
* **Action**: Click "Or sign up / sign in with email & password", select the **Sign Up (New Account)** tab, input email and 6+ character password with confirmation, and submit.
* **Expected Result**: The account is created with a cryptographic SHA-256 hash. The user is logged in directly to their private workspace.

### Test Case 3: Email Sign In & Credential Validation
* **Action**: Sign out, select the **Sign In** tab, input the registered email with an invalid password, and submit.
* **Expected Result**: System rejects the request: *"Incorrect password for this email address. Please check your password and try again."* When the correct password is provided, access is granted immediately.

### Test Case 4: Google Sign-In Override
* **Action**: Click "Continue with Google".
* **Expected Result**: Immediate federated authentication bypassing email password requirements.

### Test Case 5: Multi-Turn Reflective Dialogue with Gemini
* **Action**: In the reflection workspace, submit a journal thought (e.g., "I feel overwhelmed with prioritization").
* **Expected Result**: Server calls `gemini-3.6-flash` via the Express proxy with automated fallback. The AI provides guided reflection prompts and saves the turn to the conversation transcript.

### Test Case 6: Mood Trend & Sentiment Extraction
* **Action**: Submit multiple reflections across different emotional states.
* **Expected Result**: Gemini extracts structured valence scores (`-1.0` to `+1.0`) and sentiment tags. The "Mood Trends" tab renders interactive charts isolated strictly to the authenticated user.

### Test Case 7: Google Maps Dual-Key Location Attachment
* **Action**: Click "Attach Reflection Place / Location", search for a location or click the interactive map.
* **Expected Result**:
  * Browser uses `VITE_GOOGLE_MAPS_BROWSER_KEY` for map rendering.
  * Search goes through `/api/maps/places` using `GOOGLE_MAPS_SERVER_KEY`.
  * Coordinates are validated within `[-90, 90]` and `[-180, 180]`.
  * User can toggle "~100m Privacy Rounding" before saving.

### Test Case 8: Owner Isolation & Firestore Rules Validation
* **Action**: Inspect Firestore document path `/users/{userId}/interactions/{interactionId}`.
* **Expected Result**: Document is written under the user's isolated document tree. Any attempt by another non-admin user to read this path results in `PERMISSION_DENIED`.

### Test Case 9: Expiring Shareable Read Links
* **Action**: Click "Share Reflection", select an expiration window (1 hour, 24 hours, or 7 days), and copy the link.
* **Expected Result**: Generates a 192-bit URL-safe token. Viewing the link displays a sanitized, read-only view. Clicking "Revoke Access" instantly invalidates the link.

### Test Case 10: Role Resolution & Anti-Self-Elevation
* **Action**: In the Admin Dashboard under the "RBAC Security" tab, click "Simulate Self-Elevation Attack".
* **Expected Result**: The backend rejects the attempt with `403 Forbidden` (`Admins cannot modify their own role. Anti-self-elevation enforced.`).

### Test Case 11: Crisis Alert Slack Notification Trigger & SSRF Guard
* **Action**: Switch Entry Type to `🚨 Crisis & Urgent Support` and save. In the Admin Dashboard "Slack & SSRF Guard" tab, test vector `🚨 Metadata SSRF (169.254.169.254)`.
* **Expected Result**:
  * Outbound webhook dispatches with sanitized mention protection.
  * Metadata SSRF attempt is blocked with: `SSRF Violation: Resolved IP 169.254.169.254 belongs to a prohibited or link-local subnet`.

---

## 7. Security Architecture & Threat Mitigations

| Vulnerability / Risk | Severity | Mitigation Applied |
| :--- | :---: | :--- |
| **Outbound Webhook HTTP Redirect Traversal** | **HIGH** | `redirect: 'error'` enforced on outbound `fetch()` to prevent 3xx redirects to internal cloud metadata. |
| **Unbounded In-Memory Cache Growth** | **HIGH** | Implemented 24-hour TTL and hard capacity limits with eviction for idempotency records and rate-limiting buckets (CWE-400 mitigation). |
| **Credential & Key Exposure** | **HIGH** | GCP Secret Manager integration for all API keys, webhook URLs, and server credentials; zero hardcoding. |
| **Non-Standard Port Scanning** | **MEDIUM** | Strict restriction to standard HTTPS port 443 during webhook URL validation. |
| **TOCTOU DNS Rebinding** | **MEDIUM** | Domain allowlisting restricted to verified providers (`hooks.slack.com`, `discord.com`, `discordapp.com`). |
| **Mention & Ping Injection** | **LOW** | Server-side sanitizer neutralizes `@everyone`, `@here`, `<@...>`, and escapes mrkdwn formatting brackets. |


