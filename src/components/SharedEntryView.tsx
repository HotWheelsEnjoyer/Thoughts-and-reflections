import React, { useState, useEffect } from 'react';
import {
  Clock,
  ShieldCheck,
  MapPin,
  Smile,
  AlertTriangle,
  Loader2,
  Sparkles,
  Lock,
  ArrowLeft,
  Calendar,
  Layers,
  CheckCircle2,
  Eye,
  ShieldAlert,
} from 'lucide-react';

interface SharedEntryViewProps {
  token: string;
  onReturnToApp?: () => void;
}

interface SanitizedEntry {
  title: string;
  topic: string;
  createdAt: string;
  updatedAt: string;
  turns: Array<{
    id: string;
    role: 'user' | 'gemini';
    content: string;
    timestamp: string;
    mode?: string;
  }>;
  summary?: string;
  keyThemes?: string[];
  hasLocation: boolean;
  location?: {
    lat: number;
    lng: number;
    name?: string;
    accuracy?: number;
    approximate?: boolean;
  };
  locationStripped: boolean;
  hasMood: boolean;
  moodScore?: number;
  moodLabel?: string;
  moodStripped: boolean;
  shareMetadata: {
    token: string;
    createdAt: string;
    expiresAt: string;
    accessCount: number;
    timeRemainingSeconds: number;
  };
}

export function SharedEntryView({ token, onReturnToApp }: SharedEntryViewProps) {
  const [entry, setEntry] = useState<SanitizedEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<{
    code: number;
    message: string;
    isExpired?: boolean;
    isRevoked?: boolean;
    isRateLimited?: boolean;
    expiresAt?: string;
  } | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadSharedEntry = async () => {
      setIsLoading(true);
      setErrorStatus(null);

      try {
        const res = await fetch(`/api/share/${encodeURIComponent(token)}`);
        const data = await res.json();

        if (!isMounted) return;

        if (!res.ok) {
          setErrorStatus({
            code: res.status,
            message: data.error || 'Failed to access shared reflection.',
            isExpired: data.expired,
            isRevoked: data.revoked,
            isRateLimited: res.status === 429,
            expiresAt: data.expiresAt,
          });
          return;
        }

        setEntry(data.entry);
      } catch (err: any) {
        if (!isMounted) return;
        setErrorStatus({
          code: 500,
          message: err.message || 'Network error retrieving shareable link.',
        });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadSharedEntry();
    return () => {
      isMounted = false;
    };
  }, [token]);

  // Format remaining time
  const formatTimeRemaining = (seconds: number) => {
    if (seconds <= 0) return 'Expired';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h remaining`;
    }
    if (hours > 0) return `${hours}h ${mins}m remaining`;
    return `${mins}m remaining`;
  };

  return (
    <div className="min-h-screen bg-[#faf8f5] text-stone-900 flex flex-col font-sans selection:bg-amber-200 selection:text-amber-900">
      {/* Top Navigation Bar */}
      <header className="bg-white/80 backdrop-blur-md border-b border-stone-200/80 sticky top-0 z-30 px-4 py-3">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-600 flex items-center justify-center text-white font-serif font-bold text-lg shadow-xs">
              R
            </div>
            <div>
              <span className="font-serif font-semibold text-stone-900 tracking-tight text-sm sm:text-base">
                Reflection Journal
              </span>
              <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-medium">
                Shared Read-Only View
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {onReturnToApp && (
              <button
                onClick={onReturnToApp}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-50 text-xs font-medium text-stone-700 transition"
              >
                <ArrowLeft className="w-3.5 h-3.5 text-stone-500" />
                <span>Go to App</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-8">
        {isLoading ? (
          <div className="h-96 flex flex-col items-center justify-center space-y-4">
            <div className="w-10 h-10 border-2 border-stone-300 border-t-amber-600 rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-sm font-medium text-stone-700">Verifying secure token...</p>
              <p className="text-xs text-stone-400 mt-0.5">Checking server-side expiry & revocation status</p>
            </div>
          </div>
        ) : errorStatus ? (
          <div className="max-w-md mx-auto my-12 bg-white rounded-2xl border border-stone-200 shadow-sm p-8 text-center space-y-4">
            <div
              className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center ${
                errorStatus.isRevoked
                  ? 'bg-rose-100 text-rose-700'
                  : errorStatus.isExpired
                  ? 'bg-stone-100 text-stone-700'
                  : errorStatus.isRateLimited
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-stone-100 text-stone-600'
              }`}
            >
              {errorStatus.isRevoked ? (
                <ShieldAlert className="w-7 h-7" />
              ) : errorStatus.isExpired ? (
                <Clock className="w-7 h-7" />
              ) : (
                <AlertTriangle className="w-7 h-7" />
              )}
            </div>

            <div>
              <h2 className="font-serif text-xl font-bold text-stone-900">
                {errorStatus.isRevoked
                  ? 'Access Revoked'
                  : errorStatus.isExpired
                  ? 'Share Link Expired'
                  : errorStatus.isRateLimited
                  ? 'Too Many Requests'
                  : 'Link Unavailable'}
              </h2>
              <p className="text-xs text-stone-500 mt-2 leading-relaxed">
                {errorStatus.message}
              </p>
            </div>

            {errorStatus.expiresAt && (
              <div className="p-2.5 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-600 flex items-center justify-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-stone-400" />
                <span>
                  Designated Expiry:{' '}
                  {new Date(errorStatus.expiresAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            )}

            <div className="pt-2">
              {onReturnToApp ? (
                <button
                  onClick={onReturnToApp}
                  className="w-full py-2.5 px-4 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 transition"
                >
                  Return to Reflection Journal
                </button>
              ) : (
                <a
                  href="/"
                  className="inline-block w-full py-2.5 px-4 rounded-xl bg-stone-900 text-white text-xs font-semibold hover:bg-stone-800 transition"
                >
                  Return to Main App
                </a>
              )}
            </div>
          </div>
        ) : entry ? (
          <div className="space-y-6">
            {/* Status & Expiry Telemetry Banner */}
            <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-2xs flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Active Share Link
                </span>

                <span className="inline-flex items-center gap-1.5 text-stone-600">
                  <Clock className="w-3.5 h-3.5 text-stone-400" />
                  <span>
                    Expires in{' '}
                    <strong>{formatTimeRemaining(entry.shareMetadata.timeRemainingSeconds)}</strong>
                  </span>
                </span>

                <span className="inline-flex items-center gap-1 text-stone-500">
                  <Eye className="w-3.5 h-3.5 text-stone-400" />
                  <span>{entry.shareMetadata.accessCount} read(s)</span>
                </span>
              </div>

              {/* Directive 11 Field Minimization Indicator */}
              <div className="flex items-center gap-2 text-stone-500">
                <Lock className="w-3.5 h-3.5 text-amber-700" />
                <span className="text-[11px]">
                  {entry.locationStripped || entry.moodStripped
                    ? 'Sensitive telemetry stripped by default (Directive 11)'
                    : 'Field minimization verified'}
                </span>
              </div>
            </div>

            {/* Privacy Callout Pill */}
            {(entry.locationStripped || entry.moodStripped) && (
              <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200/60 text-xs text-amber-900 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>
                    <strong>Privacy Guard:</strong> Author geolocation and private emotional sentiment scores have been minimized and stripped from this shared view to protect personal boundaries.
                  </span>
                </div>
              </div>
            )}

            {/* Reflection Title & Metadata Card */}
            <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
              <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-stone-500">
                <span className="inline-flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-stone-400" />
                  {new Date(entry.createdAt).toLocaleDateString(undefined, {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-stone-400" />
                  {entry.topic}
                </span>
                {entry.location && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-stone-600 font-medium">
                      <MapPin className="w-3.5 h-3.5 text-amber-600" />
                      {entry.location.name || `${entry.location.lat.toFixed(3)}, ${entry.location.lng.toFixed(3)}`}
                    </span>
                  </>
                )}
              </div>

              <h1 className="font-serif text-2xl sm:text-3xl font-bold text-stone-900">
                {entry.title}
              </h1>

              {/* Executive Summary (if provided) */}
              {entry.summary && (
                <div className="mt-4 p-4 rounded-xl bg-amber-50/60 border border-amber-200/80 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-950">
                    <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                    <span>Executive Summary</span>
                  </div>
                  <p className="text-xs text-stone-700 leading-relaxed">{entry.summary}</p>
                </div>
              )}
            </div>

            {/* Conversation Transcript Turns */}
            <div className="space-y-4">
              <div className="text-xs font-semibold text-stone-500 uppercase tracking-wider px-1">
                Reflective Dialogue ({entry.turns.length} interaction{entry.turns.length === 1 ? '' : 's'})
              </div>

              {entry.turns.length === 0 ? (
                <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-xs text-stone-400">
                  No dialogue turns recorded in this reflection.
                </div>
              ) : (
                entry.turns.map((turn) => {
                  const isUser = turn.role === 'user';
                  return (
                    <div
                      key={turn.id}
                      className={`p-5 rounded-2xl border text-sm transition ${
                        isUser
                          ? 'bg-stone-50/80 border-stone-200'
                          : 'bg-white border-amber-100 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-stone-100/80 text-xs">
                        <span className="font-semibold text-stone-700 flex items-center gap-1.5">
                          {isUser ? (
                            <>
                              <span className="w-2 h-2 rounded-full bg-stone-400" />
                              <span>Author</span>
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3 h-3 text-amber-600" />
                              <span className="text-amber-950 font-serif font-bold">Gemini Companion</span>
                            </>
                          )}
                        </span>
                        <span className="text-stone-400 text-[11px]">
                          {new Date(turn.timestamp).toLocaleTimeString(undefined, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="text-stone-800 leading-relaxed whitespace-pre-wrap font-sans">
                        {turn.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Safe Read Notice */}
            <div className="p-4 rounded-xl border border-stone-200 bg-stone-50/80 text-center text-xs text-stone-500 space-y-1">
              <div className="flex items-center justify-center gap-1.5 text-stone-700 font-medium">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Sanitized Read-Only Mode (Directive 11)</span>
              </div>
              <p className="text-stone-400 text-[11px]">
                This view is rendered server-side via the Admin SDK with strict expiration checks. No modifications can be made to this reflection.
              </p>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
