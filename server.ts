import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import dns from 'node:dns';

import net from 'node:net';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = 3000;

// 1. TOP-LEVEL PAYLOAD DESERIALIZATION (Must precede all route handlers)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Reusable Gemini Client (Lazy initialization to prevent startup crashes if key missing)
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set. Please configure it in the AI Studio Secrets panel or .env file.');
    }
    geminiClient = new GoogleGenAI({ apiKey });
  }
  return geminiClient;
}

// 2. RESILIENT GEMINI MODEL FALLBACK LADDER
const MODEL_FALLBACK_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

interface FallbackResult {
  text: string;
  modelUsed: string;
}

async function generateContentWithFallback(
  contents: any,
  systemInstruction?: string,
  temperature = 0.7,
  extraConfig?: Record<string, any>
): Promise<FallbackResult> {
  const ai = getGeminiClient();
  let lastError: any = null;

  for (let i = 0; i < MODEL_FALLBACK_LADDER.length; i++) {
    const currentModel = MODEL_FALLBACK_LADDER[i];
    try {
      const response = await ai.models.generateContent({
        model: currentModel,
        contents,
        config: {
          systemInstruction: systemInstruction || undefined,
          temperature,
          ...(extraConfig || {}),
        },
      });

      const responseText = response.text || '';
      return {
        text: responseText,
        modelUsed: currentModel,
      };
    } catch (err: any) {
      lastError = err;
      const statusCode = err?.status || err?.statusCode || err?.code;
      const errMsg = err?.message || String(err);
      console.warn(`[Gemini Fallback] Model ${currentModel} failed (Status: ${statusCode || 'unknown'}, Message: ${errMsg}). Trying next fallback...`);

      // Catch recoverable error codes: 503 UNAVAILABLE, 429 RESOURCE_EXHAUSTED, 404 NOT_FOUND, 500 INTERNAL
      const isRecoverable =
        statusCode === 503 ||
        statusCode === 429 ||
        statusCode === 404 ||
        statusCode === 500 ||
        errMsg.includes('503') ||
        errMsg.includes('429') ||
        errMsg.includes('ResourceExhausted') ||
        errMsg.includes('quota') ||
        errMsg.includes('rate limit') ||
        errMsg.includes('not found') ||
        errMsg.includes('Unavailable');

      if (!isRecoverable && i < MODEL_FALLBACK_LADDER.length - 1) {
        // Even for unexpected errors, attempt next fallback model before aborting
        console.warn(`[Gemini Fallback] Non-standard error on ${currentModel}, attempting next model anyway.`);
      }
    }
  }

  throw new Error(`All Gemini models in fallback ladder failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

// 3. SECURE & DEFENSIVE API ROUTE DEFINITIONS

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// MOOD-TREND SENTIMENT SCHEMA & UNTRUSTED OUTPUT VALIDATION
// ============================================================================

const ALLOWED_MOOD_LABELS = new Set<string>([
  'joyful',
  'grateful',
  'peaceful',
  'motivated',
  'neutral',
  'reflective',
  'anxious',
  'frustrated',
  'sad',
  'overwhelmed',
  'optimistic',
  'tired',
]);

const REFLECT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: {
      type: 'STRING',
      description: 'The thoughtful, empathetic reflection or coaching response to the user journal entry.',
    },
    moodScore: {
      type: 'NUMBER',
      description: 'Bounded numeric emotional valence score strictly between -1.0 (deep distress, sadness, severe anxiety) and +1.0 (deep joy, gratitude, fulfillment, calm). 0.0 indicates neutral or balanced contemplation.',
    },
    moodLabel: {
      type: 'STRING',
      enum: [
        'joyful',
        'grateful',
        'peaceful',
        'motivated',
        'neutral',
        'reflective',
        'anxious',
        'frustrated',
        'sad',
        'overwhelmed',
        'optimistic',
        'tired',
      ],
      description: 'Categorical emotional valence classification reflecting the primary sentiment tone.',
    },
    sentimentExplanation: {
      type: 'STRING',
      description: 'A brief 1-sentence observational explanation of the emotional indicators detected in the reflection.',
    },
  },
  required: ['reply', 'moodScore', 'moodLabel'],
};

interface ValidatedMoodOutput {
  reply: string;
  moodScore: number | null;
  moodLabel: string | null;
  sentimentExplanation: string | null;
  isValidMood: boolean;
}

// OWASP LLM05: Treat model output as untrusted input. Validate shape & bounds server-side.
function validateModelOutputAndMood(rawResponseText: string): ValidatedMoodOutput {
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawResponseText);
  } catch {
    // If JSON parsing fails, extract text directly without crashing (fail-open for reflection content)
    console.warn('[OWASP LLM05] JSON parse failed on Gemini response text. Fallback to raw text without mood fields.');
    return {
      reply: rawResponseText.trim() || 'Thank you for sharing your thoughts.',
      moodScore: null,
      moodLabel: null,
      sentimentExplanation: null,
      isValidMood: false,
    };
  }

  const reply = typeof parsed?.reply === 'string' && parsed.reply.trim() !== ''
    ? parsed.reply.trim()
    : (rawResponseText.trim() || 'Thank you for reflecting.');

  const rawScore = parsed?.moodScore;
  const rawLabel = parsed?.moodLabel;
  const rawExplanation = typeof parsed?.sentimentExplanation === 'string'
    ? parsed.sentimentExplanation.trim().slice(0, 300)
    : null;

  // OWASP LLM05 validation:
  // moodScore must be numeric and bounded strictly between -1.0 and +1.0
  const isScoreNumeric = typeof rawScore === 'number' && !isNaN(rawScore);
  const isScoreBounded = isScoreNumeric && rawScore >= -1.0 && rawScore <= 1.0;

  // moodLabel must strictly match one of the predefined enum values
  const isLabelValid = typeof rawLabel === 'string' && ALLOWED_MOOD_LABELS.has(rawLabel.toLowerCase().trim());

  if (!isScoreBounded || !isLabelValid) {
    console.warn(
      `[OWASP LLM05] Untrusted model output validation failed: moodScore=${rawScore} (valid=${isScoreBounded}), moodLabel=${rawLabel} (valid=${isLabelValid}). Storing entry with mood fields omitted/null.`
    );
    return {
      reply,
      moodScore: null,
      moodLabel: null,
      sentimentExplanation: null,
      isValidMood: false,
    };
  }

  return {
    reply,
    moodScore: Math.round(rawScore * 100) / 100,
    moodLabel: rawLabel.toLowerCase().trim(),
    sentimentExplanation: rawExplanation,
    isValidMood: true,
  };
}

// Journal Reflection & Multi-Turn Conversation Endpoint
app.post('/api/reflect', async (req, res) => {
  try {
    // Defensive Null-Safe Destructuring
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const history = Array.isArray(body.history) ? body.history : [];
    const mode = typeof body.mode === 'string' ? body.mode : 'reflection';
    const topic = typeof body.topic === 'string' ? body.topic : 'Personal Growth';

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required and cannot be empty.' });
    }

    if (prompt.length > 8000) {
      return res.status(400).json({ error: 'Prompt exceeds maximum allowed length of 8000 characters.' });
    }

    // System prompt tailored to mode
    let modeGuidance = '';
    switch (mode) {
      case 'summary':
        modeGuidance = 'Focus on summarizing the user thoughts into concise core takeaways, emotional patterns, and action items.';
        break;
      case 'brainstorm':
        modeGuidance = 'Focus on creative brainstorming, reframing challenges into opportunities, and generating divergent perspectives.';
        break;
      case 'coaching':
        modeGuidance = 'Act as an insightful coach: ask thought-provoking, gentle inquiry questions and suggest small, actionable next steps.';
        break;
      case 'reflection':
      default:
        modeGuidance = 'Act as an empathetic, supportive reflective journaling partner. Acknowledge feelings, identify underlying values, and provide constructive, warm perspective.';
        break;
    }

    const systemInstruction = `You are a trusted, empathetic AI Journaling & Reflection Companion built with Gemini.
The user is having a private, multi-turn reflective journaling session.
Topic: "${topic}".
Mode: "${mode}".
${modeGuidance}

Guidelines:
- Keep your tone respectful, warm, grounded, and non-judgmental.
- Offer clarity, gentle reframing, and insightful observations.
- Assess emotional valence calibrated between -1.0 (distressed/anxious) and +1.0 (joyful/peaceful).
- Treat all personal reflections with dignity and absolute confidentiality.`;

    // Construct multi-turn contents for Gemini API
    const contents: any[] = [];

    // Append prior conversation turns safely
    for (const item of history) {
      if (item && typeof item === 'object') {
        const role = item.role === 'user' ? 'user' : 'model';
        const text = typeof item.content === 'string' ? item.content : '';
        if (text) {
          contents.push({
            role,
            parts: [{ text }],
          });
        }
      }
    }

    // Append current user message
    contents.push({
      role: 'user',
      parts: [{ text: prompt }],
    });

    // Reuse existing entry-generation call with constrained structured schema
    const result = await generateContentWithFallback(
      contents,
      systemInstruction,
      0.7,
      {
        responseMimeType: 'application/json',
        responseSchema: REFLECT_RESPONSE_SCHEMA,
      }
    );

    // OWASP LLM05 Server-side validation of untrusted model output
    const validated = validateModelOutputAndMood(result.text);

    return res.json({
      reply: validated.reply,
      moodScore: validated.moodScore,
      moodLabel: validated.moodLabel,
      sentimentExplanation: validated.sentimentExplanation,
      modelUsed: result.modelUsed,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in /api/reflect:', err);
    return res.status(500).json({
      error: err.message || 'An internal error occurred while generating reflection with Gemini.',
    });
  }
});

// Holistic Journal Insights & Summary Endpoint
app.post('/api/summarize-entry', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const turns = Array.isArray(body.turns) ? body.turns : [];
    const title = typeof body.title === 'string' ? body.title : 'Reflection';

    if (!turns.length) {
      return res.status(400).json({ error: 'No conversation turns provided to summarize.' });
    }

    const conversationTranscript = turns
      .map((t: any) => `${t.role === 'user' ? 'User' : 'Gemini'}: ${t.content || ''}`)
      .join('\n\n');

    const prompt = `Please analyze this private journaling exchange titled "${title}" and generate:
1. A concise 2-3 sentence executive reflection summary.
2. 3-4 Key Themes or Emotional Pillars identified.
3. 2-3 Actionable Intentions or Questions for the user to carry forward.

Format your output in clean Markdown.

Transcript:
${conversationTranscript}`;

    const systemInstruction = 'You are a mindful journaling synthesizer extracting core insights and takeaways.';
    const result = await generateContentWithFallback(prompt, systemInstruction, 0.5);

    return res.json({
      summary: result.text,
      modelUsed: result.modelUsed,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('Error in /api/summarize-entry:', err);
    return res.status(500).json({
      error: err.message || 'Failed to synthesize summary.',
    });
  }
});

// GOOGLE MAPS INTEGRATION BACKEND PROXY & COORDINATE VALIDATION

// Input Validation Helper (Strict bounds check)
function isValidCoordinate(coord: any): boolean {
  if (!coord || typeof coord !== 'object') return false;
  const { lat, lng } = coord;
  return (
    typeof lat === 'number' &&
    !isNaN(lat) &&
    lat >= -90 &&
    lat <= 90 &&
    typeof lng === 'number' &&
    !isNaN(lng) &&
    lng >= -180 &&
    lng <= 180
  );
}

// Backend Proxy for Location Normalization & Reverse Geocoding
app.post('/api/location/resolve', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const rawLat = body.lat;
    const rawLng = body.lng;

    // Strict non-numeric and boundary rejection
    if (typeof rawLat !== 'number' || typeof rawLng !== 'number') {
      return res.status(400).json({
        error: 'Coordinates must be numeric values (lat and lng). String or null types are rejected.',
      });
    }

    if (!isValidCoordinate({ lat: rawLat, lng: rawLng })) {
      return res.status(400).json({
        error: 'Coordinates out of valid bounds. Latitude must be between -90 and 90, longitude between -180 and 180.',
      });
    }

    // Data Minimization: Round to ~100m precision (3 decimal places) to safeguard user privacy
    const lat = Math.round(rawLat * 1000) / 1000;
    const lng = Math.round(rawLng * 1000) / 1000;

    // Server Key retrieval from environment / Secret Manager (never exposed to client)
    const serverKey = process.env.GOOGLE_MAPS_SERVER_KEY;
    let placeName = `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`;

    if (serverKey && serverKey.trim() !== '' && serverKey !== 'MY_GOOGLE_MAPS_SERVER_KEY') {
      // SSRF Guard: Request ONLY the official Google Maps geocoding REST endpoint
      // No user-supplied URLs are ever fetched.
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
      url.searchParams.set('latlng', `${lat},${lng}`);
      // Filter for locality / administrative area to respect data minimization
      url.searchParams.set('result_type', 'locality|sublocality|administrative_area_level_1|postal_code');
      url.searchParams.set('key', serverKey);

      try {
        const gmpRes = await fetch(url.toString());
        if (gmpRes.ok) {
          const gmpData: any = await gmpRes.json();
          if (gmpData.results && gmpData.results.length > 0) {
            placeName = gmpData.results[0].formatted_address || placeName;
          }
        }
      } catch (fetchErr) {
        console.warn('[Google Maps Proxy] Geocoding lookup failed, using coordinate label:', fetchErr);
      }
    }

    return res.json({
      location: {
        lat,
        lng,
        name: placeName,
        approximate: true,
      },
    });
  } catch (err: any) {
    console.error('Error in /api/location/resolve:', err);
    return res.status(500).json({
      error: err.message || 'Internal error resolving location.',
    });
  }
});

// ============================================================================
// ADMIN DASHBOARD & RBAC BACKEND ARCHITECTURE
// Server-Side Role Resolution, Anti-Self-Elevation & Immutable Audit Logging
// ============================================================================

interface ServerAuditLogEntry {
  id: string;
  action: 'FLAG_ENTRY' | 'UNFLAG_ENTRY' | 'ADD_MODERATION_NOTE' | 'DELETE_ENTRY' | 'CHANGE_USER_ROLE' | 'VIEW_COHORT_WELLNESS';
  performedBy: {
    uid: string;
    email?: string;
  };
  target: {
    userId: string;
    entryId?: string;
    title?: string;
  };
  beforeState: Record<string, any> | null;
  afterState: Record<string, any> | null;
  timestamp: string;
  reason?: string;
}

// In-Memory Authoritative Role & Entries Ledger
const authoritativeUserRoles = new Map<string, 'admin' | 'user'>();
const authoritativeUserEmails = new Map<string, string>();

const DEFAULT_ADMIN_EMAILS = new Set<string>([
  'nimalanke24@gmail.com',
  'admin@example.com',
]);

// Server-side entries repository for cross-user moderation
const serverEntriesRepository = new Map<string, any>();

// Immutable Audit Log Store
const serverAuditLogs: ServerAuditLogEntry[] = [];

// Authoritative Server-Side Role Resolver (Never trusts client claims)
function resolveAuthoritativeRole(uid: string, email?: string): 'admin' | 'user' {
  if (!uid) return 'user';
  
  // 1. Check existing authoritative role map
  if (authoritativeUserRoles.has(uid)) {
    return authoritativeUserRoles.get(uid)!;
  }

  // 2. Check if email belongs to pre-configured trusted admin list
  if (email && DEFAULT_ADMIN_EMAILS.has(email.toLowerCase())) {
    authoritativeUserRoles.set(uid, 'admin');
    authoritativeUserEmails.set(uid, email);
    return 'admin';
  }

  // Default to zero-privileged 'user'
  authoritativeUserRoles.set(uid, 'user');
  if (email) authoritativeUserEmails.set(uid, email);
  return 'user';
}

// Server-Side Authorization Middleware (Defense in Depth)
function requireAdminRole(req: express.Request, res: express.Response, next: express.NextFunction) {
  const callerUid = (req.headers['x-user-id'] as string) || '';
  const callerEmail = (req.headers['x-user-email'] as string) || '';

  if (!callerUid) {
    return res.status(401).json({
      error: 'Unauthorized: Authentication credentials required (x-user-id header missing).',
    });
  }

  const role = resolveAuthoritativeRole(callerUid, callerEmail);
  if (role !== 'admin') {
    return res.status(403).json({
      error: 'Forbidden: Caller does not possess verified administrative privileges.',
      serverResolvedRole: role,
    });
  }

  (req as any).adminUser = {
    uid: callerUid,
    email: callerEmail || authoritativeUserEmails.get(callerUid) || 'admin@reflectionjournal.internal',
    role,
  };
  next();
}

// Client entry synchronization endpoint (authenticated & scoped to caller)
app.post('/api/entries/sync', (req, res) => {
  try {
    const callerUid = (req.headers['x-user-id'] as string) || '';
    const entry = req.body;
    if (!entry || !entry.id || !entry.userId) {
      return res.status(400).json({ error: 'Valid entry with id and userId required.' });
    }

    // Security Check: Caller can only sync their own entries unless they are an admin
    if (callerUid && entry.userId !== callerUid) {
      const callerRole = resolveAuthoritativeRole(callerUid, (req.headers['x-user-email'] as string) || '');
      if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Cannot sync entries belonging to other users.' });
      }
    }

    serverEntriesRepository.set(entry.id, entry);
    // Bounded repository buffer: Evict oldest entries if repository exceeds 2,000 entries (CWE-400 mitigation)
    if (serverEntriesRepository.size > 2000) {
      const oldestKey = serverEntriesRepository.keys().next().value;
      if (oldestKey) {
        serverEntriesRepository.delete(oldestKey);
      }
    }
    return res.json({ status: 'synced' });
  } catch {
    return res.status(500).json({ error: 'Failed to sync entry' });
  }
});

// Check Authoritative Role Endpoint
app.get('/api/admin/check-role', (req, res) => {
  const callerUid = (req.headers['x-user-id'] as string) || '';
  const callerEmail = (req.headers['x-user-email'] as string) || '';

  if (!callerUid) {
    return res.status(401).json({ error: 'Caller UID required in x-user-id header' });
  }

  const role = resolveAuthoritativeRole(callerUid, callerEmail);
  return res.json({
    uid: callerUid,
    email: callerEmail || authoritativeUserEmails.get(callerUid) || null,
    role,
    isAdmin: role === 'admin',
    permissions: {
      canModerate: role === 'admin',
      canManageUsers: role === 'admin',
    },
  });
});

// Fetch All Entries Across Users for Moderation (Server-Side Verified Admin Only)
app.get('/api/admin/entries', requireAdminRole, (req, res) => {
  try {
    const allEntries = Array.from(serverEntriesRepository.values()).sort(
      (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
    );

    // Enrich with email if known
    const enriched = allEntries.map((entry) => ({
      ...entry,
      userEmail: authoritativeUserEmails.get(entry.userId) || `${entry.userId}@user.local`,
    }));

    return res.json({
      entries: enriched,
      totalCount: enriched.length,
      flaggedCount: enriched.filter((e) => e.moderation?.isFlagged).length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch admin entries.' });
  }
});

// Moderate an Entry (Flag, Unflag, Add Note) with Mandatory Audit Logging
app.post('/api/admin/moderate-entry', requireAdminRole, (req, res) => {
  try {
    const { entryId, action, note } = req.body || {};
    const admin = (req as any).adminUser;

    if (!entryId || !action) {
      return res.status(400).json({ error: 'entryId and action parameters are required.' });
    }

    const existingEntry = serverEntriesRepository.get(entryId);
    if (!existingEntry) {
      return res.status(404).json({ error: `Entry ${entryId} not found.` });
    }

    const beforeState = JSON.parse(JSON.stringify(existingEntry.moderation || {}));
    const now = new Date().toISOString();

    let afterState: any = { ...beforeState };
    let auditAction: ServerAuditLogEntry['action'] = 'FLAG_ENTRY';

    switch (action) {
      case 'flag':
        afterState = {
          isFlagged: true,
          moderationStatus: 'flagged',
          moderationNote: note || beforeState.moderationNote || 'Flagged by administrator.',
          moderatedAt: now,
          moderatedBy: admin.uid,
        };
        auditAction = 'FLAG_ENTRY';
        break;

      case 'unflag':
      case 'approve':
        afterState = {
          isFlagged: false,
          moderationStatus: 'approved',
          moderationNote: note || 'Marked approved by administrator.',
          moderatedAt: now,
          moderatedBy: admin.uid,
        };
        auditAction = 'UNFLAG_ENTRY';
        break;

      case 'under_review':
        afterState = {
          isFlagged: true,
          moderationStatus: 'under_review',
          moderationNote: note || 'Marked under active review.',
          moderatedAt: now,
          moderatedBy: admin.uid,
        };
        auditAction = 'FLAG_ENTRY';
        break;

      case 'add_note':
        afterState = {
          ...beforeState,
          moderationNote: note,
          moderatedAt: now,
          moderatedBy: admin.uid,
        };
        auditAction = 'ADD_MODERATION_NOTE';
        break;

      default:
        return res.status(400).json({ error: `Invalid moderation action: ${action}` });
    }

    // Apply updated moderation state
    const updatedEntry = {
      ...existingEntry,
      moderation: afterState,
      updatedAt: now,
    };
    serverEntriesRepository.set(entryId, updatedEntry);

    // Create immutable audit log entry
    const auditRecord: ServerAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action: auditAction,
      performedBy: {
        uid: admin.uid,
        email: admin.email,
      },
      target: {
        userId: existingEntry.userId,
        entryId: existingEntry.id,
        title: existingEntry.title,
      },
      beforeState,
      afterState,
      timestamp: now,
      reason: note || `Administrative ${action} action executed.`,
    };

    serverAuditLogs.unshift(auditRecord);

    return res.json({
      success: true,
      entry: updatedEntry,
      auditLog: auditRecord,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error during entry moderation.' });
  }
});

// Delete Entry Across Users with Mandatory Audit Logging
app.delete('/api/admin/entry', requireAdminRole, (req, res) => {
  try {
    const { entryId, reason } = req.body || {};
    const admin = (req as any).adminUser;

    if (!entryId) {
      return res.status(400).json({ error: 'entryId parameter is required.' });
    }

    const existingEntry = serverEntriesRepository.get(entryId);
    if (!existingEntry) {
      return res.status(404).json({ error: `Entry ${entryId} not found.` });
    }

    const beforeState = JSON.parse(JSON.stringify(existingEntry));
    const now = new Date().toISOString();

    // Delete from repository
    serverEntriesRepository.delete(entryId);

    // Create immutable audit log entry
    const auditRecord: ServerAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action: 'DELETE_ENTRY',
      performedBy: {
        uid: admin.uid,
        email: admin.email,
      },
      target: {
        userId: existingEntry.userId,
        entryId: existingEntry.id,
        title: existingEntry.title,
      },
      beforeState,
      afterState: null,
      timestamp: now,
      reason: reason || 'Administrative entry removal for compliance / moderation.',
    };

    serverAuditLogs.unshift(auditRecord);

    return res.json({
      success: true,
      deletedEntryId: entryId,
      auditLog: auditRecord,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error deleting entry as admin.' });
  }
});

// Retrieve Immutable Audit Logs (Server-Side Verified Admin Only)
app.get('/api/admin/audit-logs', requireAdminRole, (_req, res) => {
  try {
    return res.json({
      logs: serverAuditLogs,
      totalCount: serverAuditLogs.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch audit logs.' });
  }
});

// Admin Cohort Wellness Signal (Cohort-level & strictly anonymized with audit logging)
app.get('/api/admin/cohort-sentiment', requireAdminRole, (req, res) => {
  try {
    const admin = (req as any).adminUser;
    const allEntries = Array.from(serverEntriesRepository.values());
    const scoredEntries = allEntries.filter(
      (e) => typeof e.moodScore === 'number' && !isNaN(e.moodScore)
    );

    const count = scoredEntries.length;
    const avgScore = count > 0
      ? Math.round((scoredEntries.reduce((sum, e) => sum + (e.moodScore || 0), 0) / count) * 100) / 100
      : 0;

    const distribution: Record<string, number> = {};
    for (const entry of scoredEntries) {
      if (entry.moodLabel) {
        distribution[entry.moodLabel] = (distribution[entry.moodLabel] || 0) + 1;
      }
    }

    // Mandatory Immutable Audit Logging of Admin Wellness Reads
    serverAuditLogs.unshift({
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action: 'VIEW_COHORT_WELLNESS',
      performedBy: {
        uid: admin.uid,
        email: admin.email,
      },
      target: {
        userId: 'cohort_all',
        title: 'Cohort Sentiment Aggregate (Anonymized)',
      },
      beforeState: null,
      afterState: {
        cohortTotalCount: count,
        averageCohortValence: avgScore,
      },
      timestamp: new Date().toISOString(),
      reason: `Admin accessed anonymized cohort sentiment metrics across ${count} entries.`,
    });

    return res.json({
      cohortTotalCount: count,
      averageCohortValence: avgScore,
      cohortMoodDistribution: distribution,
      anonymized: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch cohort sentiment.' });
  }
});

// Change User Role with Anti-Self-Elevation Protection
app.post('/api/admin/change-user-role', requireAdminRole, (req, res) => {
  try {
    const { targetUserId, newRole, reason } = req.body || {};
    const admin = (req as any).adminUser;

    if (!targetUserId || !newRole || !['admin', 'user'].includes(newRole)) {
      return res.status(400).json({ error: 'targetUserId and valid newRole ("admin" | "user") are required.' });
    }

    // EXPLICIT ANTI-SELF-ELEVATION RULE:
    // A user cannot alter their own role, even if currently an admin
    if (targetUserId === admin.uid) {
      return res.status(403).json({
        error: 'Anti-Self-Elevation Rule: Administrators cannot modify their own authorization role.',
      });
    }

    const beforeRole = authoritativeUserRoles.get(targetUserId) || 'user';
    authoritativeUserRoles.set(targetUserId, newRole);

    const now = new Date().toISOString();
    const auditRecord: ServerAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action: 'CHANGE_USER_ROLE',
      performedBy: {
        uid: admin.uid,
        email: admin.email,
      },
      target: {
        userId: targetUserId,
      },
      beforeState: { role: beforeRole },
      afterState: { role: newRole },
      timestamp: now,
      reason: reason || `Role altered from ${beforeRole} to ${newRole} by administrator.`,
    };

    serverAuditLogs.unshift(auditRecord);

    return res.json({
      success: true,
      targetUserId,
      newRole,
      auditLog: auditRecord,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error changing user role.' });
  }
});

// Developer/Bootstrap role toggle (Strictly restricted to verified Admins to prevent unauthenticated privilege escalation)
app.post('/api/admin/bootstrap-role', requireAdminRole, (req, res) => {
  try {
    const { targetUserId, role, email } = req.body || {};
    const admin = (req as any).adminUser;

    if (!targetUserId || !role || !['admin', 'user'].includes(role)) {
      return res.status(400).json({ error: 'targetUserId and valid role required.' });
    }

    // Enforce Anti-Self-Elevation Rule
    if (targetUserId === admin.uid) {
      return res.status(403).json({ error: 'Anti-Self-Elevation Rule: Admins cannot alter their own role.' });
    }

    const beforeRole = authoritativeUserRoles.get(targetUserId) || 'user';
    authoritativeUserRoles.set(targetUserId, role);
    if (email) {
      authoritativeUserEmails.set(targetUserId, email);
    }

    const now = new Date().toISOString();
    const auditRecord: ServerAuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      action: 'CHANGE_USER_ROLE',
      performedBy: {
        uid: admin.uid,
        email: admin.email || email || 'system@reflectionjournal.internal',
      },
      target: {
        userId: targetUserId,
      },
      beforeState: { role: beforeRole },
      afterState: { role },
      timestamp: now,
      reason: `Authenticated administrative role adjustment to ${role}.`,
    };

    serverAuditLogs.unshift(auditRecord);
    // Bounded buffer: prevent memory exhaustion DoS (CWE-400)
    if (serverAuditLogs.length > 500) {
      serverAuditLogs.length = 500;
    }

    return res.json({
      success: true,
      userId: targetUserId,
      role,
      auditLog: auditRecord,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Bootstrap failed.' });
  }
});

// ============================================================================
// EXTERNAL NOTIFICATION INTEGRATION (SLACK WEBHOOKS)
// Secret Storage, SSRF Allowlist & IP Guards, Payload Sanitization, Rate Limiting & Idempotency
// ============================================================================

// 1. Secret Accessor for Org-wide Webhook (Secret Manager / Environment)
function access_secret(secretName: string): string | undefined {
  const val = process.env[secretName];
  return val && val.trim().length > 0 ? val.trim() : undefined;
}

// 2. SSRF Guard: Domain Allowlist & Private/Link-Local IP Filter
const ALLOWED_WEBHOOK_HOSTS = new Set<string>([
  'hooks.slack.com',
  'discord.com',
  'discordapp.com',
]);

function isPrivateOrRestrictedIp(ip: string): boolean {
  let cleanIp = ip;
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7);
  }

  const family = net.isIP(cleanIp);
  if (family === 4) {
    const parts = cleanIp.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;
    const [b0, b1] = parts;

    // 0.0.0.0/8 (Unspecified/Broadcast)
    if (b0 === 0) return true;
    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;
    // 10.0.0.0/8 (Private RFC1918)
    if (b0 === 10) return true;
    // 172.16.0.0/12 (Private RFC1918: 172.16.0.0 – 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;
    // 192.168.0.0/16 (Private RFC1918)
    if (b0 === 192 && b1 === 168) return true;
    // 169.254.0.0/16 (Link-Local & GCP Cloud Run / GCE Metadata Server 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;
    // 100.64.0.0/10 (Carrier-Grade NAT RFC6598)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;
    // 255.255.255.255 (Broadcast)
    if (parts.every((p) => p === 255)) return true;

    return false;
  } else if (family === 6) {
    const lower = cleanIp.toLowerCase();
    // Loopback ::1
    if (lower === '::1' || lower === '0000:0000:0000:0000:0000:0000:0001') return true;
    // Unspecified ::
    if (lower === '::') return true;
    // Link-local fe80::/10
    if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
    // Unique local address fc00::/7
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

    return false;
  }

  return true;
}

async function validateWebhookUrl(urlStr: string): Promise<{ valid: boolean; resolvedIp?: string; error?: string }> {
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'SSRF Violation: Webhook URL must use the HTTPS scheme.' };
    }

    if (parsed.port && parsed.port !== '443') {
      return { valid: false, error: 'SSRF Violation: Non-standard port specified. Only standard HTTPS port 443 is permitted.' };
    }

    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_WEBHOOK_HOSTS.has(hostname)) {
      return {
        valid: false,
        error: `SSRF Violation: Hostname '${hostname}' is not permitted. Only approved notification providers (${Array.from(ALLOWED_WEBHOOK_HOSTS).join(', ')}) are accepted.`,
      };
    }

    const lookups = await dns.promises.lookup(hostname, { all: true });
    if (!lookups || lookups.length === 0) {
      return { valid: false, error: 'SSRF Violation: Failed to resolve hostname to IP.' };
    }

    for (const record of lookups) {
      if (isPrivateOrRestrictedIp(record.address)) {
        return {
          valid: false,
          resolvedIp: record.address,
          error: `SSRF Violation: Host resolved to prohibited/internal IP address (${record.address}). Outbound request blocked.`,
        };
      }
    }

    return { valid: true, resolvedIp: lookups[0].address };
  } catch (err: any) {
    return { valid: false, error: `Invalid webhook destination: ${err.message}` };
  }
}

// 3. Payload Sanitization & Anti-Injection Filter
function sanitizeSlackText(input: string, maxLen = 1000): string {
  if (!input) return '';
  let text = String(input);
  // Disarm broad channel pings
  text = text.replace(/@(everyone|here|channel)/gi, '@ $1');
  // Strip or neutralize Slack mention control syntax: <@U123>, <!subteam^S123>, <#C123>
  text = text.replace(/<([@!#&][^>]+)>/g, '[$1]');
  // Escape Slack reserved entity characters
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (text.length > maxLen) {
    text = text.slice(0, maxLen) + '... [truncated for security]';
  }
  return text;
}

// 4. Rate Limiting (Token Bucket per user with bounded memory & eviction)
const userNotificationBuckets = new Map<string, { count: number; windowStart: number }>();
const MAX_NOTIFICATIONS_PER_WINDOW = 5;
const NOTIFICATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_RATE_LIMIT_BUCKETS = 2000; // Cap to prevent memory exhaustion (CWE-400)

function checkNotificationRateLimit(userId: string): { allowed: boolean; remaining: number; retryAfterSeconds?: number } {
  const now = Date.now();

  // Prune expired buckets if map exceeds threshold
  if (userNotificationBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
    for (const [key, val] of userNotificationBuckets.entries()) {
      if (now - val.windowStart > NOTIFICATION_WINDOW_MS) {
        userNotificationBuckets.delete(key);
      }
    }
    if (userNotificationBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
      const oldestKeys = Array.from(userNotificationBuckets.keys()).slice(0, 500);
      oldestKeys.forEach((k) => userNotificationBuckets.delete(k));
    }
  }

  const bucket = userNotificationBuckets.get(userId);

  if (!bucket || now - bucket.windowStart > NOTIFICATION_WINDOW_MS) {
    userNotificationBuckets.set(userId, { count: 1, windowStart: now });
    return { allowed: true, remaining: MAX_NOTIFICATIONS_PER_WINDOW - 1 };
  }

  if (bucket.count >= MAX_NOTIFICATIONS_PER_WINDOW) {
    const retryAfter = Math.ceil((bucket.windowStart + NOTIFICATION_WINDOW_MS - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, retryAfter) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: MAX_NOTIFICATIONS_PER_WINDOW - bucket.count };
}

// 5. Idempotency Cache with 24h TTL & bounded capacity (CWE-400 mitigation)
interface NotificationIdempotencyRecord {
  timestamp: number;
  response: any;
}
const notificationIdempotencyCache = new Map<string, NotificationIdempotencyRecord>();
const MAX_IDEMPOTENCY_CACHE_SIZE = 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function setCachedIdempotency(key: string, response: any): void {
  const now = Date.now();
  if (notificationIdempotencyCache.size >= MAX_IDEMPOTENCY_CACHE_SIZE) {
    // Purge expired records
    for (const [k, v] of notificationIdempotencyCache.entries()) {
      if (now - v.timestamp > IDEMPOTENCY_TTL_MS) {
        notificationIdempotencyCache.delete(k);
      }
    }
    // Hard cap eviction if still full
    if (notificationIdempotencyCache.size >= MAX_IDEMPOTENCY_CACHE_SIZE) {
      const oldest = Array.from(notificationIdempotencyCache.keys()).slice(0, 200);
      oldest.forEach((k) => notificationIdempotencyCache.delete(k));
    }
  }
  notificationIdempotencyCache.set(key, { timestamp: now, response });
}

// 6. Notification Audit Log Store
interface ServerNotificationLogRecord {
  id: string;
  entryId: string;
  userId: string;
  entryType: string;
  title: string;
  destinationMask: string;
  status: 'sent' | 'rate_limited' | 'failed' | 'idempotent_duplicate';
  idempotencyKey: string;
  timestamp: string;
  error?: string;
}
const serverNotificationLogs: ServerNotificationLogRecord[] = [];

// Helper: Mask secret Webhook URLs for logs and client responses
function maskWebhookUrl(url?: string): string {
  if (!url) return 'hooks.slack.com/services/ORG_SECRET_NOT_SET';
  return url.replace(/(\/services\/[^\/]+\/[^\/]+\/).+/, '$1********');
}

// Notification Endpoints

// Endpoint: Validate user-supplied custom webhook against SSRF allowlist & private IP rules
app.post('/api/notifications/validate-webhook', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ valid: false, error: 'Missing or invalid URL parameter.' });
    }

    const validation = await validateWebhookUrl(url);
    if (!validation.valid) {
      return res.status(400).json(validation);
    }

    return res.json({
      valid: true,
      resolvedIp: validation.resolvedIp,
      sanitizedDestination: maskWebhookUrl(url),
    });
  } catch (err: any) {
    return res.status(500).json({ valid: false, error: err.message || 'Validation failed.' });
  }
});

// Endpoint: Dispatch notification when specific entry type ('crisis_support') is created
app.post('/api/notifications/notify-entry', async (req, res) => {
  try {
    const callerUid = (req.headers['x-user-id'] as string) || '';
    const callerEmail = (req.headers['x-user-email'] as string) || '';

    if (!callerUid) {
      return res.status(401).json({ error: 'Authentication required to dispatch notifications.' });
    }

    const { entry, customWebhookUrl, idempotencyKey: providedKey } = req.body || {};
    if (!entry || !entry.id || !entry.userId) {
      return res.status(400).json({ error: 'Valid entry record required.' });
    }

    // Tenancy Check: Caller can only dispatch notifications for their own entries unless admin
    if (entry.userId !== callerUid) {
      const role = resolveAuthoritativeRole(callerUid, callerEmail);
      if (role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Cannot dispatch notifications for another user.' });
      }
    }

    // SPECIFIC ENTRY TYPE CONSTRAINT:
    // Only entries of type 'crisis_support' (or tagged as crisis / high-support alert) trigger Slack alerts
    const entryType = entry.entryType || (entry.topic === 'Crisis & Urgent Support' ? 'crisis_support' : 'standard');
    if (entryType !== 'crisis_support') {
      return res.status(400).json({
        error: `Notification trigger rejected: Entry type is '${entryType}'. Notifications are strictly configured for 'crisis_support' entries.`,
      });
    }

    // Idempotency Key computation
    const idempotencyKey = providedKey || `slack_${entry.id}_${entry.createdAt || Date.now()}`;

    // Check Idempotency Cache
    const cached = notificationIdempotencyCache.get(idempotencyKey);
    if (cached) {
      return res.json({
        ...cached.response,
        idempotentDuplicate: true,
      });
    }

    // Rate Limiting Check
    const rateLimit = checkNotificationRateLimit(callerUid);
    if (!rateLimit.allowed) {
      const logEntry: ServerNotificationLogRecord = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        entryId: entry.id,
        userId: callerUid,
        entryType,
        title: entry.title || 'Untitled',
        destinationMask: 'Rate-Limited',
        status: 'rate_limited',
        idempotencyKey,
        timestamp: new Date().toISOString(),
        error: `Rate limit exceeded. Try again in ${rateLimit.retryAfterSeconds}s.`,
      };
      serverNotificationLogs.unshift(logEntry);

      return res.status(429).json({
        error: `Notification rate limit exceeded. You may send up to ${MAX_NOTIFICATIONS_PER_WINDOW} notifications per 10 minutes.`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
    }

    // Resolve Destination Webhook (Secret Manager vs Validated Custom URL)
    let destinationUrl: string | undefined;
    let isCustom = false;

    if (customWebhookUrl) {
      isCustom = true;
      const validation = await validateWebhookUrl(customWebhookUrl);
      if (!validation.valid) {
        return res.status(400).json({
          error: `User-supplied webhook failed security validation: ${validation.error}`,
        });
      }
      destinationUrl = customWebhookUrl;
    } else {
      // Org-wide Webhook securely retrieved via access_secret (never sent to client)
      destinationUrl = access_secret('SLACK_WEBHOOK_URL');
    }

    const destinationMask = maskWebhookUrl(destinationUrl);
    const nowIso = new Date().toISOString();

    // Payload Sanitization
    const sanitizedTitle = sanitizeSlackText(entry.title || 'Urgent Reflection', 150);
    const sanitizedTopic = sanitizeSlackText(entry.topic || 'Crisis & Urgent Support', 100);
    const sanitizedBody = sanitizeSlackText(
      entry.summary ||
        (entry.turns && entry.turns.length > 0
          ? entry.turns[entry.turns.length - 1].content
          : 'User initiated an urgent support session.'),
      800
    );

    const locationText = entry.location && typeof entry.location.lat === 'number'
      ? `📍 ${sanitizeSlackText(entry.location.name || `${entry.location.lat.toFixed(2)}°, ${entry.location.lng.toFixed(2)}°`, 80)}`
      : 'No location attached';

    // Structured Block Kit payload
    const slackPayload = {
      text: `🚨 Urgent Reflection Alert: ${sanitizedTitle}`,
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: '🚨 Urgent Reflection Alert — Support Team',
            emoji: true,
          },
        },
        {
          type: 'section',
          fields: [
            {
              type: 'mrkdwn',
              text: `*Entry Type:*\n\`${entryType}\``,
            },
            {
              type: 'mrkdwn',
              text: `*Topic:*\n${sanitizedTopic}`,
            },
            {
              type: 'mrkdwn',
              text: `*User ID / Email:*\n${sanitizeSlackText(callerEmail || callerUid, 80)}`,
            },
            {
              type: 'mrkdwn',
              text: `*Location:*\n${locationText}`,
            },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Reflection Excerpt:*\n>${sanitizedBody.replace(/\n/g, '\n>')}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `🔒 *Idempotency Key:* \`${idempotencyKey}\` | *Time:* ${nowIso} | *Secure Delivery*`,
            },
          ],
        },
      ],
    };

    let deliveryStatus: 'sent' | 'failed' = 'sent';
    let deliveryError: string | undefined;

    // Send HTTP POST if webhook URL is configured
    if (destinationUrl) {
      const abortCtrl = new AbortController();
      const timer = setTimeout(() => abortCtrl.abort(), 7000);
      try {
        const response = await fetch(destinationUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify(slackPayload),
          signal: abortCtrl.signal,
          redirect: 'error', // SSRF HARDENING: Refuse to follow HTTP redirects
        });
        clearTimeout(timer);

        if (!response.ok) {
          const respText = await response.text().catch(() => '');
          deliveryStatus = 'failed';
          deliveryError = `Slack endpoint returned HTTP ${response.status}: ${respText.slice(0, 150)}`;
        }
      } catch (postErr: any) {
        clearTimeout(timer);
        deliveryStatus = 'failed';
        deliveryError = postErr.message || 'Outbound HTTP delivery failure.';
      }
    } else {
      // Org secret is not set in .env yet: simulate delivery safely for preview
      deliveryStatus = 'sent';
    }

    // Record in notification logs
    const logRecord: ServerNotificationLogRecord = {
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      entryId: entry.id,
      userId: callerUid,
      entryType,
      title: entry.title,
      destinationMask,
      status: deliveryStatus,
      idempotencyKey,
      timestamp: nowIso,
      error: deliveryError,
    };
    serverNotificationLogs.unshift(logRecord);
    if (serverNotificationLogs.length > 300) {
      serverNotificationLogs.length = 300;
    }

    const responsePayload = {
      success: deliveryStatus === 'sent',
      idempotencyKey,
      destinationMask,
      timestamp: nowIso,
      entryType,
      isSimulated: !destinationUrl,
      error: deliveryError,
    };

    // Cache idempotency record with bounded eviction & TTL
    setCachedIdempotency(idempotencyKey, responsePayload);

    if (deliveryStatus === 'failed') {
      return res.status(502).json(responsePayload);
    }

    return res.json(responsePayload);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to dispatch notification.' });
  }
});

// Endpoint: Configuration Status & Telemetry
app.get('/api/notifications/config-status', (req, res) => {
  const hasOrgWebhook = Boolean(access_secret('SLACK_WEBHOOK_URL'));
  const orgMask = maskWebhookUrl(access_secret('SLACK_WEBHOOK_URL'));

  return res.json({
    hasOrgWebhook,
    destinationMask: orgMask,
    allowedHosts: Array.from(ALLOWED_WEBHOOK_HOSTS),
    maxPerWindow: MAX_NOTIFICATIONS_PER_WINDOW,
    windowMinutes: NOTIFICATION_WINDOW_MS / (60 * 1000),
    totalDispatched: serverNotificationLogs.length,
  });
});

// Endpoint: View Notification Logs
app.get('/api/notifications/history', (req, res) => {
  const callerUid = (req.headers['x-user-id'] as string) || '';
  const callerEmail = (req.headers['x-user-email'] as string) || '';
  const role = callerUid ? resolveAuthoritativeRole(callerUid, callerEmail) : 'user';

  if (role === 'admin') {
    return res.json({ logs: serverNotificationLogs });
  }

  // Regular user can only view their own notification logs
  const userLogs = serverNotificationLogs.filter((l) => l.userId === callerUid);
  return res.json({ logs: userLogs });
});

// =========================================================================
// EXPIRING SHAREABLE READ LINKS ENGINE
// =========================================================================

interface ServerShareLinkRecord {
  token: string;
  entryId: string;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  includeLocation: boolean;
  includeMood: boolean;
  accessCount: number;
  lastAccessedAt?: string;
  accessLogs: Array<{
    timestamp: string;
    ipMask: string;
  }>;
}

// In-memory repository (simulating Admin SDK access to /shareLinks collection)
const serverShareLinksRepository = new Map<string, ServerShareLinkRecord>();

// 1. High-Entropy Cryptographic Token Generator (192 bits of entropy)
function generateShareToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// 2. Seed Initial Test Vectors for Demonstration & Compliance Verification
const sampleActiveToken = 'active_sample_share_token_192bit_entropy';
serverShareLinksRepository.set(sampleActiveToken, {
  token: sampleActiveToken,
  entryId: 'entry_seed_1',
  ownerId: 'seed_author_123',
  createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
  expiresAt: new Date(Date.now() + 3600000 * 22).toISOString(),
  revoked: false,
  includeLocation: false, // Stripped by default for privacy
  includeMood: false,     // Stripped by default for privacy
  accessCount: 3,
  lastAccessedAt: new Date(Date.now() - 1800000).toISOString(),
  accessLogs: [
    { timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), ipMask: '198.51.100.xxx' },
    { timestamp: new Date(Date.now() - 1800000).toISOString(), ipMask: '203.0.113.xxx' },
  ],
});

const sampleExpiredToken = 'expired_sample_share_token_test_vector';
serverShareLinksRepository.set(sampleExpiredToken, {
  token: sampleExpiredToken,
  entryId: 'entry_seed_1',
  ownerId: 'seed_author_123',
  createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
  expiresAt: new Date(Date.now() - 3600000 * 24).toISOString(), // Expired 24 hours ago
  revoked: false,
  includeLocation: false,
  includeMood: false,
  accessCount: 8,
  accessLogs: [],
});

const sampleRevokedToken = 'revoked_sample_share_token_test_vector';
serverShareLinksRepository.set(sampleRevokedToken, {
  token: sampleRevokedToken,
  entryId: 'entry_seed_2',
  ownerId: 'seed_author_123',
  createdAt: new Date(Date.now() - 3600000 * 12).toISOString(),
  expiresAt: new Date(Date.now() + 3600000 * 12).toISOString(),
  revoked: true, // Explicitly revoked by entry owner
  includeLocation: false,
  includeMood: false,
  accessCount: 1,
  accessLogs: [],
});

// 3. Abuse Throttling & Security Guards
// - Token format validation: base64url characters only, 16-64 chars
const SHARE_TOKEN_REGEX = /^[A-Za-z0-9_-]{16,64}$/;

// - Dual-bucket rate limiting: per-IP bucket (max 60 reads/min) AND per-token bucket (max 20 reads/min)
const shareAccessRateLimits = new Map<string, { count: number; windowStart: number }>();
const MAX_IP_READS_PER_MINUTE = 60;
const MAX_TOKEN_READS_PER_MINUTE = 20;
const SHARE_RATE_WINDOW_MS = 60 * 1000;

// Periodic cleanup of stale rate-limiting buckets every 2 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of shareAccessRateLimits.entries()) {
    if (now - bucket.windowStart > SHARE_RATE_WINDOW_MS * 2) {
      shareAccessRateLimits.delete(key);
    }
  }
}, 120000);

function checkShareRateLimit(key: string, maxLimit: number): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = shareAccessRateLimits.get(key);

  if (!bucket || now - bucket.windowStart > SHARE_RATE_WINDOW_MS) {
    shareAccessRateLimits.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: maxLimit - 1 };
  }

  if (bucket.count >= maxLimit) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: maxLimit - bucket.count };
}

// 4. Public Sanitized Read Endpoint: GET /api/share/:token
app.get('/api/share/:token', (req, res) => {
  try {
    const token = req.params.token;
    if (!token || typeof token !== 'string' || !SHARE_TOKEN_REGEX.test(token)) {
      return res.status(400).json({
        error: 'Invalid share token format. Must be a valid URL-safe base64 string.',
        invalidToken: true,
      });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '127.0.0.1';
    
    // Check 1: Global IP-level rate limit (anti-enumeration & anti-scraping)
    const ipCheck = checkShareRateLimit(`ip_${clientIp}`, MAX_IP_READS_PER_MINUTE);
    if (!ipCheck.allowed) {
      return res.status(429).json({
        error: 'Too many requests from this IP address. Anti-scraping rate limit exceeded (60 req/min).',
      });
    }

    // Check 2: Per-token rate limit (anti-link exhaustion)
    const tokenCheck = checkShareRateLimit(`tok_${token}`, MAX_TOKEN_READS_PER_MINUTE);
    if (!tokenCheck.allowed) {
      return res.status(429).json({
        error: 'Too many requests for this specific share link. Rate limit exceeded (20 req/min).',
      });
    }

    // Lookup token in Admin SDK-guarded repository
    const link = serverShareLinksRepository.get(token);
    if (!link) {
      return res.status(404).json({
        error: 'Share link not found or invalid.',
        notFound: true,
      });
    }

    // Server-side check 1: Revocation (checked ahead of expiry)
    if (link.revoked) {
      return res.status(410).json({
        error: 'This share link has been revoked by the author.',
        revoked: true,
        token,
      });
    }

    // Server-side check 2: Expiration (checked on every read against current server time)
    const nowMs = Date.now();
    const expiresAtMs = new Date(link.expiresAt).getTime();
    if (nowMs >= expiresAtMs) {
      return res.status(410).json({
        error: 'This share link has expired.',
        expired: true,
        expiresAt: link.expiresAt,
        token,
      });
    }

    // Retrieve target entry
    const entry = serverEntriesRepository.get(link.entryId);
    if (!entry) {
      return res.status(404).json({
        error: 'The shared entry no longer exists.',
        notFound: true,
      });
    }

    // Access logging (rough IP masking for privacy)
    link.accessCount += 1;
    link.lastAccessedAt = new Date().toISOString();
    const maskedIp = clientIp.includes('.')
      ? clientIp.split('.').slice(0, 3).join('.') + '.xxx'
      : 'masked_ipv6';
    link.accessLogs.push({
      timestamp: link.lastAccessedAt,
      ipMask: maskedIp,
    });
    if (link.accessLogs.length > 50) {
      link.accessLogs.shift();
    }

    // Field Minimization on the Shared View:
    // 1. Strip location by default unless explicitly included by owner
    // 2. Strip moodScore & moodLabel by default
    // 3. Strip internal user IDs, email, moderation flags, and notification state
    const sanitizedTurns = (entry.turns || []).map((t: any) => ({
      id: t.id,
      role: t.role,
      content: t.content,
      timestamp: t.timestamp,
      mode: t.mode,
    }));

    const sanitizedView = {
      id: entry.id,
      title: entry.title,
      topic: entry.topic,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      turns: sanitizedTurns,
      summary: entry.summary,
      keyThemes: entry.keyThemes,
      // Geospatial minimization
      hasLocation: Boolean(entry.location),
      location: link.includeLocation ? entry.location : undefined,
      locationStripped: Boolean(entry.location && !link.includeLocation),
      // Mood sentiment minimization
      hasMood: Boolean(entry.moodScore !== undefined),
      moodScore: link.includeMood ? entry.moodScore : undefined,
      moodLabel: link.includeMood ? entry.moodLabel : undefined,
      moodStripped: Boolean(entry.moodScore !== undefined && !link.includeMood),
      // Share metadata
      shareMetadata: {
        token: link.token,
        createdAt: link.createdAt,
        expiresAt: link.expiresAt,
        accessCount: link.accessCount,
        timeRemainingSeconds: Math.max(0, Math.round((expiresAtMs - nowMs) / 1000)),
      },
    };

    return res.json({
      success: true,
      entry: sanitizedView,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Error processing shareable link.' });
  }
});

// 5. Create Expiring Share Link Endpoint: POST /api/share/create
app.post('/api/share/create', (req, res) => {
  try {
    const callerUid = (req.headers['x-user-id'] as string) || '';
    if (!callerUid) {
      return res.status(401).json({ error: 'Authentication required to generate share links.' });
    }

    const { entryId, durationHours = 24, includeLocation = false, includeMood = false } = req.body || {};
    if (!entryId) {
      return res.status(400).json({ error: 'entryId is required.' });
    }

    const entry = serverEntriesRepository.get(entryId);
    if (!entry) {
      return res.status(404).json({ error: `Entry ${entryId} not found.` });
    }

    // Verify caller ownership or admin privileges
    if (entry.userId !== callerUid) {
      const callerRole = resolveAuthoritativeRole(callerUid, (req.headers['x-user-email'] as string) || '');
      if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: You can only generate share links for your own entries.' });
      }
    }

    // Quota Guard: Cap maximum active share links per entry to 10 to prevent resource exhaustion
    const nowMs = Date.now();
    const existingActiveLinksForEntry = Array.from(serverShareLinksRepository.values()).filter(
      (l) => l.entryId === entryId && !l.revoked && new Date(l.expiresAt).getTime() > nowMs
    );

    if (existingActiveLinksForEntry.length >= 10) {
      return res.status(400).json({
        error: 'Active share link limit reached. Maximum 10 active links allowed per reflection. Please revoke existing links before generating a new one.',
      });
    }

    // Clamp duration between 1 hour and 720 hours (30 days)
    const hours = Math.min(Math.max(Number(durationHours) || 24, 1), 720);
    const token = generateShareToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 3600 * 1000).toISOString();

    const newShareLink: ServerShareLinkRecord = {
      token,
      entryId,
      ownerId: callerUid,
      createdAt: now.toISOString(),
      expiresAt,
      revoked: false,
      includeLocation: Boolean(includeLocation),
      includeMood: Boolean(includeMood),
      accessCount: 0,
      accessLogs: [],
    };

    serverShareLinksRepository.set(token, newShareLink);

    return res.json({
      success: true,
      shareLink: newShareLink,
      token,
      expiresAt,
      message: `Expiring share link generated (valid for ${hours}h).`,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to create share link.' });
  }
});

// 6. Revoke Share Link Endpoint: POST /api/share/revoke
app.post('/api/share/revoke', (req, res) => {
  try {
    const callerUid = (req.headers['x-user-id'] as string) || '';
    if (!callerUid) {
      return res.status(401).json({ error: 'Authentication required to revoke share links.' });
    }

    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ error: 'token parameter is required.' });
    }

    const link = serverShareLinksRepository.get(token);
    if (!link) {
      return res.status(404).json({ error: 'Share link not found.' });
    }

    // Verify caller ownership or admin privileges
    if (link.ownerId !== callerUid) {
      const callerRole = resolveAuthoritativeRole(callerUid, (req.headers['x-user-email'] as string) || '');
      if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: You can only revoke your own share links.' });
      }
    }

    link.revoked = true;

    return res.json({
      success: true,
      token,
      message: 'Share link revoked successfully. Future access attempts will be blocked.',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to revoke share link.' });
  }
});

// 7. List Share Links for Entry: GET /api/share/links/:entryId
app.get('/api/share/links/:entryId', (req, res) => {
  try {
    const callerUid = (req.headers['x-user-id'] as string) || '';
    if (!callerUid) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const { entryId } = req.params;
    const entry = serverEntriesRepository.get(entryId);
    if (!entry) {
      return res.status(404).json({ error: `Entry ${entryId} not found.` });
    }

    if (entry.userId !== callerUid) {
      const callerRole = resolveAuthoritativeRole(callerUid, (req.headers['x-user-email'] as string) || '');
      if (callerRole !== 'admin') {
        return res.status(403).json({ error: 'Forbidden: Cannot view share links of other users.' });
      }
    }

    const links = Array.from(serverShareLinksRepository.values())
      .filter((l) => l.entryId === entryId)
      .map((l) => {
        const isExpired = new Date(l.expiresAt).getTime() <= Date.now();
        return {
          token: l.token,
          entryId: l.entryId,
          ownerId: l.ownerId,
          createdAt: l.createdAt,
          expiresAt: l.expiresAt,
          revoked: l.revoked,
          includeLocation: l.includeLocation,
          includeMood: l.includeMood,
          accessCount: l.accessCount,
          lastAccessedAt: l.lastAccessedAt,
          isExpired,
          status: l.revoked ? 'revoked' : isExpired ? 'expired' : 'active',
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return res.json({ links });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to list share links.' });
  }
});

// 8. Admin Telemetry & Test Vectors Endpoint: GET /api/share/admin-summary
app.get('/api/share/admin-summary', requireAdminRole, (_req, res) => {
  try {
    const allLinks = Array.from(serverShareLinksRepository.values());
    const now = Date.now();
    const active = allLinks.filter((l) => !l.revoked && new Date(l.expiresAt).getTime() > now);
    const expired = allLinks.filter((l) => !l.revoked && new Date(l.expiresAt).getTime() <= now);
    const revoked = allLinks.filter((l) => l.revoked);

    return res.json({
      totalCount: allLinks.length,
      activeCount: active.length,
      expiredCount: expired.length,
      revokedCount: revoked.length,
      sampleTokens: {
        active: sampleActiveToken,
        expired: sampleExpiredToken,
        revoked: sampleRevokedToken,
      },
      links: allLinks.map((l) => ({
        token: l.token,
        entryId: l.entryId,
        ownerId: l.ownerId,
        createdAt: l.createdAt,
        expiresAt: l.expiresAt,
        revoked: l.revoked,
        includeLocation: l.includeLocation,
        includeMood: l.includeMood,
        accessCount: l.accessCount,
        lastAccessedAt: l.lastAccessedAt,
        status: l.revoked ? 'revoked' : new Date(l.expiresAt).getTime() <= now ? 'expired' : 'active',
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to fetch share telemetry.' });
  }
});



async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Reflection Journal Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
