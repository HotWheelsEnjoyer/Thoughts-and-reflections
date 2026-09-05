import React from 'react';
import { Sparkles, Shield, Lock, History, MessageSquare, ArrowRight, CheckCircle2 } from 'lucide-react';

interface LandingPageProps {
  onSignIn: () => void;
  isLoading: boolean;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSignIn, isLoading }) => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 sm:py-16">
      {/* Hero Header */}
      <div className="text-center max-w-2xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium mb-6">
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>Powered by Gemini 3.6 Flash & Cloud Firestore</span>
        </div>
        <h1 className="font-serif text-4xl sm:text-5xl font-normal text-stone-900 tracking-tight leading-tight mb-4">
          A calm, private space for multi-turn reflection.
        </h1>
        <p className="text-stone-600 text-base sm:text-lg leading-relaxed mb-8">
          Write freely, converse with an empathetic AI companion, explore different angles, and preserve your personal growth in an isolated Firestore vault.
        </p>

        {/* Primary CTA */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            id="btn-landing-signin"
            onClick={onSignIn}
            disabled={isLoading}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 px-6 py-3.5 bg-stone-900 hover:bg-stone-800 text-white font-medium text-base rounded-xl shadow-md transition disabled:opacity-50"
          >
            {isLoading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Signing In...
              </span>
            ) : (
              <>
                <svg className="w-5 h-5" viewBox="0 0 24 24">
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
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                Continue with Google Sign-In
                <ArrowRight className="w-4 h-4 text-stone-400" />
              </>
            )}
          </button>
        </div>
      </div>

      {/* Feature Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-stone-200">
        <div className="p-6 rounded-2xl bg-white border border-stone-200/80 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
            <MessageSquare className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-stone-900 text-base mb-1">Multi-Turn Reflections</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Have dynamic conversations with Gemini. Ask for reframing, brainstorming, or deep inquiry across consecutive prompts.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-stone-200/80 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center mb-4">
            <Lock className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-stone-900 text-base mb-1">User-Isolated Firestore</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Strict rule-level security checks ensure your entries reside solely under <code className="text-xs bg-stone-100 px-1 py-0.5 rounded">/users/{'{uid}'}/entries</code>. No cross-user exposure.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-white border border-stone-200/80 shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 flex items-center justify-center mb-4">
            <History className="w-5 h-5" />
          </div>
          <h3 className="font-semibold text-stone-900 text-base mb-1">Synthesis & History</h3>
          <p className="text-stone-600 text-sm leading-relaxed">
            Generate executive takeaways and emotional themes with Gemini 3.6 Flash. Browse and resume past journals anytime.
          </p>
        </div>
      </div>

      {/* Security Directives Verification Banner */}
      <div className="mt-12 p-5 rounded-2xl bg-stone-100/80 border border-stone-200 text-xs text-stone-600 flex items-start gap-3">
        <Shield className="w-5 h-5 text-stone-800 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-stone-900">Enterprise Security Standard Compliant</p>
          <p>
            Implements OWASP LLM01/LLM02 input validation, zero-insecure default rules (<code className="bg-stone-200/70 px-1 rounded">allow read, write: if false;</code>), zero client-exposed API keys, and automated 4-tier model fallback resilience.
          </p>
        </div>
      </div>
    </div>
  );
};
