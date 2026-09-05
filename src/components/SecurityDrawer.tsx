import React from 'react';
import { ShieldCheck, X, Lock, Key, Database, Cpu, CheckCircle } from 'lucide-react';

interface SecurityDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SecurityDrawer: React.FC<SecurityDrawerProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-xs p-4">
      <div className="bg-white border border-stone-200 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-stone-200">
          <div className="flex items-center gap-2 text-stone-900 font-serif font-semibold text-lg">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <span>Architecture & Security Threat Model</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-4 space-y-5 text-xs text-stone-700 leading-relaxed">
          {/* 5 Threat Zones */}
          <div>
            <h4 className="font-semibold text-stone-900 text-sm mb-2">The 5 Threat Zones Implemented</h4>
            <div className="space-y-2">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">1. Input Surfaces (OWASP A03 / LLM02)</p>
                <p className="text-stone-600 mt-0.5">
                  Text length clamped to 8,000 chars, null-safe payload destructuring, and schema validation on every API endpoint.
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">2. Planning & Reasoning (OWASP LLM01)</p>
                <p className="text-stone-600 mt-0.5">
                  System instructions treat all user reflections as passive data, mitigating prompt injection or system prompt overrides.
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">3. Tool Execution & Resilience</p>
                <p className="text-stone-600 mt-0.5">
                  Server-side proxy handles all Gemini API calls. Resilient 4-tier model fallback ladder (<code>gemini-3.6-flash</code> &rarr; <code>gemini-3.1-flash-lite</code> &rarr; <code>gemini-flash-latest</code> &rarr; <code>gemini-3.7-flash</code>).
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">4. Memory & State (Zero Insecure Defaults & Shape Validation)</p>
                <p className="text-stone-600 mt-0.5">
                  Strict Firestore user isolation: <code>request.auth.uid == userId</code> on <code>/users/{'{userId}'}/entries/{'{entryId}'}</code>. Coordinate bounds validation in rules (<code>lat: -90..90</code>, <code>lng: -180..180</code>).
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">5. Inter-System Communication & Directive 8 Maps Integration</p>
                <p className="text-stone-600 mt-0.5">
                  Strict key separation (browser referrer-restricted key vs server IP-restricted key). Backend proxy pattern for reverse geocoding. SSRF guard on outbound Maps requests. Data minimization with ~100m coordinate rounding.
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">6. Directive 9 — Admin RBAC, Anti-Self-Elevation & Immutable Audit Trail</p>
                <p className="text-stone-600 mt-0.5">
                  Server-side role resolution (<code>isAdmin()</code> in rules &amp; server authority). Users strictly blocked from modifying their own <code>role</code> field (<code>request.resource.data.role == resource.data.role</code>). Immutable audit logs stored in <code>adminAuditLog</code> with <code>allow write: if false;</code> (written only by Admin backend).
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">7. Directive 10 — External Notification & SSRF Guard (Slack Alerts)</p>
                <p className="text-stone-600 mt-0.5">
                  Pre-flight DNS validation resolving hostnames, filtering against RFC-1918/link-local/cloud metadata IP ranges (169.254.169.254), allowlisting authorized webhook domains, payload sanitization stripping <code>@everyone</code> / <code>@here</code> / role pings, per-user rate limiting, and SHA-256 idempotency caching.
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">8. Directive 11 — Expiring Shareable Read Links (Zero-Account Access)</p>
                <p className="text-stone-600 mt-0.5">
                  192-bit cryptographic entropy tokens (<code>crypto.randomBytes(24).toString('base64url')</code>) disconnected from Firestore IDs. Hardened Firestore rules blocking all direct client reads/writes (<code>match /shareLinks/{'{token}'} &#123; allow read, write: if false; &#125;</code>). Backend-only Admin SDK evaluation of revocation and expiry on every read. Strict data minimization stripping location and mood sentiment by default. Abuse throttling at 30 reads/min.
                </p>
              </div>
            </div>
          </div>

          {/* Firestore Security Rules Preview */}
          <div>
            <h4 className="font-semibold text-stone-900 text-sm mb-2">Firestore Security Rules (Directives 8, 9 & 11 Validated)</h4>
            <pre className="p-3 bg-stone-900 text-stone-100 rounded-xl font-mono text-[11px] overflow-x-auto">
{`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    function isAdmin() {
      return request.auth != null &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    match /users/{userId} {
      allow read: if request.auth != null && (request.auth.uid == userId || isAdmin());
      allow create: if request.auth != null && request.auth.uid == userId
        && (!("role" in request.resource.data) || request.resource.data.role == 'user');
      allow update: if request.auth != null && request.auth.uid == userId
        && request.resource.data.role == resource.data.role;
      allow write: if isAdmin();
    }

    match /users/{userId}/entries/{entryId} {
      allow create, update: if request.auth != null &&
        (request.auth.uid == userId || isAdmin())
        && (!("location" in request.resource.data) ||
            request.resource.data.location == null ||
            (request.resource.data.location.lat is number &&
             request.resource.data.location.lat >= -90 &&
             request.resource.data.location.lat <= 90 &&
             request.resource.data.location.lng is number &&
             request.resource.data.location.lng >= -180 &&
             request.resource.data.location.lng <= 180));
      allow read: if request.auth != null && (request.auth.uid == userId || isAdmin());
      allow delete: if request.auth != null && (request.auth.uid == userId || isAdmin());
    }

    // Directive 9: Immutable Admin Audit Logs (Admin SDK only)
    match /adminAuditLog/{logId} {
      allow read: if isAdmin();
      allow write: if false;
    }

    // Directive 11: Expiring Shareable Links (Admin SDK only, zero direct client access)
    match /shareLinks/{token} {
      allow read, write: if false;
    }
  }
}`}
            </pre>
          </div>

        </div>

        <div className="pt-4 border-t border-stone-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
