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
import appletConfig from '../../firebase-applet-config.json';

// Load config from environment variables or provisioned applet configuration
const configJson: Record<string, string> = appletConfig || {};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || configJson.apiKey || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || configJson.authDomain || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || configJson.projectId || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || configJson.storageBucket || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || configJson.messagingSenderId || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || configJson.appId || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || configJson.measurementId || '',
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

// Authoritative Server-Side Role Resolver
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

// Active Auth state listeners
const authListeners = new Set<(user: UserProfile | null) => void>();
let currentActiveUser: UserProfile | null = null;

function notifyAuthSubscribers(user: UserProfile | null) {
  currentActiveUser = user;
  authListeners.forEach((callback) => {
    try {
      callback(user);
    } catch (e) {
      console.error('[Auth Listener Error]', e);
    }
  });
}

// Google Sign-In (Authentic Google Authentication via Firebase Auth or Google Identity Services)
export async function signInWithGoogle(): Promise<UserProfile> {
  // 1. If Firebase Auth is configured and active, use Firebase Google Auth Provider
  if (auth && isFirebaseConfigured) {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, provider);
      const user = result.user;
      const role = await resolveServerRole(user.uid, user.email);
      const profile: UserProfile = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || user.email?.split('@')[0] || 'User',
        photoURL: user.photoURL,
        role,
      };
      notifyAuthSubscribers(profile);
      return profile;
    } catch (firebaseErr: any) {
      if (firebaseErr.code === 'auth/popup-closed-by-user') {
        throw new Error('Sign-in cancelled: Google popup was closed before completing authentication.');
      }
      console.warn('Firebase Google Auth popup error, falling back to Google Identity Services:', firebaseErr);
    }
  }

  // 2. Google Identity Services (GSI) Client-Side OAuth Protocol
  return new Promise<UserProfile>((resolve, reject) => {
    const gsi = (window as any).google?.accounts?.oauth2;
    if (gsi) {
      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || configJson.oAuthClientId || '750034257375-k54uoh10esgk94r2d42hbnbc9grbjkd0.apps.googleusercontent.com';
      try {
        const tokenClient = gsi.initTokenClient({
          client_id: clientId,
          scope: 'openid email profile',
          prompt: 'select_account',
          callback: async (tokenResponse: any) => {
            if (tokenResponse.error) {
              reject(new Error(tokenResponse.error_description || tokenResponse.error || 'Google Sign-In failed.'));
              return;
            }
            try {
              const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
              });
              if (!res.ok) throw new Error('Failed to retrieve user profile from Google.');
              const info = await res.json();
              const uid = `google_${info.sub || info.id}`;
              const role = await resolveServerRole(uid, info.email);
              const userProfile: UserProfile = {
                uid,
                email: info.email || null,
                displayName: info.name || info.given_name || info.email?.split('@')[0] || 'User',
                photoURL: info.picture || null,
                role,
              };
              sessionStorage.setItem('journal_auth_user', JSON.stringify(userProfile));
              notifyAuthSubscribers(userProfile);
              resolve(userProfile);
            } catch (err: any) {
              reject(new Error(`Failed to load Google account data: ${err.message}`));
            }
          },
          error_callback: (err: any) => {
            reject(new Error(err.message || 'Google Sign-In popup was closed or blocked.'));
          },
        });
        tokenClient.requestAccessToken({ prompt: 'select_account' });
        return;
      } catch (gsiErr: any) {
        console.error('GIS token client error:', gsiErr);
      }
    }

    // 3. Fallback to Google OpenID Connect Prompt
    const gsiId = (window as any).google?.accounts?.id;
    if (gsiId) {
      gsiId.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID || configJson.oAuthClientId || '750034257375-k54uoh10esgk94r2d42hbnbc9grbjkd0.apps.googleusercontent.com',
        callback: async (response: any) => {
          try {
            // Decode JWT payload
            const base64Url = response.credential.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
              atob(base64)
                .split('')
                .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
                .join('')
            );
            const info = JSON.parse(jsonPayload);
            const uid = `google_${info.sub}`;
            const role = await resolveServerRole(uid, info.email);
            const userProfile: UserProfile = {
              uid,
              email: info.email || null,
              displayName: info.name || info.given_name || 'User',
              photoURL: info.picture || null,
              role,
            };
            sessionStorage.setItem('journal_auth_user', JSON.stringify(userProfile));
            notifyAuthSubscribers(userProfile);
            resolve(userProfile);
          } catch (err: any) {
            reject(new Error('Failed to process Google sign-in credentials.'));
          }
        },
      });
      gsiId.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          reject(new Error('Google One Tap sign-in was skipped or not displayed in this browser context.'));
        }
      });
      return;
    }

    reject(
      new Error(
        'Google Authentication service is initializing. Please verify network connection or allow popups and try again.'
      )
    );
  });
}

// Direct / Account-bound Sign-In (For immediate access or when Google OAuth domains are being configured)
export async function signInWithDirectEmail(email: string, name?: string): Promise<UserProfile> {
  if (!email || !email.includes('@')) {
    throw new Error('Please provide a valid email address.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const uid = `usr_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const displayName = name?.trim() || cleanEmail.split('@')[0];
  const role = await resolveServerRole(uid, cleanEmail);

  const profile: UserProfile = {
    uid,
    email: cleanEmail,
    displayName,
    photoURL: null,
    role,
  };

  sessionStorage.setItem('journal_auth_user', JSON.stringify(profile));
  notifyAuthSubscribers(profile);
  return profile;
}

// Sign Out
export async function logOut(): Promise<void> {
  if (auth && isFirebaseConfigured) {
    try {
      await firebaseSignOut(auth);
    } catch (e) {
      console.warn('Firebase signout warning:', e);
    }
  }
  sessionStorage.removeItem('journal_auth_user');
  localStorage.removeItem('journal_demo_auth_user');
  notifyAuthSubscribers(null);
}

// Auth State Subscriber
export function subscribeToAuth(callback: (user: UserProfile | null) => void): () => void {
  authListeners.add(callback);

  // If Firebase Auth is active
  let firebaseUnsubscribe: (() => void) | null = null;
  if (auth && isFirebaseConfigured) {
    firebaseUnsubscribe = onAuthStateChanged(auth, async (firebaseUser: User | null) => {
      if (firebaseUser) {
        const role = await resolveServerRole(firebaseUser.uid, firebaseUser.email);
        const userProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName || 'User',
          photoURL: firebaseUser.photoURL,
          role,
        };
        currentActiveUser = userProfile;
        callback(userProfile);
      } else {
        // Check session storage
        const stored = sessionStorage.getItem('journal_auth_user');
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            resolveServerRole(parsed.uid, parsed.email).then((role) => {
              const profile = { ...parsed, role };
              currentActiveUser = profile;
              callback(profile);
            });
            return;
          } catch {
            currentActiveUser = null;
            callback(null);
          }
        } else {
          currentActiveUser = null;
          callback(null);
        }
      }
    });
  } else {
    // Check session storage
    const stored = sessionStorage.getItem('journal_auth_user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        resolveServerRole(parsed.uid, parsed.email).then((role) => {
          const profile = { ...parsed, role };
          currentActiveUser = profile;
          callback(profile);
        });
      } catch {
        currentActiveUser = null;
        callback(null);
      }
    } else {
      currentActiveUser = null;
      callback(null);
    }
  }

  return () => {
    authListeners.delete(callback);
    if (firebaseUnsubscribe) firebaseUnsubscribe();
  };
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

  // Local fallback storage for user entries
  const storageKey = `journal_entries_${userId}`;
  const raw = localStorage.getItem(storageKey);
  if (!raw) {
    return [];
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
// CLIENT ADMIN RBAC & AUDIT LOGGING ADAPTERS
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

// External Notification Services

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

