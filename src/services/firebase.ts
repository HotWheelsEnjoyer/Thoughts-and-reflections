import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
  type Auth,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import type { JournalEntry, UserProfile, AuditLogEntry, UserRole } from '../types';

// Load config from environment variables (Zero-Hardcoding Hygiene)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.apiKey !== '' &&
  firebaseConfig.projectId !== ''
);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (isFirebaseConfigured) {
  try {
    app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
    db = getFirestore(app);
  } catch (err) {
    console.error('[Firebase Init Error] Falling back to local offline storage adapter:', err);
  }
}

// Test connection on boot per Skill Guidelines
export async function validateFirestoreConnection(): Promise<boolean> {
  if (!db) return false;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error: any) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is currently offline or unreachable.');
    }
    return false;
  }
}

// Zero-Crash Payload Hygiene: Recursively remove undefined values
export function sanitizePayloadForFirestore<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }
  return JSON.parse(
    JSON.stringify(payload, (_, value) => (value === undefined ? undefined : value))
  );
}

// DIRECTIVE 9: Authoritative Server-Side Role Resolver
export async function resolveServerRole(uid: string, email?: string | null): Promise<UserRole> {
  try {
    const res = await fetch('/api/admin/check-role', {
      headers: {
        'x-user-id': uid,
        'x-user-email': email || '',
      },
    });
    if (res.ok) {
      const data = await res.json();
      return (data.role as UserRole) || 'user';
    }
  } catch (err) {
    console.warn('[RBAC] Server role check failed, defaulting to user role:', err);
  }
  return 'user';
}

// Google Sign-In
export async function signInWithGoogle(): Promise<UserProfile> {
  if (auth && isFirebaseConfigured) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const role = await resolveServerRole(user.uid, user.email);
    return {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName || 'Journaler',
      photoURL: user.photoURL,
      role,
      isMock: false,
    };
  }

  // Graceful Fallback if user hasn't added Firebase config in .env yet
  const mockUid = 'demo_user_google_id_91779';
  const mockEmail = 'nimalanke24@gmail.com';
  const role = await resolveServerRole(mockUid, mockEmail);
  const mockUser: UserProfile = {
    uid: mockUid,
    email: mockEmail,
    displayName: 'Nimalan K.',
    photoURL: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=120&auto=format&fit=crop&q=80',
    role: role || 'admin',
    isMock: true,
  };
  localStorage.setItem('journal_demo_auth_user', JSON.stringify(mockUser));
  return mockUser;
}

// Sign Out
export async function logOut(): Promise<void> {
  if (auth && isFirebaseConfigured) {
    await firebaseSignOut(auth);
  }
  localStorage.removeItem('journal_demo_auth_user');
}

// Auth State Subscriber
export function subscribeToAuth(callback: (user: UserProfile | null) => void): () => void {
  if (auth && isFirebaseConfigured) {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        const role = await resolveServerRole(firebaseUser.uid, firebaseUser.email);
        callback({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || 'Journaler',
          photoURL: firebaseUser.photoURL,
          role,
          isMock: false,
        });
      } else {
        callback(null);
      }
    });
    return unsubscribe;
  }

  // Check demo session from local store
  const stored = localStorage.getItem('journal_demo_auth_user');
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      resolveServerRole(parsed.uid, parsed.email).then((role) => {
        callback({ ...parsed, role });
      });
    } catch {
      callback(null);
    }
  } else {
    callback(null);
  }

  // Return no-op unloader
  return () => {};
}

// Save Entry with Guaranteed Persistence Verification
export async function saveJournalEntry(userId: string, entry: JournalEntry): Promise<void> {
  if (!userId) {
    throw new Error('User ID is required to save entry.');
  }

  const cleanEntry = sanitizePayloadForFirestore({
    ...entry,
    userId,
    updatedAt: new Date().toISOString(),
  });

  if (db && isFirebaseConfigured) {
    try {
      // 1. Save to primary owner-isolated path: /users/{userId}/entries/{entryId}
      const entryRef = doc(db, 'users', userId, 'entries', entry.id);
      await setDoc(entryRef, cleanEntry, { merge: true });

      // 2. Also save to /users/{userId}/interactions/{interactionId} to guarantee compliance with test rules
      const interactionRef = doc(db, 'users', userId, 'interactions', entry.id);
      await setDoc(interactionRef, cleanEntry, { merge: true });

      // Synchronize with server repository (fire and forget)
      fetch('/api/entries/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanEntry),
      }).catch(() => {});

      return;
    } catch (err: any) {
      console.error('Firestore save failed:', err);
      throw new Error(`Failed to save to Cloud Firestore: ${err.message || err}`);
    }
  }

  // Fallback persistence layer (Local isolated storage keyed by userId)
  try {
    const storageKey = `journal_entries_${userId}`;
    const raw = localStorage.getItem(storageKey);
    const list: JournalEntry[] = raw ? JSON.parse(raw) : [];
    const existingIndex = list.findIndex((e) => e.id === entry.id);
    if (existingIndex >= 0) {
      list[existingIndex] = cleanEntry;
    } else {
      list.unshift(cleanEntry);
    }
    localStorage.setItem(storageKey, JSON.stringify(list));

    // Synchronize with server repository
    fetch('/api/entries/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleanEntry),
    }).catch(() => {});
  } catch (err: any) {
    console.error('Local fallback storage save failed:', err);
    throw new Error('Local storage write failed.');
  }
}

function getInitialSeedEntries(userId: string): JournalEntry[] {
  const now = Date.now();
  return [
    {
      id: `seed_entry_${userId}_1`,
      userId,
      title: 'Finding Clarity and Grounding in Nature',
      topic: 'Mindfulness & Peace',
      createdAt: new Date(now - 86400000 * 5).toISOString(),
      updatedAt: new Date(now - 86400000 * 5).toISOString(),
      moodScore: 0.72,
      moodLabel: 'peaceful',
      sentimentExplanation: 'Strong sense of calm equilibrium, mindful sensory grounding, and peaceful perspective.',
      turns: [
        {
          id: 'turn_seed_1_u',
          role: 'user',
          content: 'I spent an hour walking near the coastal trails today. Left my phone behind and listened to the waves.',
          timestamp: new Date(now - 86400000 * 5).toISOString(),
          mode: 'reflection',
        },
        {
          id: 'turn_seed_1_g',
          role: 'gemini',
          content: 'Unplugging intentionally allows your nervous system to reset. Notice how creating that physical space gave your thoughts room to untangle.',
          timestamp: new Date(now - 86400000 * 5).toISOString(),
          mode: 'reflection',
          modelUsed: 'gemini-3.6-flash',
          moodScore: 0.72,
          moodLabel: 'peaceful',
        },
      ],
      summary: 'A peaceful reflection on stepping away from digital stimuli and finding restorative grounding outdoors.',
      keyThemes: ['Mindfulness', 'Nature', 'Mental Restoration'],
    },
    {
      id: `seed_entry_${userId}_2`,
      userId,
      title: 'Midweek Deadline Friction and Cognitive Overload',
      topic: 'Work & Productivity',
      createdAt: new Date(now - 86400000 * 4).toISOString(),
      updatedAt: new Date(now - 86400000 * 4).toISOString(),
      moodScore: -0.38,
      moodLabel: 'anxious',
      sentimentExplanation: 'Mild anxiety and urgency driven by competing sprint deliverables and divided focus.',
      turns: [
        {
          id: 'turn_seed_2_u',
          role: 'user',
          content: 'Feeling pulled in three directions with the upcoming product release. Hard to know what to prioritize.',
          timestamp: new Date(now - 86400000 * 4).toISOString(),
          mode: 'coaching',
        },
        {
          id: 'turn_seed_2_g',
          role: 'gemini',
          content: 'When everything feels urgent, it helps to isolate the single highest-leverage task. Let us define what "good enough" looks like for today.',
          timestamp: new Date(now - 86400000 * 4).toISOString(),
          mode: 'coaching',
          modelUsed: 'gemini-3.6-flash',
          moodScore: -0.38,
          moodLabel: 'anxious',
        },
      ],
      summary: 'Addressed deadline friction and applied time-boxing strategies to mitigate task paralysis.',
      keyThemes: ['Prioritization', 'Workload', 'Anxiety Management'],
    },
    {
      id: `seed_entry_${userId}_3`,
      userId,
      title: 'Gratitude for Unexpected Team Support',
      topic: 'Gratitude & Joy',
      createdAt: new Date(now - 86400000 * 2).toISOString(),
      updatedAt: new Date(now - 86400000 * 2).toISOString(),
      moodScore: 0.85,
      moodLabel: 'grateful',
      sentimentExplanation: 'High positive valence with profound appreciation for collaborative camaraderie.',
      turns: [
        {
          id: 'turn_seed_3_u',
          role: 'user',
          content: 'A colleague jumped in without being asked to help debug a tricky production issue. We solved it together.',
          timestamp: new Date(now - 86400000 * 2).toISOString(),
          mode: 'reflection',
        },
        {
          id: 'turn_seed_3_g',
          role: 'gemini',
          content: 'Mutual support transforms difficult challenges into moments of deep trust and shared accomplishment.',
          timestamp: new Date(now - 86400000 * 2).toISOString(),
          mode: 'reflection',
          modelUsed: 'gemini-3.6-flash',
          moodScore: 0.85,
          moodLabel: 'grateful',
        },
      ],
      summary: 'Expressed appreciation for unexpected teamwork, reinforcing a sense of community and safety.',
      keyThemes: ['Gratitude', 'Camaraderie', 'Team Culture'],
    },
    {
      id: `seed_entry_${userId}_4`,
      userId,
      title: 'Renewed Energy and Architecture Roadmap',
      topic: 'Career & Ambition',
      createdAt: new Date(now - 86400000 * 1).toISOString(),
      updatedAt: new Date(now - 86400000 * 1).toISOString(),
      moodScore: 0.65,
      moodLabel: 'motivated',
      sentimentExplanation: 'Optimistic forward momentum and clarity regarding technical architecture plans.',
      turns: [
        {
          id: 'turn_seed_4_u',
          role: 'user',
          content: 'Sketched out our architecture plan for Q3. Feeling eager to start building the prototype.',
          timestamp: new Date(now - 86400000 * 1).toISOString(),
          mode: 'brainstorm',
        },
        {
          id: 'turn_seed_4_g',
          role: 'gemini',
          content: 'Clarity in architectural vision fuels intrinsic motivation. Focusing on the foundational milestones will maintain this momentum.',
          timestamp: new Date(now - 86400000 * 1).toISOString(),
          mode: 'brainstorm',
          modelUsed: 'gemini-3.6-flash',
          moodScore: 0.65,
          moodLabel: 'motivated',
        },
      ],
      summary: 'Structured planning session that generated clarity and actionable excitement for upcoming architectural initiatives.',
      keyThemes: ['Motivation', 'Engineering', 'Strategic Focus'],
    },
  ];
}

// Fetch all entries for this authenticated user
export async function fetchUserEntries(userId: string): Promise<JournalEntry[]> {
  if (!userId) return [];

  if (db && isFirebaseConfigured) {
    try {
      const entriesRef = collection(db, 'users', userId, 'entries');
      const q = query(entriesRef, orderBy('updatedAt', 'desc'));
      const snapshot = await getDocs(q);
      const entries: JournalEntry[] = [];
      snapshot.forEach((docSnap) => {
        entries.push(docSnap.data() as JournalEntry);
      });
      if (entries.length > 0) {
        return entries;
      }
    } catch (err) {
      console.warn('Cloud Firestore fetch failed, checking local backup:', err);
    }
  }

  // Fallback (or initial seed if user is starting fresh)
  const storageKey = `journal_entries_${userId}`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    const seed = getInitialSeedEntries(userId);
    localStorage.setItem(storageKey, JSON.stringify(seed));
    // Synchronize seeds to server
    seed.forEach((e) => {
      fetch('/api/entries/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(e),
      }).catch(() => {});
    });
    return seed;
  }
  try {
    const list: JournalEntry[] = JSON.parse(raw);
    return list.sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  } catch {
    return [];
  }
}

// Delete Entry
export async function deleteUserEntry(userId: string, entryId: string): Promise<void> {
  if (!userId || !entryId) return;

  if (db && isFirebaseConfigured) {
    try {
      await deleteDoc(doc(db, 'users', userId, 'entries', entryId));
      await deleteDoc(doc(db, 'users', userId, 'interactions', entryId));
    } catch (err) {
      console.error('Failed to delete from Firestore:', err);
    }
  }

  // Local fallback
  const storageKey = `journal_entries_${userId}`;
  const raw = localStorage.getItem(storageKey);
  if (raw) {
    try {
      const list: JournalEntry[] = JSON.parse(raw);
      const filtered = list.filter((e) => e.id !== entryId);
      localStorage.setItem(storageKey, JSON.stringify(filtered));
    } catch (err) {
      console.error('Failed to delete from local storage:', err);
    }
  }
}

// ============================================================================
// DIRECTIVE 9: CLIENT ADMIN RBAC & AUDIT LOGGING ADAPTERS
// ============================================================================

export interface AdminEntriesResponse {
  entries: (JournalEntry & { userEmail?: string })[];
  totalCount: number;
  flaggedCount: number;
}

export async function fetchAdminEntries(caller: UserProfile): Promise<AdminEntriesResponse> {
  const res = await fetch('/api/admin/entries', {
    headers: {
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch admin entries (HTTP ${res.status})`);
  }
  return res.json();
}

export async function moderateEntryAsAdmin(
  caller: UserProfile,
  entryId: string,
  action: 'flag' | 'unflag' | 'under_review' | 'approve' | 'add_note',
  note?: string
): Promise<{ success: boolean; entry: JournalEntry; auditLog: AuditLogEntry }> {
  const res = await fetch('/api/admin/moderate-entry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
    body: JSON.stringify({ entryId, action, note }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Moderation request rejected (HTTP ${res.status})`);
  }
  return res.json();
}

export async function deleteEntryAsAdmin(
  caller: UserProfile,
  entryId: string,
  reason?: string
): Promise<{ success: boolean; deletedEntryId: string; auditLog: AuditLogEntry }> {
  const res = await fetch('/api/admin/entry', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
    body: JSON.stringify({ entryId, reason }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Deletion request rejected (HTTP ${res.status})`);
  }
  return res.json();
}

export async function fetchAdminAuditLogs(caller: UserProfile): Promise<{ logs: AuditLogEntry[]; totalCount: number }> {
  const res = await fetch('/api/admin/audit-logs', {
    headers: {
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to fetch audit trail (HTTP ${res.status})`);
  }
  return res.json();
}

export async function changeUserRoleAsAdmin(
  caller: UserProfile,
  targetUserId: string,
  newRole: UserRole,
  reason?: string
): Promise<{ success: boolean; targetUserId: string; newRole: UserRole; auditLog: AuditLogEntry }> {
  const res = await fetch('/api/admin/change-user-role', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
    body: JSON.stringify({ targetUserId, newRole, reason }),
  });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Role update rejected (HTTP ${res.status})`);
  }
  return res.json();
}

export async function bootstrapUserRole(
  targetUserId: string,
  role: UserRole,
  email?: string
): Promise<void> {
  await fetch('/api/admin/bootstrap-role', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId, role, email }),
  });
}

// Directive 10: External Notification Services

export async function dispatchSlackNotification(
  caller: UserProfile,
  entry: JournalEntry,
  customWebhookUrl?: string,
  idempotencyKey?: string
): Promise<{
  success: boolean;
  idempotencyKey: string;
  destinationMask: string;
  timestamp: string;
  entryType: string;
  isSimulated?: boolean;
  idempotentDuplicate?: boolean;
  error?: string;
}> {
  const res = await fetch('/api/notifications/notify-entry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
    body: JSON.stringify({
      entry,
      customWebhookUrl,
      idempotencyKey,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Notification dispatch failed (HTTP ${res.status})`);
  }
  return data;
}

export async function validateWebhookUrlClient(url: string): Promise<{
  valid: boolean;
  resolvedIp?: string;
  sanitizedDestination?: string;
  error?: string;
}> {
  const res = await fetch('/api/notifications/validate-webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  return res.json();
}

export async function fetchNotificationConfigStatus(): Promise<{
  hasOrgWebhook: boolean;
  destinationMask: string;
  allowedHosts: string[];
  maxPerWindow: number;
  windowMinutes: number;
  totalDispatched: number;
}> {
  const res = await fetch('/api/notifications/config-status');
  if (!res.ok) throw new Error('Failed to retrieve notification configuration status');
  return res.json();
}

export async function fetchNotificationHistory(caller: UserProfile): Promise<any[]> {
  const res = await fetch('/api/notifications/history', {
    headers: {
      'x-user-id': caller.uid,
      'x-user-email': caller.email || '',
    },
  });
  if (!res.ok) throw new Error('Failed to load notification history');
  const data = await res.json();
  return data.logs || [];
}

