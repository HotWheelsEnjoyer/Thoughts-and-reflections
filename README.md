# Reflection Journal & Gemini AI Companion

A production-grade, user-authenticated journaling and reflective coaching web application powered by the **Gemini 3.6 Flash API**, **Firebase Authentication**, **Cloud Firestore**, and **Google Maps Platform**.

The platform provides end-to-end user isolation, server-side role-based access control (RBAC), outbound SSRF defense for external webhooks, dual-key geospatial privacy, and comprehensive administrative moderation—built to adhere strictly to OWASP Top 10 Web & LLM standards and enterprise production directives.

---

## Key Features & Production Directives

* **AI Reflective Dialogue**: Multi-turn conversational coaching powered by `@google/genai` on an Express backend with an automated 4-tier model fallback ladder (`gemini-3.6-flash`, `gemini-2.5-flash`, etc.).
* **Google Maps Dual-Key Architecture (Directive 8)**:
  * *Browser Key*: Restricted strictly by HTTP referrer in Google Cloud Console, used only for the interactive Maps JavaScript client.
  * *Server Key*: Restricted by IP address and accessed strictly via Secret Manager on the backend for geocoding and reverse lookup proxies.
  * *Coordinate Validation & Data Minimization*: Server-side lat/lng range verification (`[-90, 90]` / `[-180, 180]`), optional ~100m privacy rounding, and SSRF-safe address resolution.
* **Administrative RBAC & Anti-Self-Elevation (Directive 9)**:
  * Authoritative server-side role resolution (roles never accepted from client input or tokens).
  * Firestore rules explicitly block users from mutating their own `role` field.
  * Full content moderation suite with note attachment and deletion capabilities.
  * Immutable audit logging (`/adminAuditLog/{logId}`) capturing who, what, before/after states, and timestamps; writable exclusively by the backend Admin SDK.
* **External Notification Pipeline & SSRF Guard (Directive 10)**:
  * Automated Slack Block Kit alerts dispatched when a user flags a reflection as `crisis_support` ("Crisis & Urgent Support").
  * Org-wide webhook stored in Google Cloud Secret Manager (`SLACK_WEBHOOK_URL`) with zero client-side exposure.
  * Comprehensive SSRF defense (`isPrivateOrRestrictedIp`): Pre-flight DNS resolution blocking cloud metadata (`169.254.169.254`), loopback (`127.0.0.1`), RFC1918 private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), carrier-grade NAT, non-standard ports, and HTTP redirects (`redirect: 'error'`).
  * Domain allowlist enforcement (`hooks.slack.com`, `discord.com`, `discordapp.com`).
  * Anti-ping payload sanitization disarming broadcast mentions (`@everyone`, `@here`, `<@...>`) and escaping Slack formatting brackets.
  * Per-user sliding token bucket rate limiter (max 5 alerts / 10m window) and 24-hour revision-based idempotency cache (`slack_${entryId}_${turnCount}`) with bounded memory management (CWE-400 mitigation).

---

## Architecture Overview

| Component | Technology | Purpose & Security Controls |
| :--- | :--- | :--- |
| **User Identity** | Firebase Auth | Federated Google Sign-In with popup. Authenticated session tokens. |
| **Database** | Cloud Firestore | Owner-isolated collections (`/users/{userId}/entries`) with zero-insecure defaults and coordinate shape rules. |
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
# 1. Gemini API Key
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# 2. Google Maps Server Key (IP-restricted)
gcloud secrets create GOOGLE_MAPS_SERVER_KEY --replication-policy="automatic"
echo -n "YOUR_MAPS_SERVER_KEY" | gcloud secrets versions add GOOGLE_MAPS_SERVER_KEY --data-file=-

# 3. Organization Slack Webhook URL (Directive 10)
gcloud secrets create SLACK_WEBHOOK_URL --replication-policy="automatic"
echo -n "https://hooks.slack.com/services/T000/B000/XXXX" | gcloud secrets versions add SLACK_WEBHOOK_URL --data-file=-

# 4. Grant Cloud Run runtime service account access to secrets
export PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")
for SECRET in GEMINI_API_KEY GOOGLE_MAPS_SERVER_KEY SLACK_WEBHOOK_URL; do
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

    // DIRECTIVE 9: Server-Side Role Helper
    function isAdmin() {
      return request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // DIRECTIVE 9: User Profiles with Anti-Self-Elevation
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

    // DIRECTIVE 9: Immutable Admin Audit Log (written exclusively by backend Admin SDK)
    match /adminAuditLog/{logId} {
      allow read: if isAdmin();
      allow write: if false;
    }

    // User Data Isolation & Location Shape Validation (Directives 8 & 9)
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

    match /users/{userId}/interactions/{interactionId} {
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
gcloud run deploy reflection-journal \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-secrets \
    GEMINI_API_KEY=GEMINI_API_KEY:latest,\
    GOOGLE_MAPS_SERVER_KEY=GOOGLE_MAPS_SERVER_KEY:latest,\
    SLACK_WEBHOOK_URL=SLACK_WEBHOOK_URL:latest

# 2. Apply campaign and verification resource labels
gcloud run services update reflection-journal \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=us-central1
```

---

## 6. Functional & Security Verification Walkthrough

The following 10 test cases verify end-to-end functionality and security compliance:

### Test Case 1: Authentication & Landing Isolation
* **Action**: Navigate to `/`.
* **Expected Result**: Clean landing view with security badges and "Continue with Google Sign-In". No user data or reflections are visible.

### Test Case 2: Multi-Turn Reflective Dialogue with Gemini
* **Action**: Sign in and submit a prompt (e.g., "I feel overwhelmed with prioritization").
* **Expected Result**: Server calls `gemini-3.6-flash` via the Express proxy. The AI provides guided reflection prompts and saves the turn to the conversation transcript.

### Test Case 3: Google Maps Dual-Key Location Attachment (Directive 8)
* **Action**: Click "Attach Reflection Place / Location", search for a location or click the interactive map.
* **Expected Result**:
  * Browser uses `VITE_GOOGLE_MAPS_BROWSER_KEY` for map rendering.
  * Search goes through `/api/maps/places` using `GOOGLE_MAPS_SERVER_KEY`.
  * Coordinates are validated within `[-90, 90]` and `[-180, 180]`.
  * User can toggle "~100m Privacy Rounding" before saving.

### Test Case 4: Owner Isolation & Firestore Rules Validation
* **Action**: Check Firestore document path `/users/{userId}/entries/{entryId}`.
* **Expected Result**: Document is written under the user's isolated document tree. Any attempt by another non-admin user to read this path results in `PERMISSION_DENIED`.

### Test Case 5: Role Resolution & Anti-Self-Elevation (Directive 9)
* **Action**: In the Admin Dashboard under the "RBAC Security" tab, click "Simulate Self-Elevation Attack".
* **Expected Result**: The backend rejects the attempt with `403 Forbidden` (`Admins cannot modify their own role. Anti-self-elevation enforced.`).

### Test Case 6: Content Moderation & Immutable Audit Trail
* **Action**: In the Admin Dashboard "Moderation Center", add a note or flag an entry.
* **Expected Result**: Action succeeds and generates an immutable record in `/adminAuditLog/{logId}` recording the admin's UID, action, before/after values, and timestamp.

### Test Case 7: Crisis Alert Slack Notification Trigger (Directive 10)
* **Action**: In the journal editor, switch Entry Type from `Standard Reflection` to `🚨 Crisis & Urgent Support` and save.
* **Expected Result**:
  * Automatic webhook dispatch triggers to Slack.
  * Slack Block Kit alert includes sanitized title, masked user ID, timestamp, and crisis coaching badge.
  * Webhook destination is masked in client logs (`hooks.slack.com/services/ORG_...`).

### Test Case 8: Outbound SSRF & Cloud Metadata Defense (Directive 10)
* **Action**: In the Admin Dashboard "Slack & SSRF Guard" tab, click the `🚨 Metadata SSRF (169.254.169.254)` test vector.
* **Expected Result**: SSRF inspector rejects the URL with `SSRF Violation: Resolved IP 169.254.169.254 belongs to a prohibited or link-local subnet`.

### Test Case 9: Webhook Rate Limiting & Flooding Protection
* **Action**: Rapidly dispatch multiple test alerts exceeding 5 per 10 minutes.
* **Expected Result**: Token bucket rate limiter triggers: `Notification rate limit exceeded (5 per 10m). Please retry after X seconds.`

### Test Case 10: Revision-Based Idempotency Caching
* **Action**: Save the same crisis entry twice without adding new dialogue turns.
* **Expected Result**: The second request is fulfilled from the idempotency cache (`slack_${entryId}_${turns.length}`) without issuing a duplicate outbound POST to Slack.

---

## 7. Security Reviewer Assessment (Directive 5 Summary)

| Vulnerability / Risk | Severity | Mitigation Applied |
| :--- | :---: | :--- |
| **Outbound Webhook HTTP Redirect Traversal** | **HIGH** | `redirect: 'error'` enforced on outbound `fetch()` to prevent 3xx redirects to internal cloud metadata. |
| **Unbounded In-Memory Cache Growth** | **HIGH** | Implemented 24-hour TTL and hard capacity limits with eviction for idempotency records and rate-limiting buckets (CWE-400 mitigation). |
| **Non-Standard Port Scanning** | **MEDIUM** | Strict restriction to standard HTTPS port 443 during webhook URL validation. |
| **TOCTOU DNS Rebinding** | **MEDIUM** | Domain allowlisting restricted to verified providers (`hooks.slack.com`, `discord.com`, `discordapp.com`). |
| **Mention & Ping Injection** | **LOW** | Server-side sanitizer neutralizes `@everyone`, `@here`, `<@...>`, and escapes mrkdwn formatting brackets. |
