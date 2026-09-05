import React, { useState, useEffect } from 'react';
import type { JournalEntry, ShareLink, UserProfile } from '../types';
import {
  Share2,
  Clock,
  ShieldCheck,
  Check,
  Copy,
  X,
  ExternalLink,
  Ban,
  AlertTriangle,
  MapPin,
  Smile,
  Loader2,
  Eye,
  Lock,
} from 'lucide-react';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: JournalEntry;
  user: UserProfile;
}

export function ShareModal({ isOpen, onClose, entry, user }: ShareModalProps) {
  const [durationHours, setDurationHours] = useState<number>(24);
  const [includeLocation, setIncludeLocation] = useState(false);
  const [includeMood, setIncludeMood] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeLinks, setActiveLinks] = useState<ShareLink[]>([]);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  // Load existing share links for this entry
  const fetchLinks = async () => {
    if (!entry.id || !user.uid) return;
    setIsLoadingLinks(true);
    try {
      const res = await fetch(`/api/share/links/${entry.id}`, {
        headers: {
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
        },
      });
      if (res.ok) {
        const data = await res.json();
        setActiveLinks(data.links || []);
      }
    } catch (err) {
      console.error('Failed to load share links:', err);
    } finally {
      setIsLoadingLinks(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setNewlyCreatedToken(null);
      fetchLinks();
    }
  }, [isOpen, entry.id]);

  const handleCreateShareLink = async () => {
    setIsGenerating(true);
    setErrorMessage(null);

    try {
      const res = await fetch('/api/share/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
        },
        body: JSON.stringify({
          entryId: entry.id,
          durationHours,
          includeLocation,
          includeMood,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create share link.');
      }

      setNewlyCreatedToken(data.token);
      await fetchLinks();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error generating link.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevokeLink = async (token: string) => {
    setRevokingToken(token);
    try {
      const res = await fetch('/api/share/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': user.uid,
          'x-user-email': user.email || '',
        },
        body: JSON.stringify({ token }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to revoke link.');
      }

      await fetchLinks();
    } catch (err: any) {
      setErrorMessage(err.message || 'Error revoking link.');
    } finally {
      setRevokingToken(null);
    }
  };

  const getShareUrl = (token: string) => {
    return `${window.location.origin}/?share=${token}`;
  };

  const copyToClipboard = async (token: string) => {
    const url = getShareUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2500);
    } catch {
      // Fallback
      prompt('Copy share link URL:', url);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col border border-stone-200 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-100 text-amber-900">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-serif text-lg font-semibold text-stone-900">
                Expiring Shareable Read Link
              </h3>
              <p className="text-xs text-stone-500">
                Directive 11 • 192-bit Cryptographic Entropy • Server-Side Expiry
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-stone-700">
          {/* Directive 11 Architecture Callout */}
          <div className="p-3.5 rounded-xl bg-amber-50/80 border border-amber-200/80 text-xs text-amber-950 space-y-1.5">
            <div className="flex items-center gap-2 font-semibold text-amber-900">
              <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" />
              <span>Zero-Account Read Link Security Lens</span>
            </div>
            <p className="text-stone-700 leading-relaxed">
              Recipients need no account to view this reflection. Per Directive 11, the link uses a random 192-bit token (never the Firestore doc ID), is blocked from direct client Firestore reads, and is verified server-side on every request.
            </p>
          </div>

          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Creation Form */}
          <div className="space-y-4 pt-1 border-b border-stone-100 pb-5">
            <div className="font-medium text-stone-900 text-xs uppercase tracking-wider text-stone-500">
              Create New Expiring Link
            </div>

            {/* Expiration Duration Selector */}
            <div>
              <label className="block text-xs font-semibold text-stone-700 mb-1.5">
                Expiration Duration
              </label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { hours: 1, label: '1 Hour' },
                  { hours: 24, label: '24 Hours' },
                  { hours: 72, label: '3 Days' },
                  { hours: 168, label: '7 Days' },
                ].map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setDurationHours(opt.hours)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium border text-center transition ${
                      durationHours === opt.hours
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Field Minimization Opt-ins (Directive 11) */}
            <div className="space-y-2 pt-1">
              <div className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-stone-500" />
                <span>Field Minimization Safeguards (Default: Stripped)</span>
              </div>

              <div className="space-y-2 bg-stone-50 p-3 rounded-xl border border-stone-200">
                <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={includeLocation}
                    onChange={(e) => setIncludeLocation(e.target.checked)}
                    className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-stone-900 flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 text-stone-600" />
                      Include attached location in shared view
                    </span>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      {entry.location
                        ? `Attached: ${entry.location.name || `${entry.location.lat.toFixed(3)}, ${entry.location.lng.toFixed(3)}`}`
                        : 'No location attached to this reflection.'}
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={includeMood}
                    onChange={(e) => setIncludeMood(e.target.checked)}
                    className="rounded border-stone-300 text-amber-600 focus:ring-amber-500 mt-0.5"
                  />
                  <div>
                    <span className="font-medium text-stone-900 flex items-center gap-1">
                      <Smile className="w-3.5 h-3.5 text-stone-600" />
                      Include mood / sentiment signals
                    </span>
                    <p className="text-[11px] text-stone-500 mt-0.5">
                      Omits emotional vulnerability telemetry by default per Directive 11.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <button
              onClick={handleCreateShareLink}
              disabled={isGenerating}
              className="w-full py-2.5 px-4 rounded-xl bg-stone-900 text-white hover:bg-stone-800 text-xs font-semibold shadow-xs transition flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-stone-400" />
                  <span>Generating 192-bit Token...</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4 text-amber-400" />
                  <span>Generate Expiring Share Link</span>
                </>
              )}
            </button>
          </div>

          {/* Newly Created Token Callout */}
          {newlyCreatedToken && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-2">
              <div className="flex items-center justify-between font-semibold text-emerald-900">
                <span className="flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-600" />
                  Link Created Successfully
                </span>
                <span className="text-[11px] font-normal text-emerald-700">Valid for {durationHours}h</span>
              </div>
              <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-emerald-200 font-mono text-[11px] text-stone-800 break-all select-all">
                <span className="flex-1 truncate">{getShareUrl(newlyCreatedToken)}</span>
                <button
                  onClick={() => copyToClipboard(newlyCreatedToken)}
                  className="p-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 shrink-0 font-sans font-medium flex items-center gap-1"
                >
                  {copiedToken === newlyCreatedToken ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedToken === newlyCreatedToken ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>
          )}

          {/* Existing Links List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-stone-900 text-xs uppercase tracking-wider text-stone-500">
                Active & Historic Links for This Reflection
              </span>
              {isLoadingLinks && <Loader2 className="w-3.5 h-3.5 animate-spin text-stone-400" />}
            </div>

            {activeLinks.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-stone-200 rounded-xl text-stone-400 text-xs">
                No share links generated yet for this reflection.
              </div>
            ) : (
              <div className="space-y-2.5">
                {activeLinks.map((link) => {
                  const isExpired = new Date(link.expiresAt).getTime() <= Date.now();
                  const isRevoked = link.revoked;
                  const isActive = !isExpired && !isRevoked;

                  return (
                    <div
                      key={link.token}
                      className={`p-3 rounded-xl border text-xs transition ${
                        isActive
                          ? 'bg-white border-stone-200 shadow-2xs'
                          : 'bg-stone-50/70 border-stone-200/60 opacity-75'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${
                              isRevoked
                                ? 'bg-rose-100 text-rose-800'
                                : isExpired
                                ? 'bg-stone-200 text-stone-700'
                                : 'bg-emerald-100 text-emerald-800'
                            }`}
                          >
                            {isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'}
                          </span>
                          <span className="text-stone-500 text-[11px] flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {isActive
                              ? `Expires ${new Date(link.expiresAt).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}`
                              : `Expired ${new Date(link.expiresAt).toLocaleDateString()}`}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-stone-500 flex items-center gap-1">
                            <Eye className="w-3 h-3 text-stone-400" />
                            {link.accessCount || 0} reads
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-stone-100 mt-2">
                        <span className="font-mono text-[11px] text-stone-500 truncate max-w-[240px]">
                          ...{link.token.slice(-12)}
                        </span>

                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <>
                              <button
                                onClick={() => copyToClipboard(link.token)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium transition"
                                title="Copy full URL to clipboard"
                              >
                                {copiedToken === link.token ? (
                                  <Check className="w-3 h-3 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3 h-3 text-stone-500" />
                                )}
                                <span>{copiedToken === link.token ? 'Copied' : 'Copy Link'}</span>
                              </button>

                              <a
                                href={getShareUrl(link.token)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-stone-100 hover:bg-stone-200 text-stone-700 text-[11px] font-medium transition"
                                title="Preview shared view in new tab"
                              >
                                <ExternalLink className="w-3 h-3 text-stone-500" />
                                <span>Open</span>
                              </a>

                              <button
                                onClick={() => handleRevokeLink(link.token)}
                                disabled={revokingToken === link.token}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 text-[11px] font-medium transition disabled:opacity-50"
                                title="Revoke link immediately (Directive 11)"
                              >
                                {revokingToken === link.token ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Ban className="w-3 h-3 text-rose-600" />
                                )}
                                <span>Revoke</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-stone-50 border-t border-stone-100 flex items-center justify-between text-xs text-stone-500">
          <span>Revocation takes effect immediately server-side.</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border border-stone-200 hover:bg-stone-100 font-medium text-stone-700 transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
