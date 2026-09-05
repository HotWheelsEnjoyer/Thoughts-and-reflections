import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Lightbulb,
  Compass,
  FileText,
  Target,
  Loader2,
  Check,
  AlertCircle,
  PlusCircle,
  Layers,
  Save,
  MapPin,
  Navigation,
  X,
  Bell,
  Shield,
  CheckCircle2,
  Share2,
} from 'lucide-react';
import type { JournalEntry, JournalTurn, ReflectionMode, UserProfile, LocationData } from '../types';
import { saveJournalEntry, dispatchSlackNotification } from '../services/firebase';
import { ShareModal } from './ShareModal';


interface JournalEditorProps {
  user: UserProfile;
  currentEntry: JournalEntry;
  onUpdateEntry: (entry: JournalEntry) => void;
  onNewEntry: () => void;
}

const TOPICS = [
  'Personal Growth',
  'Career & Projects',
  'Mindset & Gratitude',
  'Relationships',
  'Decision Making',
  'Creativity',
  'Crisis & Urgent Support',
];


const MODES: { id: ReflectionMode; label: string; icon: React.ComponentType<{ className?: string }>; description: string }[] = [
  {
    id: 'reflection',
    label: 'Deep Reflection',
    icon: Compass,
    description: 'Empathetic inquiry acknowledging your feelings & exploring core values',
  },
  {
    id: 'brainstorm',
    label: 'Brainstorm Ideas',
    icon: Lightbulb,
    description: 'Creative exploration, reframing obstacles & divergent viewpoints',
  },
  {
    id: 'summary',
    label: 'Summarize',
    icon: FileText,
    description: 'Distill thoughts into core takeaways and emotional patterns',
  },
  {
    id: 'coaching',
    label: 'Action Coaching',
    icon: Target,
    description: 'Actionable next steps, accountability & gentle guidance',
  },
];

export const JournalEditor: React.FC<JournalEditorProps> = ({
  user,
  currentEntry,
  onUpdateEntry,
  onNewEntry,
}) => {
  const [inputPrompt, setInputPrompt] = useState('');
  const [selectedMode, setSelectedMode] = useState<ReflectionMode>('reflection');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Expiring Share Link Modal State
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);

  // Location Attachment State
  const [isLocationModalOpen, setIsLocationModalOpen] = useState(false);
  const [isResolvingLocation, setIsResolvingLocation] = useState(false);
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');
  const [locationError, setLocationError] = useState<string | null>(null);

  // Notification State
  const [isDispatchingNotification, setIsDispatchingNotification] = useState(false);
  const [notificationAlert, setNotificationAlert] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
    idempotencyKey?: string;
  } | null>(null);

  // Dispatch Slack notification for crisis/urgent support entries
  const handleDispatchSlackAlert = async (targetEntry?: JournalEntry) => {
    const entryToUse = targetEntry || currentEntry;
    setIsDispatchingNotification(true);
    setNotificationAlert(null);

    try {
      const res = await dispatchSlackNotification(user, entryToUse);
      const updated: JournalEntry = {
        ...entryToUse,
        entryType: 'crisis_support',
        notification: {
          sent: true,
          sentAt: res.timestamp,
          destinationMask: res.destinationMask,
          idempotencyKey: res.idempotencyKey,
        },
      };

      onUpdateEntry(updated);
      saveJournalEntry(user.uid, updated).catch(console.error);

      setNotificationAlert({
        type: 'success',
        text: res.idempotentDuplicate
          ? `Idempotent duplicate acknowledged: Notification already recorded for this revision (${res.destinationMask}).`
          : `Slack Crisis Alert dispatched to ${res.destinationMask}${res.isSimulated ? ' (Simulated for Preview)' : ''}`,
        idempotencyKey: res.idempotencyKey,
      });
    } catch (err: any) {
      setNotificationAlert({
        type: 'error',
        text: err.message || 'Failed to dispatch Slack alert.',
      });
    } finally {
      setIsDispatchingNotification(false);
    }
  };


  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [currentEntry.turns, isSubmitting]);

  // Handle GPS location resolution via backend proxy
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser.');
      return;
    }

    setIsResolvingLocation(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // Backend Proxy Pattern: Send to server for validation, data minimization (~100m) & reverse geocode
          const res = await fetch('/api/location/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
            }),
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to resolve location.');
          }

          const data = await res.json();
          const updated: JournalEntry = {
            ...currentEntry,
            location: data.location,
            updatedAt: new Date().toISOString(),
          };

          onUpdateEntry(updated);
          await saveJournalEntry(user.uid, updated);
          setIsLocationModalOpen(false);
        } catch (err: any) {
          setLocationError(err.message || 'Error resolving location.');
        } finally {
          setIsResolvingLocation(false);
        }
      },
      (geoErr) => {
        setIsResolvingLocation(false);
        setLocationError(`Location access error: ${geoErr.message}`);
      },
      { timeout: 10000, enableHighAccuracy: false }
    );
  };

  // Handle manual coordinates submission
  const handleManualLocationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = parseFloat(manualLat.trim());
    const lngNum = parseFloat(manualLng.trim());

    if (isNaN(latNum) || isNaN(lngNum)) {
      setLocationError('Please enter valid numeric latitude and longitude coordinates.');
      return;
    }

    setIsResolvingLocation(true);
    setLocationError(null);

    try {
      const res = await fetch('/api/location/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: latNum, lng: lngNum }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Invalid coordinates.');
      }

      const data = await res.json();
      const updated: JournalEntry = {
        ...currentEntry,
        location: data.location,
        updatedAt: new Date().toISOString(),
      };

      onUpdateEntry(updated);
      await saveJournalEntry(user.uid, updated);
      setIsLocationModalOpen(false);
      setManualLat('');
      setManualLng('');
    } catch (err: any) {
      setLocationError(err.message || 'Error validating coordinates.');
    } finally {
      setIsResolvingLocation(false);
    }
  };

  // Remove attached location
  const handleRemoveLocation = async () => {
    const updated: JournalEntry = {
      ...currentEntry,
      location: undefined,
      updatedAt: new Date().toISOString(),
    };
    onUpdateEntry(updated);
    await saveJournalEntry(user.uid, updated);
  };

  // Handle sending a turn
  const handleSubmitTurn = async (e: React.FormEvent) => {
    e.preventDefault();
    const promptText = inputPrompt.trim();
    if (!promptText || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);
    setSaveStatus('saving');

    const userTurn: JournalTurn = {
      id: 'turn_' + Date.now(),
      role: 'user',
      content: promptText,
      timestamp: new Date().toISOString(),
      mode: selectedMode,
    };

    // Optimistically update entry turns for conversational display
    const updatedTurns = [...currentEntry.turns, userTurn];

    try {
      // 1. Call server-side API proxy (Zero Client API Key Leakage)
      const response = await fetch('/api/reflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          history: currentEntry.turns,
          mode: selectedMode,
          topic: currentEntry.topic,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server returned error status ${response.status}`);
      }

      const data = await response.json();

      const geminiTurn: JournalTurn = {
        id: 'turn_gemini_' + Date.now(),
        role: 'gemini',
        content: data.reply,
        timestamp: data.timestamp || new Date().toISOString(),
        mode: selectedMode,
        modelUsed: data.modelUsed,
        moodScore: typeof data.moodScore === 'number' ? data.moodScore : undefined,
        moodLabel: data.moodLabel || undefined,
      };

      const finalTurns = [...updatedTurns, geminiTurn];
      const updatedEntry: JournalEntry = {
        ...currentEntry,
        turns: finalTurns,
        updatedAt: new Date().toISOString(),
        moodScore: typeof data.moodScore === 'number' ? data.moodScore : currentEntry.moodScore,
        moodLabel: data.moodLabel || currentEntry.moodLabel,
        sentimentExplanation: data.sentimentExplanation || currentEntry.sentimentExplanation,
      };

      // 2. Persist to Cloud Firestore with Guaranteed Verification
      await saveJournalEntry(user.uid, updatedEntry);

      // Auto-dispatch Slack notification if entry is of specific type 'crisis_support'
      const isCrisisEntry = updatedEntry.entryType === 'crisis_support' || updatedEntry.topic === 'Crisis & Urgent Support';
      if (isCrisisEntry && !updatedEntry.notification?.sent) {
        handleDispatchSlackAlert(updatedEntry).catch(console.error);
      }

      // 3. Update application state and safely clear input buffer ONLY after persistence success
      onUpdateEntry(updatedEntry);
      setInputPrompt('');
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      console.error('Failed to complete interaction or persist to Firestore:', err);
      setErrorMessage(err.message || 'Failed to communicate with Gemini or save to Firestore.');
      setSaveStatus('error');
      // Do NOT clear inputPrompt so user can retry without losing their writing
    } finally {
      setIsSubmitting(false);
    }
  };

  // Synthesize executive summary & themes for the current multi-turn entry
  const handleSynthesizeSummary = async () => {
    if (currentEntry.turns.length === 0 || isSynthesizing) return;

    setIsSynthesizing(true);
    setErrorMessage(null);
    setSaveStatus('saving');

    try {
      const response = await fetch('/api/summarize-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: currentEntry.title,
          turns: currentEntry.turns,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to synthesize summary.');
      }

      const data = await response.json();
      const updatedEntry: JournalEntry = {
        ...currentEntry,
        summary: data.summary,
        updatedAt: new Date().toISOString(),
      };

      await saveJournalEntry(user.uid, updatedEntry);
      onUpdateEntry(updatedEntry);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      console.error('Synthesis failed:', err);
      setErrorMessage(err.message || 'Synthesis failed.');
      setSaveStatus('error');
    } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      {/* Session Metadata & Actions Header */}
      <div className="bg-white border border-stone-200 rounded-2xl p-4 sm:p-6 mb-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-stone-100">
          <div className="flex-1">
            <input
              id="entry-title-input"
              type="text"
              value={currentEntry.title}
              onChange={(e) => {
                const updated = { ...currentEntry, title: e.target.value };
                onUpdateEntry(updated);
                saveJournalEntry(user.uid, updated).catch(console.error);
              }}
              placeholder="Title your reflection..."
              className="w-full font-serif text-xl sm:text-2xl font-semibold text-stone-900 border-none outline-hidden focus:ring-0 p-0 placeholder:text-stone-400"
            />
            <div className="flex items-center gap-2 mt-1 text-xs text-stone-500">
              <span>{new Date(currentEntry.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              <span>•</span>
              <span>{currentEntry.turns.length} interaction{currentEntry.turns.length === 1 ? '' : 's'}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-new-entry"
              onClick={onNewEntry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 text-xs font-medium transition"
            >
              <PlusCircle className="w-3.5 h-3.5 text-stone-500" />
              New Entry
            </button>

            <button
              id="btn-share-entry"
              onClick={() => setIsShareModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-stone-200 text-stone-700 hover:bg-stone-50 text-xs font-medium transition"
              title="Generate expiring shareable read link"
            >
              <Share2 className="w-3.5 h-3.5 text-amber-600" />
              <span>Share Link</span>
            </button>

            {currentEntry.turns.length > 0 && (
              <button
                id="btn-synthesize-summary"
                onClick={handleSynthesizeSummary}
                disabled={isSynthesizing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 hover:bg-amber-100 text-xs font-medium transition disabled:opacity-50"
              >
                {isSynthesizing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-700" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                )}
                Synthesize Entry
              </button>
            )}
          </div>
        </div>

        {/* Entry Classification & Slack Alert Mode */}
        <div className="pt-3 pb-2 flex flex-wrap items-center justify-between gap-3 border-b border-stone-100">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-stone-600">Entry Type:</span>
            <button
              id="btn-entrytype-standard"
              onClick={() => {
                const updated: JournalEntry = { ...currentEntry, entryType: 'standard' };
                onUpdateEntry(updated);
                saveJournalEntry(user.uid, updated).catch(console.error);
              }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                (!currentEntry.entryType || currentEntry.entryType === 'standard') && currentEntry.topic !== 'Crisis & Urgent Support'
                  ? 'bg-stone-900 text-white'
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Standard Reflection
            </button>
            <button
              id="btn-entrytype-crisis"
              onClick={() => {
                const updated: JournalEntry = {
                  ...currentEntry,
                  entryType: 'crisis_support',
                  topic: 'Crisis & Urgent Support',
                };
                onUpdateEntry(updated);
                saveJournalEntry(user.uid, updated).catch(console.error);
              }}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                currentEntry.entryType === 'crisis_support' || currentEntry.topic === 'Crisis & Urgent Support'
                  ? 'bg-rose-700 text-white shadow-xs'
                  : 'bg-rose-50 text-rose-700 border border-rose-200 hover:bg-rose-100'
              }`}
            >
              <Bell className="w-3 h-3" />
              <span>🚨 Crisis & Urgent Support</span>
              <span className="text-[10px] bg-rose-900/20 px-1 py-0.5 rounded">Slack Alert</span>
            </button>
          </div>

          {currentEntry.notification?.sent && (
            <div className="inline-flex items-center gap-1.5 text-xs text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Slack Alert Dispatched</span>
              <span className="text-[10px] text-emerald-600 font-mono">
                {currentEntry.notification.destinationMask || 'hooks.slack.com'}
              </span>
            </div>
          )}
        </div>

        {/* Crisis Support Banner */}
        {(currentEntry.entryType === 'crisis_support' || currentEntry.topic === 'Crisis & Urgent Support') && (
          <div className="mt-3 p-3.5 rounded-xl bg-rose-50/80 border border-rose-200 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-rose-900">
                    Crisis & Urgent Support Pipeline Active
                  </div>
                  <div className="text-rose-700 mt-0.5">
                    Entries of this specific type automatically notify the coaching team on Slack. Messages are sanitized against ping injection (<code className="bg-rose-100 px-1 py-0.5 rounded">@everyone</code> disarmed), rate-limited (5/10m), and stamped with an idempotency key.
                  </div>
                </div>
              </div>
              <button
                id="btn-dispatch-slack-alert"
                onClick={() => handleDispatchSlackAlert()}
                disabled={isDispatchingNotification}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-medium shrink-0 transition disabled:opacity-50"
              >
                {isDispatchingNotification ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                <span>{currentEntry.notification?.sent ? 'Resend Slack Alert' : 'Dispatch Slack Alert'}</span>
              </button>
            </div>

            {notificationAlert && (
              <div
                className={`mt-2.5 p-2 rounded-lg text-xs flex items-center justify-between ${
                  notificationAlert.type === 'success'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                    : 'bg-rose-100 text-rose-900 border border-rose-300'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  {notificationAlert.type === 'success' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-700 shrink-0" />
                  )}
                  <span>{notificationAlert.text}</span>
                  {notificationAlert.idempotencyKey && (
                    <span className="font-mono text-[10px] bg-white/70 px-1 rounded">
                      Key: {notificationAlert.idempotencyKey.slice(0, 18)}...
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setNotificationAlert(null)}
                  className="text-stone-500 hover:text-stone-800 p-0.5"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}


        {/* Topic Selector Tags & Optional Location Badge */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-stone-500 mr-1">Topic:</span>
            {TOPICS.map((topic) => (
              <button
                key={topic}
                id={`btn-topic-${topic.toLowerCase().replace(/[^a-z0-9]/g, '-')}`}
                onClick={() => {
                  const updated = { ...currentEntry, topic };
                  onUpdateEntry(updated);
                  saveJournalEntry(user.uid, updated).catch(console.error);
                }}
                className={`px-2.5 py-1 rounded-lg text-xs transition ${
                  currentEntry.topic === topic
                    ? 'bg-stone-900 text-white font-medium'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {topic}
              </button>
            ))}
          </div>

          {/* Location Badge or Attach Button */}
          <div className="flex items-center gap-2">
            {currentEntry.location ? (
              <div
                id="entry-location-pill"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium"
              >
                <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="truncate max-w-[200px]" title={currentEntry.location.name || `${currentEntry.location.lat}, ${currentEntry.location.lng}`}>
                  {currentEntry.location.name || `${currentEntry.location.lat.toFixed(3)}°, ${currentEntry.location.lng.toFixed(3)}°`}
                </span>
                <span className="text-[10px] text-emerald-700 bg-emerald-100/70 px-1 py-0.2 rounded font-mono">~100m</span>
                <button
                  id="btn-remove-location"
                  onClick={handleRemoveLocation}
                  title="Remove location from entry"
                  className="hover:bg-emerald-200 rounded p-0.5 text-emerald-700 transition"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                id="btn-attach-location"
                onClick={() => {
                  setLocationError(null);
                  setIsLocationModalOpen(true);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-stone-200 text-stone-600 hover:bg-stone-50 hover:text-stone-900 text-xs font-medium transition"
              >
                <MapPin className="w-3.5 h-3.5 text-stone-500" />
                <span>Attach Location</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Synthesis Executive Summary Card (if generated) */}
      {currentEntry.summary && (
        <div className="mb-6 p-5 rounded-2xl bg-amber-50/70 border border-amber-200/80 shadow-xs">
          <div className="flex items-center gap-2 mb-2 text-amber-900 font-semibold text-sm">
            <Sparkles className="w-4 h-4 text-amber-600" />
            <span>Gemini Executive Reflection & Synthesized Themes</span>
          </div>
          <div className="prose prose-stone prose-sm max-w-none text-stone-700 leading-relaxed">
            <ReactMarkdown>{currentEntry.summary}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Conversation Turns Feed */}
      <div className="space-y-4 mb-6">
        {currentEntry.turns.length === 0 ? (
          <div className="bg-white border border-dashed border-stone-200 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-stone-100 text-stone-500 flex items-center justify-center mx-auto mb-3">
              <Compass className="w-6 h-6" />
            </div>
            <h3 className="font-serif text-lg font-medium text-stone-800 mb-1">
              Begin your reflection
            </h3>
            <p className="text-stone-500 text-sm max-w-md mx-auto mb-6">
              Write whatever is occupying your thoughts. Your companion will converse with you to help reframe, organize, or explore deeper questions.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                id="btn-starter-1"
                onClick={() => setInputPrompt("What are the most meaningful lessons or insights I gained this week?")}
                className="text-xs px-3 py-1.5 rounded-full bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200"
              >
                "What are the most meaningful lessons this week?"
              </button>
              <button
                id="btn-starter-2"
                onClick={() => setInputPrompt("I'm feeling uncertain about a decision I need to make...")}
                className="text-xs px-3 py-1.5 rounded-full bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200"
              >
                "I'm feeling uncertain about a decision..."
              </button>
              <button
                id="btn-starter-3"
                onClick={() => setInputPrompt("Brainstorm three creative angles to tackle a challenging obstacle...")}
                className="text-xs px-3 py-1.5 rounded-full bg-stone-100 text-stone-700 hover:bg-stone-200 border border-stone-200"
              >
                "Brainstorm creative angles for an obstacle..."
              </button>
            </div>
          </div>
        ) : (
          currentEntry.turns.map((turn, index) => (
            <div
              key={turn.id || index}
              className={`flex flex-col ${
                turn.role === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              <div
                className={`max-w-2xl rounded-2xl p-4 sm:p-5 shadow-xs ${
                  turn.role === 'user'
                    ? 'bg-stone-900 text-white rounded-br-xs'
                    : 'bg-white border border-stone-200 text-stone-800 rounded-bl-xs'
                }`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between gap-3 mb-2 text-[11px] opacity-75">
                  <div className="flex items-center gap-1.5">
                    {turn.role === 'user' ? (
                      <>
                        <User className="w-3.5 h-3.5 text-stone-300" />
                        <span className="font-medium text-stone-200">You</span>
                      </>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5 text-amber-600" />
                        <span className="font-medium text-stone-900">
                          {turn.modelUsed ? `Reflected via ${turn.modelUsed}` : 'AI Companion'}
                        </span>
                      </>
                    )}
                  </div>
                  <span>
                    {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Content body */}
                <div className={`prose prose-sm max-w-none ${turn.role === 'user' ? 'prose-invert text-stone-100' : 'text-stone-800'}`}>
                  <ReactMarkdown>{turn.content}</ReactMarkdown>
                </div>
              </div>
            </div>
          ))
        )}

        {/* Loading interaction state indicator */}
        {isSubmitting && (
          <div className="flex items-start">
            <div className="bg-white border border-stone-200 rounded-2xl rounded-bl-xs p-4 shadow-xs flex items-center space-x-3">
              <Loader2 className="w-4 h-4 text-amber-600 animate-spin" />
              <span className="text-xs text-stone-700 font-medium">
                Reflecting on your thoughts...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Banner with Retry Feedback */}
      {errorMessage && (
        <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold">Action Failed</p>
            <p className="mt-0.5">{errorMessage}</p>
            <p className="mt-1 text-red-700 font-medium">Your input has been safely preserved in the prompt box below.</p>
          </div>
        </div>
      )}

      {/* Input Prompt Box & Mode Controls */}
      <div className="sticky bottom-4 z-20 bg-white/95 backdrop-blur-md border border-stone-200 rounded-2xl p-4 shadow-lg">
        {/* Mode Selector Strip */}
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1">
          <span className="text-xs font-medium text-stone-500 whitespace-nowrap">Companion Mode:</span>
          {MODES.map((mode) => {
            const Icon = mode.icon;
            const isSelected = selectedMode === mode.id;
            return (
              <button
                key={mode.id}
                id={`btn-mode-${mode.id}`}
                type="button"
                onClick={() => setSelectedMode(mode.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  isSelected
                    ? 'bg-amber-100/80 text-amber-900 border border-amber-300'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200 border border-transparent'
                }`}
                title={mode.description}
              >
                <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-amber-700' : 'text-stone-500'}`} />
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Input Form */}
        <form onSubmit={handleSubmitTurn} className="relative">
          <textarea
            id="prompt-input"
            rows={3}
            value={inputPrompt}
            onChange={(e) => setInputPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmitTurn(e);
              }
            }}
            placeholder={`Share your thoughts for ${MODES.find((m) => m.id === selectedMode)?.label.toLowerCase()}... (Press Enter to send, Shift+Enter for new line)`}
            className="w-full resize-none rounded-xl border border-stone-200 bg-stone-50/50 p-3 text-sm text-stone-900 placeholder:text-stone-400 focus:bg-white focus:border-stone-400 focus:outline-hidden"
          />

          <div className="flex items-center justify-between mt-2 pt-2 border-t border-stone-100 text-xs text-stone-500">
            <div className="flex items-center gap-2">
              <span>{inputPrompt.length} / 8000 characters</span>
              <span>•</span>
              {saveStatus === 'saving' && (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <Loader2 className="w-3 h-3 animate-spin" /> Saving...
                </span>
              )}
              {saveStatus === 'saved' && (
                <span className="inline-flex items-center gap-1 text-emerald-700">
                  <Check className="w-3 h-3" /> Saved securely
                </span>
              )}
              {saveStatus === 'error' && (
                <span className="inline-flex items-center gap-1 text-red-600">
                  <AlertCircle className="w-3 h-3" /> Save failed
                </span>
              )}
            </div>

            <button
              id="btn-send-reflection"
              type="submit"
              disabled={!inputPrompt.trim() || isSubmitting}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-medium text-xs transition shadow-xs disabled:opacity-40"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <span>Reflect</span>
                  <Send className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Location Attachment & Privacy Consent Modal */}
      {isLocationModalOpen && (
        <div
          id="location-modal-backdrop"
          className="fixed inset-0 z-50 bg-stone-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            id="location-modal"
            className="bg-white rounded-2xl shadow-xl border border-stone-200 max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <MapPin className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-semibold text-stone-900 text-sm">Attach Location to Entry</h3>
                  <p className="text-xs text-stone-500">Owner-scoped & privacy preserved</p>
                </div>
              </div>
              <button
                id="btn-close-location-modal"
                onClick={() => setIsLocationModalOpen(false)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg hover:bg-stone-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Privacy & Consent Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 mb-4 leading-relaxed">
              <span className="font-semibold">Explicit Privacy & Data Minimization:</span> Location data is personal. Attaching location stores approximate coordinates (~100m precision) under your private, owner-isolated document. Lookups are proxied securely through the backend.
            </div>

            {locationError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 text-xs rounded-xl p-3 mb-4 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{locationError}</span>
              </div>
            )}

            <div className="space-y-4">
              {/* Option 1: Browser GPS */}
              <button
                id="btn-use-current-gps"
                type="button"
                onClick={handleUseCurrentLocation}
                disabled={isResolvingLocation}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-stone-900 text-white rounded-xl text-xs font-medium hover:bg-stone-800 transition disabled:opacity-50"
              >
                {isResolvingLocation ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Navigation className="w-4 h-4" />
                )}
                <span>Use Current Location (GPS)</span>
              </button>

              <div className="relative flex items-center justify-center my-3">
                <div className="border-t border-stone-200 w-full" />
                <span className="bg-white px-3 text-[11px] font-medium text-stone-400 uppercase tracking-wider">or enter coordinates</span>
              </div>

              {/* Option 2: Manual Coordinates */}
              <form onSubmit={handleManualLocationSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Latitude (-90 to 90)
                    </label>
                    <input
                      id="input-manual-lat"
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      placeholder="e.g. 37.775"
                      value={manualLat}
                      onChange={(e) => setManualLat(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-200 rounded-lg text-xs outline-hidden focus:border-stone-900 font-mono"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-stone-600 mb-1">
                      Longitude (-180 to 180)
                    </label>
                    <input
                      id="input-manual-lng"
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      placeholder="e.g. -122.419"
                      value={manualLng}
                      onChange={(e) => setManualLng(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-200 rounded-lg text-xs outline-hidden focus:border-stone-900 font-mono"
                      required
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsLocationModalOpen(false)}
                    className="px-3 py-1.5 border border-stone-200 text-stone-600 rounded-lg text-xs font-medium hover:bg-stone-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    id="btn-submit-manual-location"
                    type="submit"
                    disabled={isResolvingLocation || !manualLat || !manualLng}
                    className="px-4 py-1.5 bg-stone-900 text-white rounded-lg text-xs font-medium hover:bg-stone-800 transition disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isResolvingLocation && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>Attach Coordinates</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* Expiring Shareable Read Links Modal */}
      <ShareModal
        isOpen={isShareModalOpen}
        onClose={() => setIsShareModalOpen(false)}
        entry={currentEntry}
        user={user}
      />
    </div>
  );
};
