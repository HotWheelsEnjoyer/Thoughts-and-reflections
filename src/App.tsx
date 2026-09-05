/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { LandingPage } from './components/LandingPage';
import { JournalEditor } from './components/JournalEditor';
import { EntryHistory } from './components/EntryHistory';
import { MoodTrendDashboard } from './components/MoodTrendDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import { SecurityDrawer } from './components/SecurityDrawer';
import { SharedEntryView } from './components/SharedEntryView';
import {
  subscribeToAuth,
  signInWithGoogle,
  logOut,
  fetchUserEntries,
  deleteUserEntry,
  isFirebaseConfigured,
} from './services/firebase';
import type { JournalEntry, UserProfile } from './types';
import { ShieldCheck, Info } from 'lucide-react';

function createNewEntry(userId: string): JournalEntry {
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return {
    id: 'entry_' + Date.now(),
    userId,
    title: `Reflection — ${dateStr}`,
    topic: 'Personal Growth',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    turns: [],
  };
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeEntry, setActiveEntry] = useState<JournalEntry | null>(null);
  const [activeView, setActiveView] = useState<'editor' | 'history' | 'trends' | 'admin'>('editor');
  const [isSecurityModalOpen, setIsSecurityModalOpen] = useState(false);

  // Expiring Share Link Routing (Directive 11: Zero-account public viewing)
  const [shareToken, setShareToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const urlParams = new URLSearchParams(window.location.search);
    const fromParam = urlParams.get('share');
    if (fromParam) return fromParam;
    const hash = window.location.hash;
    if (hash && hash.startsWith('#share=')) {
      return hash.replace('#share=', '');
    }
    return null;
  });

  // Listen to popstate or hashchange
  useEffect(() => {
    const handleUrlChange = () => {
      const urlParams = new URLSearchParams(window.location.search);
      const fromParam = urlParams.get('share');
      if (fromParam) {
        setShareToken(fromParam);
      } else if (window.location.hash?.startsWith('#share=')) {
        setShareToken(window.location.hash.replace('#share=', ''));
      }
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  // Subscribe to authentication
  useEffect(() => {
    const unsubscribe = subscribeToAuth((currentUser) => {
      setUser(currentUser);
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Load entries when user signs in
  useEffect(() => {
    if (user?.uid) {
      fetchUserEntries(user.uid)
        .then((loadedEntries) => {
          setEntries(loadedEntries);
          if (loadedEntries.length > 0) {
            setActiveEntry(loadedEntries[0]);
          } else {
            setActiveEntry(createNewEntry(user.uid));
          }
        })
        .catch((err) => {
          console.error('Failed to load user entries:', err);
          setActiveEntry(createNewEntry(user.uid));
        });
    } else {
      setEntries([]);
      setActiveEntry(null);
    }
  }, [user?.uid]);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    try {
      const loggedUser = await signInWithGoogle();
      setUser(loggedUser);
    } catch (err) {
      console.error('Sign in error:', err);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await logOut();
    setUser(null);
    setActiveView('editor');
  };

  const handleUpdateEntry = (updated: JournalEntry) => {
    setActiveEntry(updated);
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === updated.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updated;
        return next;
      }
      return [updated, ...prev];
    });
  };

  const handleNewEntry = () => {
    if (!user) return;
    const fresh = createNewEntry(user.uid);
    setActiveEntry(fresh);
    setActiveView('editor');
  };

  const handleSelectEntry = (entry: JournalEntry) => {
    setActiveEntry(entry);
    setActiveView('editor');
  };

  const handleDeleteEntry = async (entryId: string) => {
    if (!user) return;
    await deleteUserEntry(user.uid, entryId);
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    if (activeEntry?.id === entryId) {
      const remaining = entries.filter((e) => e.id !== entryId);
      if (remaining.length > 0) {
        setActiveEntry(remaining[0]);
      } else {
        setActiveEntry(createNewEntry(user.uid));
      }
    }
  };

  if (shareToken) {
    return (
      <SharedEntryView
        token={shareToken}
        onReturnToApp={() => {
          if (window.history.pushState) {
            window.history.pushState({}, document.title, window.location.pathname);
          }
          setShareToken(null);
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] text-stone-900 flex flex-col font-sans selection:bg-amber-200 selection:text-amber-900">
      {/* Top Navigation */}
      <Navbar
        user={user}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        activeView={activeView}
        onSelectView={setActiveView}
        entriesCount={entries.length}
      />

      {/* Cloud Firestore configuration notice (if running with client-side fallback) */}
      {!isFirebaseConfigured && (
        <div className="bg-amber-50 border-b border-amber-200/80 px-4 py-2 text-xs text-amber-900 flex items-center justify-between">
          <div className="max-w-6xl mx-auto w-full flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Info className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                <strong>Zero-Configuration Preview Mode:</strong> Storing reflections locally with user-isolated state. Connect your Firebase credentials in <code className="bg-amber-100 px-1 py-0.5 rounded">.env</code> anytime for live Cloud Firestore syncing.
              </span>
            </div>
            <button
              onClick={() => setIsSecurityModalOpen(true)}
              className="text-amber-950 underline hover:text-amber-800 whitespace-nowrap text-[11px] font-medium"
            >
              View Security Specs
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {isLoadingAuth ? (
          <div className="h-96 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-stone-300 border-t-amber-600 rounded-full animate-spin" />
          </div>
        ) : !user ? (
          <LandingPage onSignIn={handleSignIn} isLoading={isSigningIn} />
        ) : activeView === 'admin' && user.role === 'admin' ? (
          <AdminDashboard
            user={user}
            onRefreshEntries={() => {
              if (user?.uid) fetchUserEntries(user.uid).then(setEntries);
            }}
          />
        ) : activeView === 'trends' ? (
          <MoodTrendDashboard
            user={user}
            entries={entries}
            onSelectEntry={handleSelectEntry}
            onNewEntry={handleNewEntry}
          />
        ) : activeView === 'editor' && activeEntry ? (
          <JournalEditor
            user={user}
            currentEntry={activeEntry}
            onUpdateEntry={handleUpdateEntry}
            onNewEntry={handleNewEntry}
          />
        ) : (
          <EntryHistory
            entries={entries}
            onSelectEntry={handleSelectEntry}
            onDeleteEntry={handleDeleteEntry}
            onNewEntry={handleNewEntry}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-stone-200 bg-white py-6 mt-12 text-xs text-stone-500">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-serif font-medium text-stone-800">Reflection Journal</span>
            <span>•</span>
            <span>Encrypted in transit & at rest</span>
            <span>•</span>
            <span>Gemini 3.6 Flash</span>
          </div>

          <div className="flex items-center gap-4">
            <button
              id="btn-footer-security"
              onClick={() => setIsSecurityModalOpen(true)}
              className="inline-flex items-center gap-1.5 text-stone-600 hover:text-stone-900 font-medium transition"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Security Architecture & Threat Model
            </button>
          </div>
        </div>
      </footer>

      {/* Security Specs Drawer */}
      <SecurityDrawer
        isOpen={isSecurityModalOpen}
        onClose={() => setIsSecurityModalOpen(false)}
      />
    </div>
  );
}
