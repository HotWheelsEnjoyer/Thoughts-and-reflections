import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Search,
  CheckCircle2,
  Check,
  X,
  FileText,
  Trash2,
  AlertTriangle,
  History,
  Lock,
  UserCheck,
  ChevronDown,
  ChevronUp,
  MapPin,
  RefreshCw,
  Info,
  Bell,
  Send,
  Globe,
  Terminal,
  Zap,
} from 'lucide-react';
import type { JournalEntry, UserProfile, AuditLogEntry, UserRole } from '../types';
import {
  fetchAdminEntries,
  moderateEntryAsAdmin,
  deleteEntryAsAdmin,
  fetchAdminAuditLogs,
  changeUserRoleAsAdmin,
  bootstrapUserRole,
  validateWebhookUrlClient,
  fetchNotificationConfigStatus,
  fetchNotificationHistory,
  dispatchSlackNotification,
} from '../services/firebase';

interface AdminDashboardProps {
  user: UserProfile;
  onRefreshEntries?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onRefreshEntries }) => {
  const [activeTab, setActiveTab] = useState<'entries' | 'audit' | 'rbac' | 'webhooks'>('entries');
  const [entries, setEntries] = useState<(JournalEntry & { userEmail?: string })[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'flagged' | 'approved' | 'under_review'>('all');
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // Moderation action modal / inline note state
  const [actionEntry, setActionEntry] = useState<JournalEntry | null>(null);
  const [moderationNote, setModerationNote] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Anti-self-elevation test state
  const [selfElevationError, setSelfElevationError] = useState<string | null>(null);

  // Directive 10: Webhook & Notification diagnostics state
  const [testWebhookUrl, setTestWebhookUrl] = useState('https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX');
  const [validationResult, setValidationResult] = useState<{
    valid?: boolean;
    resolvedIp?: string;
    sanitizedDestination?: string;
    error?: string;
  } | null>(null);
  const [isValidatingUrl, setIsValidatingUrl] = useState(false);
  const [configStatus, setConfigStatus] = useState<{
    hasOrgWebhook: boolean;
    destinationMask: string;
    allowedHosts: string[];
    maxPerWindow: number;
    windowMinutes: number;
    totalDispatched: number;
  } | null>(null);
  const [notificationHistory, setNotificationHistory] = useState<any[]>([]);
  const [isTestDispatching, setIsTestDispatching] = useState(false);
  const [testDispatchMsg, setTestDispatchMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadData = async () => {
    setIsLoading(true);
    setFeedbackMessage(null);
    try {
      const [entriesRes, logsRes, statusRes, historyLogs] = await Promise.all([
        fetchAdminEntries(user),
        fetchAdminAuditLogs(user),
        fetchNotificationConfigStatus().catch(() => null),
        fetchNotificationHistory(user).catch(() => []),
      ]);
      setEntries(entriesRes.entries);
      setAuditLogs(logsRes.logs);
      if (statusRes) setConfigStatus(statusRes);
      if (historyLogs) setNotificationHistory(historyLogs);
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Failed to load administrative records. Server-side role verification failed.',
      });
    } finally {
      setIsLoading(false);
    }
  };


  useEffect(() => {
    loadData();
  }, [user.uid]);

  const handleModerate = async (
    entryId: string,
    action: 'flag' | 'unflag' | 'under_review' | 'approve' | 'add_note',
    note?: string
  ) => {
    setIsSubmittingAction(true);
    setFeedbackMessage(null);
    try {
      const result = await moderateEntryAsAdmin(user, entryId, action, note);
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...result.entry } : e)));
      setAuditLogs((prev) => [result.auditLog, ...prev]);
      setFeedbackMessage({
        type: 'success',
        text: `Successfully executed ${action.toUpperCase()} action. Immutable audit log #${result.auditLog.id.slice(-6)} recorded.`,
      });
      setActionEntry(null);
      setModerationNote('');
      if (onRefreshEntries) onRefreshEntries();
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Moderation request rejected by server-side authorization.',
      });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (!window.confirm('Are you sure you want to delete this user entry as an administrator? This action is permanently recorded in the immutable audit log.')) {
      return;
    }

    setIsSubmittingAction(true);
    setFeedbackMessage(null);
    try {
      const result = await deleteEntryAsAdmin(user, entryId, 'Administrative deletion via dashboard');
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
      setAuditLogs((prev) => [result.auditLog, ...prev]);
      setFeedbackMessage({
        type: 'success',
        text: `Entry successfully removed. Immutable audit entry recorded.`,
      });
      if (onRefreshEntries) onRefreshEntries();
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Deletion failed.',
      });
    } finally {
      setIsSubmittingAction(false);
    }
  };

  // Test anti-self-elevation enforcement
  const handleTestSelfElevation = async () => {
    setSelfElevationError(null);
    setFeedbackMessage(null);
    try {
      // Attempt to change caller's own role
      await changeUserRoleAsAdmin(user, user.uid, 'user', 'Attempting self-role modification');
    } catch (err: any) {
      setSelfElevationError(
        `Server-Side Block Enforced: ${err.message}`
      );
    }
  };

  // Toggle user role
  const handleToggleUserRole = async (targetUserId: string, currentRole: UserRole) => {
    const newRole: UserRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      const res = await changeUserRoleAsAdmin(
        user,
        targetUserId,
        newRole,
        `Role adjusted by administrator ${user.email || user.uid}`
      );
      setAuditLogs((prev) => [res.auditLog, ...prev]);
      setFeedbackMessage({
        type: 'success',
        text: `User ${targetUserId} role updated to ${newRole}. Immutable audit record created.`,
      });
    } catch (err: any) {
      setFeedbackMessage({
        type: 'error',
        text: err.message || 'Role modification failed.',
      });
    }
  };

  // Directive 10: Validate Webhook URL via backend SSRF guard
  const handleValidateWebhook = async (urlToTest?: string) => {
    const targetUrl = urlToTest || testWebhookUrl;
    if (urlToTest) setTestWebhookUrl(urlToTest);
    setIsValidatingUrl(true);
    setValidationResult(null);

    try {
      const res = await validateWebhookUrlClient(targetUrl);
      setValidationResult(res);
    } catch (err: any) {
      setValidationResult({
        valid: false,
        error: err.message || 'Validation request failed due to a network anomaly.',
      });
    } finally {
      setIsValidatingUrl(false);
    }
  };

  // Directive 10: Test dispatch of crisis notification alert
  const handleTriggerTestAlert = async () => {
    setIsTestDispatching(true);
    setTestDispatchMsg(null);
    try {
      const mockCrisisEntry: JournalEntry = {
        id: `crisis_demo_${Date.now()}`,
        userId: user.uid,
        title: 'Urgent Help Request: Overwhelmed with anxiety',
        turns: [
          {
            id: 'turn_alert',
            role: 'user',
            content: 'I need immediate human coaching support. I am having a severe panic episode right now.',
            timestamp: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        topic: 'Crisis & Urgent Support',
        entryType: 'crisis_support',
      };

      const res = await dispatchSlackNotification(user, mockCrisisEntry);
      setTestDispatchMsg({
        type: 'success',
        text: res.idempotentDuplicate
          ? `Idempotency Match: Notification already generated for this revision. (Key: ${res.idempotencyKey.slice(0, 18)}...)`
          : `Alert successfully dispatched to ${res.destinationMask}${res.isSimulated ? ' (Simulated in preview)' : ''}`,
      });

      // Refresh live logs and metrics
      const [status, logs] = await Promise.all([
        fetchNotificationConfigStatus().catch(() => null),
        fetchNotificationHistory(user).catch(() => []),
      ]);
      if (status) setConfigStatus(status);
      if (logs) setNotificationHistory(logs);
    } catch (err: any) {
      setTestDispatchMsg({
        type: 'error',
        text: err.message || 'Failed to dispatch Slack alert.',
      });
    } finally {
      setIsTestDispatching(false);
    }
  };


  // Filtered entries
  const filteredEntries = entries.filter((e) => {
    const matchesSearch =
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.topic.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.userId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.userEmail && e.userEmail.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterStatus === 'all') return true;
    if (filterStatus === 'flagged') return e.moderation?.isFlagged || e.moderation?.moderationStatus === 'flagged';
    if (filterStatus === 'approved') return e.moderation?.moderationStatus === 'approved';
    if (filterStatus === 'under_review') return e.moderation?.moderationStatus === 'under_review';
    return true;
  });

  const flaggedCount = entries.filter((e) => e.moderation?.isFlagged).length;

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header Banner */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                <ShieldAlert className="w-3.5 h-3.5 text-amber-700" />
                Directive 9 — Admin RBAC System
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                Server-Side Verified
              </span>
            </div>
            <h1 className="font-serif text-2xl font-bold text-stone-900">
              Administrative Moderation & Governance
            </h1>
            <p className="text-stone-600 text-sm mt-1">
              Authoritative server-side role resolution, anti-self-elevation protection, and immutable audit logging.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              id="btn-admin-refresh"
              onClick={loadData}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh Data
            </button>
          </div>
        </div>

        {/* Status Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-stone-100">
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
            <p className="text-xs text-stone-500 font-medium">All User Entries</p>
            <p className="text-xl font-serif font-bold text-stone-900 mt-0.5">{entries.length}</p>
          </div>
          <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200/60">
            <p className="text-xs text-amber-800 font-medium">Flagged for Review</p>
            <p className="text-xl font-serif font-bold text-amber-900 mt-0.5">{flaggedCount}</p>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
            <p className="text-xs text-stone-500 font-medium">Immutable Audit Logs</p>
            <p className="text-xl font-serif font-bold text-stone-900 mt-0.5">{auditLogs.length}</p>
          </div>
          <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
            <p className="text-xs text-stone-500 font-medium">Current Admin</p>
            <p className="text-xs font-semibold text-stone-800 mt-1 truncate">
              {user.email || user.displayName || user.uid}
            </p>
          </div>
        </div>
      </div>

      {/* Feedback Alerts */}
      {feedbackMessage && (
        <div
          className={`p-4 rounded-xl mb-6 text-sm flex items-start gap-3 border ${
            feedbackMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-rose-50 text-rose-900 border-rose-200'
          }`}
        >
          {feedbackMessage.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          )}
          <div>
            <p className="font-semibold">
              {feedbackMessage.type === 'success' ? 'Action Executed' : 'Authorization / Server Error'}
            </p>
            <p className="text-xs mt-0.5 opacity-90">{feedbackMessage.text}</p>
          </div>
        </div>
      )}

      {/* Tabs navigation */}
      <div className="flex items-center space-x-2 border-b border-stone-200 mb-6 pb-2">
        <button
          id="tab-admin-entries"
          onClick={() => setActiveTab('entries')}
          className={`px-4 py-2 text-xs font-medium rounded-lg transition ${
            activeTab === 'entries'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          Moderation Center ({entries.length})
        </button>
        <button
          id="tab-admin-audit"
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 text-xs font-medium rounded-lg transition flex items-center gap-1.5 ${
            activeTab === 'audit'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          Immutable Audit Logs ({auditLogs.length})
        </button>
        <button
          id="tab-admin-rbac"
          onClick={() => setActiveTab('rbac')}
          className={`px-4 py-2 text-xs font-medium rounded-lg transition flex items-center gap-1.5 ${
            activeTab === 'rbac'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <Lock className="w-3.5 h-3.5" />
          RBAC Security & Anti-Self-Elevation
        </button>
        <button
          id="tab-admin-webhooks"
          onClick={() => setActiveTab('webhooks')}
          className={`px-4 py-2 text-xs font-medium rounded-lg transition flex items-center gap-1.5 ${
            activeTab === 'webhooks'
              ? 'bg-stone-900 text-white shadow-xs'
              : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
          }`}
        >
          <Bell className="w-3.5 h-3.5" />
          Slack & SSRF Guard (Directive 10)
        </button>
      </div>

      {/* TAB 1: MODERATION CENTER */}
      {activeTab === 'entries' && (
        <div>
          {/* Search & Filter bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mb-6">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id="input-admin-search"
                type="text"
                placeholder="Search by title, topic, or user ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white border border-stone-200 rounded-xl text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 transition"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              {(['all', 'flagged', 'approved', 'under_review'] as const).map((status) => (
                <button
                  key={status}
                  id={`filter-${status}`}
                  onClick={() => setFilterStatus(status)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition ${
                    filterStatus === status
                      ? 'bg-stone-200 text-stone-900 font-semibold'
                      : 'text-stone-600 hover:text-stone-900 hover:bg-stone-100'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Entries list */}
          {isLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="w-7 h-7 border-2 border-stone-300 border-t-amber-600 rounded-full animate-spin" />
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="bg-white border border-stone-200 rounded-2xl p-12 text-center">
              <FileText className="w-10 h-10 text-stone-300 mx-auto mb-3" />
              <p className="text-stone-700 font-medium text-sm">No entries match the criteria</p>
              <p className="text-stone-500 text-xs mt-1">Try broadening your search or filter</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredEntries.map((entry) => {
                const isExpanded = expandedEntryId === entry.id;
                const isFlagged = entry.moderation?.isFlagged || entry.moderation?.moderationStatus === 'flagged';
                const status = entry.moderation?.moderationStatus || 'approved';

                return (
                  <div
                    key={entry.id}
                    id={`admin-entry-${entry.id}`}
                    className={`bg-white border rounded-2xl p-5 transition ${
                      isFlagged
                        ? 'border-amber-300 bg-amber-50/20'
                        : 'border-stone-200 hover:border-stone-300'
                    }`}
                  >
                    <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                      {/* Left: Metadata and Content */}
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-stone-100 text-stone-700 font-medium border border-stone-200">
                            Owner: {entry.userEmail || entry.userId}
                          </span>
                          <span className="text-stone-300">•</span>
                          <span className="text-xs text-stone-500">
                            {new Date(entry.createdAt).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            })}
                          </span>
                          <span className="text-stone-300">•</span>
                          <span className="text-xs text-stone-500">{entry.turns.length} turns</span>

                          {entry.location && (
                            <>
                              <span className="text-stone-300">•</span>
                              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 font-medium">
                                <MapPin className="w-3 h-3 text-emerald-600" />
                                {entry.location.name || `${entry.location.lat.toFixed(2)}°, ${entry.location.lng.toFixed(2)}°`}
                              </span>
                            </>
                          )}

                          {/* Status Pill */}
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${
                              status === 'flagged'
                                ? 'bg-rose-100 text-rose-800 border border-rose-200'
                                : status === 'under_review'
                                ? 'bg-amber-100 text-amber-800 border border-amber-200'
                                : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            }`}
                          >
                            {status}
                          </span>
                        </div>

                        <h3 className="font-serif text-lg font-bold text-stone-900 mb-1">
                          {entry.title}
                        </h3>
                        <p className="text-xs font-medium text-amber-800 mb-2">Topic: {entry.topic}</p>

                        {entry.summary && (
                          <p className="text-xs text-stone-600 line-clamp-2 bg-stone-50 p-2.5 rounded-lg border border-stone-200/60 mb-2 font-mono">
                            {entry.summary}
                          </p>
                        )}

                        {entry.moderation?.moderationNote && (
                          <div className="bg-amber-50 border border-amber-200/80 rounded-lg p-2 text-xs text-amber-900 mt-2 flex items-start gap-1.5">
                            <Info className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                            <div>
                              <strong>Moderator Note:</strong> {entry.moderation.moderationNote}
                              {entry.moderation.moderatedAt && (
                                <span className="text-[10px] text-amber-700 block mt-0.5">
                                  Updated: {new Date(entry.moderation.moderatedAt).toLocaleString()}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Right: Moderation Actions */}
                      <div className="flex flex-wrap md:flex-col items-end gap-2 shrink-0">
                        {status !== 'approved' && (
                          <button
                            id={`btn-approve-${entry.id}`}
                            onClick={() => handleModerate(entry.id, 'approve', 'Approved by administrator')}
                            disabled={isSubmittingAction}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Approve
                          </button>
                        )}

                        {status !== 'flagged' && (
                          <button
                            id={`btn-flag-${entry.id}`}
                            onClick={() => handleModerate(entry.id, 'flag', 'Flagged for content review')}
                            disabled={isSubmittingAction}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition"
                          >
                            <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                            Flag Entry
                          </button>
                        )}

                        <button
                          id={`btn-note-${entry.id}`}
                          onClick={() => {
                            setActionEntry(entry);
                            setModerationNote(entry.moderation?.moderationNote || '');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          Add Note
                        </button>

                        <button
                          id={`btn-delete-${entry.id}`}
                          onClick={() => handleDelete(entry.id)}
                          disabled={isSubmittingAction}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-lg transition"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
                        </button>

                        <button
                          onClick={() => setExpandedEntryId(isExpanded ? null : entry.id)}
                          className="text-xs text-stone-500 hover:text-stone-900 inline-flex items-center gap-1 mt-1 font-medium"
                        >
                          {isExpanded ? (
                            <>
                              Hide Turns <ChevronUp className="w-3 h-3" />
                            </>
                          ) : (
                            <>
                              Inspect Turns <ChevronDown className="w-3 h-3" />
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Turns Inspection */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-stone-200">
                        <h4 className="text-xs font-semibold text-stone-700 uppercase tracking-wider mb-2">
                          Conversation Turns ({entry.turns.length})
                        </h4>
                        {entry.turns.length === 0 ? (
                          <p className="text-xs text-stone-500 italic">No turns in this reflection session.</p>
                        ) : (
                          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                            {entry.turns.map((turn, i) => (
                              <div
                                key={turn.id || i}
                                className={`p-3 rounded-xl text-xs ${
                                  turn.role === 'user'
                                    ? 'bg-amber-50/70 border border-amber-200/50'
                                    : 'bg-stone-50 border border-stone-200/70'
                                }`}
                              >
                                <p className="font-semibold text-stone-800 mb-1">
                                  {turn.role === 'user' ? 'User Reflection' : 'Gemini Response'}:
                                </p>
                                <p className="text-stone-700 whitespace-pre-wrap">{turn.content}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IMMUTABLE AUDIT LOG TRAIL */}
      {activeTab === 'audit' && (
        <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-serif text-lg font-bold text-stone-900">
                Immutable Governance Audit Trail
              </h2>
              <p className="text-stone-500 text-xs mt-0.5">
                Directive 9 mandates that all administrative actions write immutable log entries recording who, what, before/after states, and timestamps.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Append-Only Storage
            </span>
          </div>

          {auditLogs.length === 0 ? (
            <p className="text-stone-500 text-sm py-8 text-center">No audit records recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {auditLogs.map((log) => {
                const isFlag = log.action === 'FLAG_ENTRY';
                const isDelete = log.action === 'DELETE_ENTRY';
                const isRole = log.action === 'CHANGE_USER_ROLE';

                return (
                  <div
                    key={log.id}
                    id={`audit-log-${log.id}`}
                    className="p-4 bg-stone-50 border border-stone-200 rounded-xl text-xs font-mono"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            isDelete
                              ? 'bg-red-100 text-red-800'
                              : isFlag
                              ? 'bg-amber-100 text-amber-900'
                              : isRole
                              ? 'bg-purple-100 text-purple-900'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {log.action}
                        </span>
                        <span className="text-stone-500 text-[11px]">ID: {log.id}</span>
                      </div>
                      <span className="text-stone-500 text-[11px]">
                        {new Date(log.timestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px] text-stone-700 bg-white p-3 rounded-lg border border-stone-200/70">
                      <div>
                        <p>
                          <strong>Performed By:</strong> {log.performedBy.email || log.performedBy.uid}
                        </p>
                        <p className="truncate">
                          <strong>Target User:</strong> {log.target.userId}
                        </p>
                        {log.target.entryId && (
                          <p className="truncate">
                            <strong>Target Entry:</strong> {log.target.entryId}
                          </p>
                        )}
                        {log.reason && (
                          <p className="mt-1 text-stone-600 italic">
                            <strong>Reason:</strong> {log.reason}
                          </p>
                        )}
                      </div>

                      <div className="border-t md:border-t-0 md:border-l border-stone-100 md:pl-3">
                        <p className="font-semibold text-stone-800 mb-1">State Transition:</p>
                        <p className="text-stone-500">
                          Before: {log.beforeState ? JSON.stringify(log.beforeState) : 'null'}
                        </p>
                        <p className="text-stone-900 font-medium">
                          After: {log.afterState ? JSON.stringify(log.afterState) : 'null (deleted)'}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: RBAC ARCHITECTURE & ANTI-SELF-ELEVATION */}
      {activeTab === 'rbac' && (
        <div className="space-y-6">
          {/* Directive 9 Overview */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <h2 className="font-serif text-lg font-bold text-stone-900 mb-2">
              Directive 9 (Admin RBAC) Architecture Verification
            </h2>
            <div className="space-y-3 text-xs text-stone-700">
              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">1. Server-Side Role Resolution (Never Trust Client Roles)</p>
                <p className="text-stone-600 mt-0.5">
                  Client-asserted <code>role</code> or <code>isAdmin</code> in request bodies or localStorage is completely ignored. Role is resolved strictly on the backend by <code>resolveAuthoritativeRole()</code> on every endpoint call.
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">2. Defense-in-Depth Middleware</p>
                <p className="text-stone-600 mt-0.5">
                  Admin routes (<code>/api/admin/entries</code>, <code>/api/admin/moderate-entry</code>, <code>/api/admin/entry</code>, <code>/api/admin/audit-logs</code>, <code>/api/admin/change-user-role</code>) enforce <code>requireAdminRole</code> on the backend regardless of UI state.
                </p>
              </div>

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200">
                <p className="font-semibold text-stone-900">3. Anti-Self-Elevation Rule in Firestore Rules</p>
                <p className="text-stone-600 mt-0.5">
                  Enforced at the database engine level in <code>firestore.rules</code>:
                  <code className="block bg-stone-900 text-stone-100 p-2 rounded-md mt-1 font-mono text-[11px]">
                    allow update: if request.auth != null && request.auth.uid == userId
                    && request.resource.data.role == resource.data.role;
                  </code>
                  And enforced on backend endpoints with 403 rejection if <code>targetUserId === admin.uid</code>.
                </p>
              </div>
            </div>
          </div>

          {/* Interactive Anti-Self-Elevation Demonstration */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <h3 className="font-serif text-base font-bold text-stone-900 mb-1">
              Live Test: Anti-Self-Elevation Enforcement
            </h3>
            <p className="text-stone-600 text-xs mb-4">
              Click the button below to attempt a self-elevation / self-role change. The backend will actively intercept the request and reject it with a 403 Forbidden error according to Directive 9.
            </p>

            <button
              id="btn-test-self-elevation"
              onClick={handleTestSelfElevation}
              className="px-4 py-2 bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold rounded-xl hover:bg-rose-100 transition"
            >
              Simulate Self-Role Modification Attack
            </button>

            {selfElevationError && (
              <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
                <span className="font-bold">Defense Triggered:</span> {selfElevationError}
              </div>
            )}
          </div>

          {/* Simulated User Accounts for Role Management Testing */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <h3 className="font-serif text-base font-bold text-stone-900 mb-1">
              User Role Registry (Authorized Admin Control)
            </h3>
            <p className="text-stone-600 text-xs mb-4">
              Admins can grant or revoke roles for other users. Every change is logged with before/after state to the audit trail.
            </p>

            <div className="space-y-3">
              {[
                { uid: 'user_alex_392', email: 'alex.rivera@example.com', role: 'user' as UserRole },
                { uid: 'user_sam_817', email: 'sam.taylor@example.com', role: 'user' as UserRole },
              ].map((u) => (
                <div
                  key={u.uid}
                  className="flex items-center justify-between p-3 bg-stone-50 border border-stone-200 rounded-xl text-xs"
                >
                  <div>
                    <p className="font-semibold text-stone-900">{u.email}</p>
                    <p className="text-stone-500 font-mono text-[10px]">UID: {u.uid}</p>
                  </div>
                  <button
                    onClick={() => handleToggleUserRole(u.uid, u.role)}
                    className="px-3 py-1.5 bg-stone-200 hover:bg-stone-300 text-stone-800 font-medium rounded-lg transition"
                  >
                    Promote to Admin (Test Audit Log)
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: WEBHOOK NOTIFICATIONS & SSRF GUARD (DIRECTIVE 10) */}
      {activeTab === 'webhooks' && (
        <div className="space-y-6">
          {/* Directive 10 Threat Summary Table */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-900 border border-rose-200">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-700" />
                    Directive 10 — Threat Summary
                  </span>
                  <span className="text-xs text-stone-500 font-medium">
                    External Notification Security & SSRF Hardening
                  </span>
                </div>
                <h2 className="font-serif text-lg font-bold text-stone-900 mt-1">
                  Threat Matrix: Slack / Discord / Webhook Pipeline
                </h2>
              </div>
              <span className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg">
                Active Enforcements: 5/5
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-stone-200 text-stone-500 bg-stone-50/50">
                    <th className="py-2.5 px-3 font-semibold">Threat & Attack Vector</th>
                    <th className="py-2.5 px-3 font-semibold">Target / Risk</th>
                    <th className="py-2.5 px-3 font-semibold">Severity</th>
                    <th className="py-2.5 px-3 font-semibold">Directive 10 Mitigation Architecture</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  <tr className="hover:bg-stone-50/50">
                    <td className="py-3 px-3 font-medium text-stone-900">
                      Outbound SSRF & Cloud Metadata Theft
                    </td>
                    <td className="py-3 px-3 text-stone-600">
                      User-supplied webhook URLs targeting <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">169.254.169.254</code> (Cloud Run / GCE instance credentials) or internal VPC services
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        CRITICAL
                      </span>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      Backend DNS resolution with IPv4/IPv6 CIDR check (<code className="bg-stone-100 px-1 py-0.5 rounded font-mono">isPrivateOrRestrictedIp</code>) blocking loopback, link-local metadata, carrier NAT, and private subnets before outbound request.
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-stone-50/50">
                    <td className="py-3 px-3 font-medium text-stone-900">
                      Disallowed Host Redirection
                    </td>
                    <td className="py-3 px-3 text-stone-600">
                      Attackers registering webhooks to rogue domains for credential sniffing or port scanning
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        HIGH
                      </span>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      Strict host allowlist checking (<code className="bg-stone-100 px-1 py-0.5 rounded font-mono">hooks.slack.com</code>, <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">discord.com</code>, <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">discordapp.com</code>). All other destinations rejected immediately.
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-stone-50/50">
                    <td className="py-3 px-3 font-medium text-stone-900">
                      Secret Webhook Credential Leakage
                    </td>
                    <td className="py-3 px-3 text-stone-600">
                      Webhook tokens exposed in client bundles or saved into publicly readable Firestore docs
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">
                        CRITICAL
                      </span>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      Org webhook loaded strictly server-side via <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">access_secret()</code> (Secret Manager / backend environment). Masked destination hashes displayed in client.
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-stone-50/50">
                    <td className="py-3 px-3 font-medium text-stone-900">
                      Ping & Channel Mention Injection
                    </td>
                    <td className="py-3 px-3 text-stone-600">
                      User injecting <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">@everyone</code>, <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">&lt;!channel&gt;</code>, or raw links into journal content to trigger mass notifications in coaching channels
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        MEDIUM
                      </span>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      Server-side sanitizer disarms broadcast mentions (<code className="bg-stone-100 px-1 py-0.5 rounded font-mono">@ everyone</code>) and escapes Slack mrkdwn brackets (<code className="bg-stone-100 px-1 py-0.5 rounded font-mono">&lt;</code> and <code className="bg-stone-100 px-1 py-0.5 rounded font-mono">&gt;</code>).
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-stone-50/50">
                    <td className="py-3 px-3 font-medium text-stone-900">
                      Notification Flooding & Webhook Exhaustion
                    </td>
                    <td className="py-3 px-3 text-stone-600">
                      Scripted rapid generation of crisis entries consuming provider quotas or spamming triage staff
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                        MEDIUM
                      </span>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      Per-user sliding token bucket rate limiter (Max 5 notifications per 10 minutes per user). Throttled attempts log warnings without triggering HTTP 429 cascades.
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                      </span>
                    </td>
                  </tr>

                  <tr className="hover:bg-stone-50/50">
                    <td className="py-3 px-3 font-medium text-stone-900">
                      Duplicate Webhook Dispatches on Retries
                    </td>
                    <td className="py-3 px-3 text-stone-600">
                      Network retries or re-saves generating multiple identical Slack notifications for a single reflection
                    </td>
                    <td className="py-3 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
                        LOW
                      </span>
                    </td>
                    <td className="py-3 px-3 text-stone-700">
                      Server-side Idempotency Cache: Dispatches generate a unique revision hash key (<code className="bg-stone-100 px-1 py-0.5 rounded font-mono">slack_entryId_turnCount</code>). Repeated requests return the cached response without re-POSTing.
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Enforced
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Org Webhook Config Status & Dispatch Test Control */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
              <h3 className="font-serif text-base font-bold text-stone-900 mb-1 flex items-center gap-2">
                <Bell className="w-4 h-4 text-stone-700" />
                Organization Webhook Pipeline Status
              </h3>
              <p className="text-stone-600 text-xs mb-4">
                Configured secrets and outbound throttling parameters according to Directive 10.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
                  <p className="text-[11px] text-stone-500 font-medium">Org Webhook Secret Status</p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-mono text-xs font-semibold text-stone-900">
                      {configStatus?.destinationMask || 'hooks.slack.com/services/ORG_...'}
                    </span>
                  </div>
                  <p className="text-[10px] text-stone-500 mt-1">
                    Retrieved securely via <code className="bg-stone-200/60 px-1 rounded">process.env.SLACK_WEBHOOK_URL</code>
                  </p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
                  <p className="text-[11px] text-stone-500 font-medium">Rate Limiting Envelope</p>
                  <p className="text-xs font-semibold text-stone-900 mt-1">
                    {configStatus?.maxPerWindow || 5} dispatches / {configStatus?.windowMinutes || 10} minutes
                  </p>
                  <p className="text-[10px] text-stone-500 mt-1">Token bucket per user ID</p>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
                  <p className="text-[11px] text-stone-500 font-medium">Allowed Outbound Hosts</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(configStatus?.allowedHosts || ['hooks.slack.com', 'discord.com', 'discordapp.com']).map((h) => (
                      <span key={h} className="font-mono text-[10px] bg-stone-200 text-stone-800 px-1.5 py-0.5 rounded">
                        {h}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="p-3 bg-stone-50 rounded-xl border border-stone-200/60">
                  <p className="text-[11px] text-stone-500 font-medium">Total Pipeline Dispatches</p>
                  <p className="text-lg font-bold font-serif text-stone-900 mt-0.5">
                    {configStatus?.totalDispatched || 0}
                  </p>
                  <p className="text-[10px] text-stone-500">Recorded across session</p>
                </div>
              </div>

              {/* Action: Trigger Crisis Notification Test */}
              <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-stone-900">End-to-End Alert Dispatch Test</p>
                  <p className="text-[11px] text-stone-500">
                    Sends a sanitized <code className="bg-stone-100 px-1 rounded">crisis_support</code> payload through the rate limiter & idempotency engine.
                  </p>
                </div>
                <button
                  id="btn-trigger-test-alert"
                  onClick={handleTriggerTestAlert}
                  disabled={isTestDispatching}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-medium transition shrink-0 disabled:opacity-50"
                >
                  <Zap className={`w-3.5 h-3.5 text-amber-400 ${isTestDispatching ? 'animate-spin' : ''}`} />
                  <span>{isTestDispatching ? 'Dispatching...' : 'Trigger Test Slack Alert'}</span>
                </button>
              </div>

              {testDispatchMsg && (
                <div
                  className={`mt-3 p-3 rounded-xl text-xs flex items-center justify-between border ${
                    testDispatchMsg.type === 'success'
                      ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                      : 'bg-rose-50 text-rose-900 border-rose-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {testDispatchMsg.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{testDispatchMsg.text}</span>
                  </div>
                  <button onClick={() => setTestDispatchMsg(null)} className="text-stone-400 hover:text-stone-700">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Side Card: Idempotency & Protection Architecture */}
            <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 text-xs text-stone-700 flex flex-col justify-between">
              <div>
                <h4 className="font-serif font-bold text-stone-900 mb-2 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Protection Guarantees
                </h4>
                <ul className="space-y-2 text-[11px]">
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">•</span>
                    <span><strong>DNS Pinning & Private IP Guard:</strong> Prevents DNS rebinding and loopback SSRF.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">•</span>
                    <span><strong>Cloud Metadata Defense:</strong> Rejects 169.254.169.254, protecting container identity.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">•</span>
                    <span><strong>Anti-Ping Sanitization:</strong> Replaces @everyone, @here, & disarms markdown link brackets.</span>
                  </li>
                  <li className="flex items-start gap-1.5">
                    <span className="text-emerald-600 font-bold">•</span>
                    <span><strong>Idempotency Memory:</strong> Prevents duplicate alerts if user re-saves an entry.</span>
                  </li>
                </ul>
              </div>

              <div className="mt-4 p-2.5 bg-white rounded-xl border border-stone-200/80 text-[10px] text-stone-500 font-mono">
                Trigger Type: <span className="text-rose-700 font-bold">crisis_support</span><br />
                Idempotency Format: <span className="text-stone-700">slack_[entry_id]_[turns]</span>
              </div>
            </div>
          </div>

          {/* Interactive SSRF & Webhook URL Inspector */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <h3 className="font-serif text-base font-bold text-stone-900 mb-1 flex items-center gap-2">
              <Globe className="w-4 h-4 text-stone-700" />
              Directive 10 SSRF Validator & Private-IP Inspector
            </h3>
            <p className="text-stone-600 text-xs mb-4">
              Test any custom or user-supplied webhook destination against the backend SSRF filter. Verify that private IP ranges, cloud metadata endpoints, and untrusted domains are strictly rejected.
            </p>

            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                id="input-test-webhook-url"
                type="text"
                value={testWebhookUrl}
                onChange={(e) => setTestWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
                className="flex-1 px-3 py-2 text-xs bg-stone-50 border border-stone-200 rounded-xl font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600"
              />
              <button
                id="btn-inspect-webhook"
                onClick={() => handleValidateWebhook()}
                disabled={isValidatingUrl || !testWebhookUrl.trim()}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-medium transition disabled:opacity-50 shrink-0 flex items-center gap-1.5"
              >
                {isValidatingUrl ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
                <span>Inspect & Validate</span>
              </button>
            </div>

            {/* Quick Test Vectors */}
            <div className="flex flex-wrap items-center gap-1.5 mb-4 text-xs">
              <span className="text-[11px] font-medium text-stone-500 mr-1">One-Click Test Vectors:</span>
              <button
                onClick={() => handleValidateWebhook('http://169.254.169.254/computeMetadata/v1/')}
                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-[11px] font-mono transition"
                title="Tests GCP/AWS Cloud Instance Metadata SSRF attack vector"
              >
                🚨 Metadata SSRF (169.254.169.254)
              </button>
              <button
                onClick={() => handleValidateWebhook('http://127.0.0.1:3000/internal-secrets')}
                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-[11px] font-mono transition"
                title="Tests Loopback IP attack vector"
              >
                🛑 Loopback (127.0.0.1)
              </button>
              <button
                onClick={() => handleValidateWebhook('http://192.168.1.1/admin-console')}
                className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded-lg text-[11px] font-mono transition"
                title="Tests RFC1918 Private LAN attack vector"
              >
                🛑 Private LAN (192.168.1.1)
              </button>
              <button
                onClick={() => handleValidateWebhook('https://evil-attacker.com/webhook')}
                className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-[11px] font-mono transition"
                title="Tests Disallowed External Host vector"
              >
                ⚠️ Disallowed Domain (evil-attacker.com)
              </button>
              <button
                onClick={() => handleValidateWebhook('https://hooks.slack.com/services/T00000000/B00000000/VALID_SECRET_KEY')}
                className="px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-[11px] font-mono transition"
                title="Tests Valid Slack incoming webhook URL"
              >
                ✅ Valid Slack URL
              </button>
            </div>

            {/* Validation Result Inspection Card */}
            {validationResult && (
              <div
                className={`p-4 rounded-xl border text-xs ${
                  validationResult.valid
                    ? 'bg-emerald-50 text-emerald-950 border-emerald-200'
                    : 'bg-rose-50 text-rose-950 border-rose-200'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {validationResult.valid ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1">
                    <p className="font-bold text-sm">
                      {validationResult.valid ? 'SSRF Validation Passed: Safe for Outbound Webhook' : 'SSRF Validation Blocked: Prohibited Destination'}
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                      {validationResult.error || 'Destination verified against domain allowlist and resolved to a legitimate public IP address.'}
                    </p>
                    {validationResult.resolvedIp && (
                      <div className="mt-2 font-mono text-[11px] bg-white/70 p-2 rounded-lg border border-black/5">
                        <span>DNS Resolved IP: </span>
                        <strong className="text-stone-900">{validationResult.resolvedIp}</strong>
                        {validationResult.sanitizedDestination && (
                          <span className="ml-3 text-stone-600">Mask: {validationResult.sanitizedDestination}</span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Live Dispatched Notifications Log */}
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-serif text-base font-bold text-stone-900">
                  Notification Dispatch Audit Log
                </h3>
                <p className="text-stone-600 text-xs">
                  Historical record of all alerts processed by the notification pipeline.
                </p>
              </div>
              <span className="text-xs text-stone-500 font-mono">
                {notificationHistory.length} record{notificationHistory.length === 1 ? '' : 's'}
              </span>
            </div>

            {notificationHistory.length === 0 ? (
              <div className="p-8 text-center bg-stone-50 rounded-xl border border-stone-200/60 text-stone-500 text-xs">
                No notifications dispatched yet in this session. Create a Crisis & Urgent Support entry or click "Trigger Test Slack Alert" above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-stone-200 text-stone-500 bg-stone-50/50">
                      <th className="py-2.5 px-3 font-semibold">Timestamp</th>
                      <th className="py-2.5 px-3 font-semibold">Type</th>
                      <th className="py-2.5 px-3 font-semibold">Title (Sanitized)</th>
                      <th className="py-2.5 px-3 font-semibold">Idempotency Key</th>
                      <th className="py-2.5 px-3 font-semibold">Destination Mask</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {notificationHistory.map((log, idx) => (
                      <tr key={log.id || idx} className="hover:bg-stone-50/50">
                        <td className="py-2.5 px-3 font-mono text-[11px] text-stone-500">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-800">
                            {log.entryType || 'crisis_support'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-stone-900 max-w-xs truncate">
                          {log.title}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-stone-500 truncate max-w-[160px]" title={log.idempotencyKey}>
                          {log.idempotencyKey}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-stone-600">
                          {log.destinationMask}
                        </td>
                        <td className="py-2.5 px-3">
                          {log.status === 'sent' ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Sent
                            </span>
                          ) : log.status === 'idempotent_duplicate' ? (
                            <span className="inline-flex items-center gap-1 text-blue-700 font-medium text-[11px]">
                              <Check className="w-3.5 h-3.5" /> Idempotent Cache
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-700 font-medium text-[11px]">
                              <AlertTriangle className="w-3.5 h-3.5" /> {log.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Moderation Note Modal */}
      {actionEntry && (
        <div className="fixed inset-0 z-50 bg-stone-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-6 max-w-md w-full shadow-lg">
            <h3 className="font-serif text-lg font-bold text-stone-900 mb-1">
              Add Moderation Note
            </h3>
            <p className="text-stone-500 text-xs mb-4">
              Entry: "{actionEntry.title}" by {actionEntry.userId}
            </p>

            <textarea
              id="input-moderation-note"
              rows={4}
              value={moderationNote}
              onChange={(e) => setModerationNote(e.target.value)}
              placeholder="Enter administrative guidance or compliance justification..."
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-600 mb-4 font-sans"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setActionEntry(null)}
                className="px-3 py-2 text-xs font-medium text-stone-600 hover:text-stone-900"
              >
                Cancel
              </button>
              <button
                id="btn-save-moderation-note"
                onClick={() => handleModerate(actionEntry.id, 'add_note', moderationNote)}
                disabled={isSubmittingAction || !moderationNote.trim()}
                className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl transition disabled:opacity-50"
              >
                Save & Record in Audit Log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
