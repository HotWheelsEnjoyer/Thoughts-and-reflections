import React from 'react';
import { Sparkles, Shield, LogOut, UserCheck, TrendingUp } from 'lucide-react';
import type { UserProfile } from '../types';

interface NavbarProps {
  user: UserProfile | null;
  onSignIn: () => void;
  onSignOut: () => void;
  activeView: 'editor' | 'history' | 'trends' | 'admin';
  onSelectView: (view: 'editor' | 'history' | 'trends' | 'admin') => void;
  entriesCount: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  user,
  onSignIn,
  onSignOut,
  activeView,
  onSelectView,
  entriesCount,
}) => {
  return (
    <header className="sticky top-0 z-50 bg-stone-50/90 backdrop-blur-md border-b border-stone-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand identity */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-600 to-amber-500 flex items-center justify-center text-white shadow-sm">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <span className="font-serif font-semibold text-lg text-stone-900 tracking-tight">
              Thoughts and Reflections
            </span>
            <p className="text-xs text-stone-500">
              Mindful companion & insights
            </p>
          </div>
        </div>

        {/* Navigation & User actions */}
        <div className="flex items-center space-x-3">
          {user ? (
            <>
              {/* View Switcher */}
              <nav className="flex items-center bg-stone-200/70 p-1 rounded-xl text-xs font-medium text-stone-700 mr-2">
                <button
                  id="nav-editor-tab"
                  onClick={() => onSelectView('editor')}
                  className={`px-3 py-1.5 rounded-lg transition-all ${
                    activeView === 'editor'
                      ? 'bg-white text-stone-900 shadow-xs font-semibold'
                      : 'hover:text-stone-950'
                  }`}
                >
                  Write & Reflect
                </button>
                <button
                  id="nav-history-tab"
                  onClick={() => onSelectView('history')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                    activeView === 'history'
                      ? 'bg-white text-stone-900 shadow-xs font-semibold'
                      : 'hover:text-stone-950'
                  }`}
                >
                  History
                  {entriesCount > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-stone-200 text-stone-700 text-[10px]">
                      {entriesCount}
                    </span>
                  )}
                </button>
                <button
                  id="nav-trends-tab"
                  onClick={() => onSelectView('trends')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                    activeView === 'trends'
                      ? 'bg-white text-stone-900 shadow-xs font-semibold'
                      : 'hover:text-stone-950'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                  Mood Trends
                </button>
                {user.role === 'admin' && (
                  <button
                    id="nav-admin-tab"
                    onClick={() => onSelectView('admin')}
                    className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 ${
                      activeView === 'admin'
                        ? 'bg-amber-900 text-amber-50 shadow-xs font-semibold'
                        : 'text-amber-900/80 hover:text-amber-950 hover:bg-amber-100/60'
                    }`}
                  >
                    <Shield className="w-3 h-3 text-amber-600" />
                    Admin
                  </button>
                )}
              </nav>

              {/* User profile pill */}
              <div className="flex items-center space-x-2.5 bg-stone-100 border border-stone-200/80 rounded-full py-1 pl-1.5 pr-3">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    className="w-7 h-7 rounded-full object-cover border border-stone-300"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-amber-100 text-amber-800 font-semibold flex items-center justify-center text-xs">
                    {user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U'}
                  </div>
                )}
                <div className="text-left hidden sm:block">
                  <p className="text-xs font-medium text-stone-900 leading-tight">
                    {user.displayName || 'Authenticated User'}
                  </p>
                  <p className="text-[10px] text-stone-500 truncate max-w-[120px]">
                    {user.email || 'Isolated Session'}
                  </p>
                </div>
              </div>

              {/* Sign out button */}
              <button
                id="btn-signout"
                onClick={onSignOut}
                title="Sign Out"
                className="p-2 text-stone-500 hover:text-red-600 hover:bg-stone-200/50 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              id="btn-header-signin"
              onClick={onSignIn}
              className="inline-flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-sm font-medium rounded-xl shadow-xs transition"
            >
              <UserCheck className="w-4 h-4" />
              Sign In with Google
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
