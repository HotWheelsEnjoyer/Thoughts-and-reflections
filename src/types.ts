export type ReflectionMode = 'reflection' | 'brainstorm' | 'summary' | 'coaching';

export type MoodLabel =
  | 'joyful'
  | 'grateful'
  | 'peaceful'
  | 'motivated'
  | 'neutral'
  | 'reflective'
  | 'anxious'
  | 'frustrated'
  | 'sad'
  | 'overwhelmed';

export interface JournalTurn {
  id: string;
  role: 'user' | 'gemini';
  content: string;
  timestamp: string;
  mode?: ReflectionMode;
  modelUsed?: string;
  moodScore?: number;
  moodLabel?: MoodLabel;
}

export interface LocationData {
  lat: number;
  lng: number;
  name?: string;
  accuracy?: number;
  approximate?: boolean;
}

export interface ModerationMetadata {
  isFlagged?: boolean;
  moderationStatus?: 'approved' | 'flagged' | 'under_review';
  moderationNote?: string;
  moderatedAt?: string;
  moderatedBy?: string;
}

export interface NotificationMetadata {
  sent: boolean;
  sentAt?: string;
  destinationMask?: string;
  error?: string;
  idempotencyKey?: string;
}

export interface JournalEntry {
  id: string;
  userId: string;
  title: string;
  topic: string;
  entryType?: 'standard' | 'crisis_support' | 'action_milestone';
  createdAt: string;
  updatedAt: string;
  turns: JournalTurn[];
  summary?: string;
  keyThemes?: string[];
  isStarred?: boolean;
  location?: LocationData;
  moderation?: ModerationMetadata;
  notification?: NotificationMetadata;
  moodScore?: number;
  moodLabel?: MoodLabel;
  sentimentExplanation?: string;
}

export interface MoodTrendPoint {
  entryId: string;
  title: string;
  date: string;
  displayDate: string;
  moodScore: number;
  moodLabel: MoodLabel;
  sentimentExplanation?: string;
  topic?: string;
}

export type UserRole = 'admin' | 'user';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role?: UserRole;
  isMock?: boolean;
}

export interface AuditLogEntry {
  id: string;
  action: 'FLAG_ENTRY' | 'UNFLAG_ENTRY' | 'ADD_MODERATION_NOTE' | 'DELETE_ENTRY' | 'CHANGE_USER_ROLE';
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

export interface ModeOption {
  id: ReflectionMode;
  name: string;
  description: string;
  iconName: string;
  promptPlaceholder: string;
}

export interface WebhookValidationResult {
  valid: boolean;
  sanitizedUrl?: string;
  resolvedIp?: string;
  error?: string;
}

export interface NotificationLogRecord {
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

export interface ShareLink {
  token: string;
  entryId: string;
  ownerId: string;
  createdAt: string;
  expiresAt: string;
  revoked: boolean;
  includeLocation: boolean;
  includeMood: boolean;
  accessCount?: number;
  lastAccessedAt?: string;
}

export interface SharedReadEntry {
  title: string;
  topic: string;
  createdAt: string;
  turns: {
    id: string;
    role: 'user' | 'gemini';
    content: string;
    timestamp: string;
    mode?: ReflectionMode;
  }[];
  summary?: string;
  keyThemes?: string[];
  hasLocation: boolean;
  location?: LocationData;
  expiresAt: string;
  revoked: boolean;
  isExpired: boolean;
  accessCount: number;
}

