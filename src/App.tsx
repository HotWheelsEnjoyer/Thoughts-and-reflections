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
import { SharedEntryView } from './components/SharedEntryView';
import {
  subscribeToAuth,
  signInWithGoogle,
  signInWithDirectEmail,
  logOut,
  fetchUserEntries,
  deleteUserEntry,
} from './services/firebase';
import type { JournalEntry, UserProfile } from './types';

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
  const [signInError, setSignInError] = useState<string | null>(null);

  // Expiring Share Link Routing
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
    setSignInError(null);
    setIsSigningIn(true);
    try {
      const loggedUser = await signInWithGoogle();
      setUser(loggedUser);
    } catch (err: any) {
      console.error('Sign in error:', err);
      setSignInError(err.message || 'Failed to complete Google sign-in. Please try again or use direct email sign-in.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleDirectSignIn = async (email: string, name?: string) => {
    setSignInError(null);
    setIsSigningIn(true);
    try {
      const loggedUser = await signInWithDirectEmail(email, name);
      setUser(loggedUser);
    } catch (err: any) {
      console.error('Direct sign-in error:', err);
      setSignInError(err.message || 'Failed to sign in. Please check email and try again.');
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

      {signInError && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2.5 text-xs text-rose-800 flex items-center justify-between">
          <div className="max-w-6xl mx-auto w-full flex items-center justify-between gap-2">
            <span>{signInError}</span>
            <button
              onClick={() => setSignInError(null)}
              className="text-rose-950 font-semibold hover:underline"
            >
              Dismiss
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
          <LandingPage
            onSignIn={handleSignIn}
            onDirectSignIn={handleDirectSignIn}
            isLoading={isSigningIn}
            errorMessage={signInError}
          />
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
            <span>Private & Encrypted</span>
            <span>•</span>
            <span>Mindful AI Companion</span>
          </div>

          <div className="text-stone-400 text-[11px]">
            Personal reflective journal & mood intelligence
          </div>
        </div>
      </footer>
    </div>
  );
}
