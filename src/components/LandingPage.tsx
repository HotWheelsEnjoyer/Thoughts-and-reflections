import React, { useState } from 'react';
import {
  Sparkles,
  Shield,
  Lock,
  History,
  MessageSquare,
  ArrowRight,
  Mail,
  CheckCircle2,
  KeyRound,
  Eye,
  EyeOff,
  AlertCircle,
  UserPlus,
  LogIn,
} from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => void;
  onDirectSignIn?: (email: string, password: string) => Promise<void>;
  onDirectSignUp?: (email: string, password: string, name?: string) => Promise<void>;
  isLoading: boolean;
  userEmailSuggestion?: string;
  errorMessage?: string | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({
  onSignIn,
  onDirectSignIn,
  onDirectSignUp,
  isLoading,
  userEmailSuggestion = '',
  errorMessage,
}) => {
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [authMode, setAuthMode] = useState<'signup' | 'signin'>('signup');
  const [emailInput, setEmailInput] = useState(userEmailSuggestion || '');
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [isSubmittingDirect, setIsSubmittingDirect] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!emailInput || !emailInput.includes('@')) {
      setLocalError('Please enter a valid email address.');
      return;
    }

    if (!passwordInput || passwordInput.length < 6) {
      setLocalError('Password must be at least 6 characters long.');
      return;
    }

    if (authMode === 'signup') {
      if (passwordInput !== confirmPasswordInput) {
        setLocalError('Passwords do not match. Please ensure both passwords match.');
        return;
      }
      if (!onDirectSignUp) return;

      setIsSubmittingDirect(true);
      try {
        await onDirectSignUp(emailInput, passwordInput, nameInput);
      } catch (err: any) {
        setLocalError(err.message || 'Failed to create account. Please try again.');
      } finally {
        setIsSubmittingDirect(false);
      }
    } else {
      if (!onDirectSignIn) return;

      setIsSubmittingDirect(true);
      try {
        await onDirectSignIn(emailInput, passwordInput);
      } catch (err: any) {
        setLocalError(err.message || 'Failed to sign in. Please verify your credentials or sign up first.');
      } finally {
        setIsSubmittingDirect(false);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 sm:py-16">
      {/* Hero Header */}
      <div className="text-center max-w-2xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium mb-6">
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>Mindful AI Reflection Companion</span>
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl font-normal text-stone-900 tracking-tight leading-tight mb-4">
          A calm, private space for mindful reflection.
        </h1>
        <p className="text-stone-600 text-base sm:text-lg leading-relaxed mb-8">
          Write freely, converse with an empathetic companion, explore fresh perspectives, and preserve your personal growth securely.
        </p>

        {/* Primary CTA Block */}
        <div className="max-w-md mx-auto space-y-4">
          {/* Google Sign In One-Click Override */}
          <button
            id="btn-landing-signin"
            onClick={onSignIn}
            disabled={isLoading || isSubmittingDirect}
            className="w-full inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-stone-900 hover:bg-stone-800 text-white font-medium text-base rounded-xl shadow-md transition disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Connecting to Google...
              </span>
            ) : (
              <>
                <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="currentColor"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="currentColor"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="currentColor"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google
                <ArrowRight className="w-4 h-4 text-stone-400" />
              </>
            )}
          </button>

          {/* Email Sign Up / Sign In Toggle */}
          <div className="text-center pt-1">
            <button
              id="btn-toggle-email-signin"
              onClick={() => {
                setShowEmailForm(!showEmailForm);
                setLocalError(null);
              }}
              className="text-xs text-stone-600 hover:text-stone-900 underline underline-offset-4 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>{showEmailForm ? 'Hide email authentication form' : 'Or sign up / sign in with email & password'}</span>
            </button>
          </div>

          {showEmailForm && (
            <div className="p-5 rounded-2xl bg-white border border-stone-200/80 shadow-sm text-left space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Mode Switcher Tabs */}
              <div className="flex rounded-xl bg-stone-100 p-1">
                <button
                  type="button"
                  id="tab-auth-signup"
                  onClick={() => {
                    setAuthMode('signup');
                    setLocalError(null);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authMode === 'signup'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  Sign Up (New Account)
                </button>
                <button
                  type="button"
                  id="tab-auth-signin"
                  onClick={() => {
                    setAuthMode('signin');
                    setLocalError(null);
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    authMode === 'signin'
                      ? 'bg-white text-stone-900 shadow-xs'
                      : 'text-stone-500 hover:text-stone-800'
                  }`}
                >
                  <LogIn className="w-3.5 h-3.5" />
                  Sign In
                </button>
              </div>

              <form onSubmit={handleAuthSubmit} className="space-y-3.5">
                {authMode === 'signup' && (
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-stone-700">Full Name</label>
                    <input
                      id="input-account-name"
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder="e.g. Alex Morgan"
                      className="w-full px-3.5 py-2 text-sm bg-stone-50 border border-stone-300 rounded-xl text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-stone-700">Account Email</label>
                  <input
                    id="input-account-email"
                    type="email"
                    required
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    placeholder="your.email@example.com"
                    className="w-full px-3.5 py-2 text-sm bg-stone-50 border border-stone-300 rounded-xl text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-semibold text-stone-700">Password</label>
                    <span className="text-[11px] text-stone-400">Min. 6 chars</span>
                  </div>
                  <div className="relative">
                    <input
                      id="input-account-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="w-full pl-3.5 pr-10 py-2 text-sm bg-stone-50 border border-stone-300 rounded-xl text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {authMode === 'signup' && (
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-stone-700">Confirm Password</label>
                    <input
                      id="input-account-confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={confirmPasswordInput}
                      onChange={(e) => setConfirmPasswordInput(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2 text-sm bg-stone-50 border border-stone-300 rounded-xl text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500"
                    />
                  </div>
                )}

                {localError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <div className="flex-1">
                      <span>{localError}</span>
                      {localError.includes('sign up first') && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('signup');
                            setLocalError(null);
                          }}
                          className="block mt-1 font-semibold text-rose-950 underline hover:no-underline cursor-pointer"
                        >
                          Switch to Sign Up &rarr;
                        </button>
                      )}
                      {localError.includes('already exists') && (
                        <button
                          type="button"
                          onClick={() => {
                            setAuthMode('signin');
                            setLocalError(null);
                          }}
                          className="block mt-1 font-semibold text-rose-950 underline hover:no-underline cursor-pointer"
                        >
                          Switch to Sign In &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <button
                  id="btn-submit-direct-auth"
                  type="submit"
                  disabled={isSubmittingDirect || !emailInput || !passwordInput}
                  className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-medium text-sm rounded-xl transition shadow-xs disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                >
                  {isSubmittingDirect ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      {authMode === 'signup' ? 'Creating Account...' : 'Signing In...'}
                    </>
                  ) : authMode === 'signup' ? (
                    <>
                      <UserPlus className="w-4 h-4" />
                      <span>Create Account & Sign In</span>
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" />
                      <span>Sign In</span>
                    </>
                  )}
                </button>

                <div className="text-center pt-1 text-xs text-stone-500">
                  {authMode === 'signup' ? (
                    <span>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('signin');
                          setLocalError(null);
                        }}
                        className="text-stone-900 font-semibold hover:underline cursor-pointer"
                      >
                        Sign In
                      </button>
                    </span>
                  ) : (
                    <span>
                      Don't have an account yet?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('signup');
                          setLocalError(null);
                        }}
                        className="text-amber-700 font-semibold hover:underline cursor-pointer"
                      >
                        Sign Up First
                      </button>
                    </span>
                  )}
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-stone-200">
        <div className="p-6 rounded-2xl bg-white border border-stone-200/80 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
            <MessageSquare className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-stone-900 text-base mb-1">Multi-Turn Reflections</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Have meaningful conversations with an AI coach. Ask for reframing, brainstorming, or deep inquiry across consecutive reflections.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-stone-200/80 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-stone-900 text-base mb-1">Private & Isolated Storage</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Your personal journal entries and emotional reflections are strictly accessible only by your authenticated Google account.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-stone-200/80 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center mb-4">
            <History className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-stone-900 text-base mb-1">Emotional Trends & Takeaways</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Gain clarity with automated executive takeaways, recurring themes, and longitudinal mood progression tracking over time.
          </p>
        </div>
      </div>

      {/* Privacy & Protection Assurance */}
      <div className="mt-12 p-5 rounded-2xl bg-stone-100/80 border border-stone-200 text-xs text-stone-600 flex items-start gap-3">
        <Shield className="w-5 h-5 text-stone-800 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-stone-900">Protected & Encrypted Environment</p>
          <p>
            Your thoughts remain strictly confidential. Reflections are encrypted in transit and at rest with owner-bound access control.
          </p>
        </div>
      </div>
    </div>
  );
};
