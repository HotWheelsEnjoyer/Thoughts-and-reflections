import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import {
  TrendingUp,
  TrendingDown,
  Smile,
  ShieldCheck,
  Calendar,
  Sparkles,
  ArrowRight,
  Filter,
  Info,
  BookOpen,
  HeartHandshake,
} from 'lucide-react';
import type { JournalEntry, UserProfile, MoodLabel } from '../types';

interface MoodTrendDashboardProps {
  user: UserProfile;
  entries: JournalEntry[];
  onSelectEntry: (entry: JournalEntry) => void;
  onNewEntry: () => void;
}

export function getMoodBadgeColor(label?: string, score?: number) {
  if (score === undefined || score === null) {
    return {
      bg: 'bg-stone-100',
      text: 'text-stone-700',
      border: 'border-stone-200',
      fill: '#78716c',
      label: label || 'neutral',
    };
  }
  if (score >= 0.5) {
    return {
      bg: 'bg-emerald-50',
      text: 'text-emerald-800',
      border: 'border-emerald-200',
      fill: '#059669',
      label: label || 'Joyful / Motivated',
    };
  }
  if (score > 0) {
    return {
      bg: 'bg-teal-50',
      text: 'text-teal-800',
      border: 'border-teal-200',
      fill: '#0d9488',
      label: label || 'Peaceful / Reflective',
    };
  }
  if (score === 0) {
    return {
      bg: 'bg-stone-100',
      text: 'text-stone-800',
      border: 'border-stone-200',
      fill: '#78716c',
      label: label || 'Neutral Equilibrium',
    };
  }
  if (score >= -0.5) {
    return {
      bg: 'bg-amber-50',
      text: 'text-amber-900',
      border: 'border-amber-200',
      fill: '#d97706',
      label: label || 'Anxious / Frustrated',
    };
  }
  return {
    bg: 'bg-rose-50',
    text: 'text-rose-900',
    border: 'border-rose-200',
    fill: '#e11d48',
    label: label || 'Overwhelmed / Distressed',
  };
}

export const MoodTrendDashboard: React.FC<MoodTrendDashboardProps> = ({
  user,
  entries,
  onSelectEntry,
  onNewEntry,
}) => {
  const [timeframe, setTimeframe] = useState<'all' | '30d' | '7d'>('all');
  const [selectedTopic, setSelectedTopic] = useState<string>('All');

  // Strict Per-User Scoping (request.auth.uid == userId)
  // Ensures ONLY this authenticated user's entries are ever queried or aggregated.
  const userScoredEntries = useMemo(() => {
    const now = Date.now();
    return entries
      .filter((e) => e.userId === user.uid)
      .filter((e) => typeof e.moodScore === 'number' && !isNaN(e.moodScore))
      .filter((e) => {
        if (selectedTopic !== 'All' && e.topic !== selectedTopic) return false;
        if (timeframe === '7d') {
          return new Date(e.createdAt).getTime() >= now - 7 * 86400000;
        }
        if (timeframe === '30d') {
          return new Date(e.createdAt).getTime() >= now - 30 * 86400000;
        }
        return true;
      })
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [entries, user.uid, timeframe, selectedTopic]);

  // Transform data for Recharts
  const chartData = useMemo(() => {
    return userScoredEntries.map((e) => {
      const d = new Date(e.createdAt);
      return {
        entryId: e.id,
        rawEntry: e,
        title: e.title,
        dateStr: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        fullTime: d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        moodScore: e.moodScore,
        moodLabel: e.moodLabel || 'reflective',
        sentimentExplanation: e.sentimentExplanation || 'Balanced emotional observation.',
        topic: e.topic,
      };
    });
  }, [userScoredEntries]);

  // Aggregate stats strictly per-user
  const stats = useMemo(() => {
    if (userScoredEntries.length === 0) {
      return {
        avgScore: 0,
        dominantMood: 'None',
        totalScored: 0,
        momentum: 'neutral',
        peak: null,
        dip: null,
      };
    }

    const scores = userScoredEntries.map((e) => e.moodScore as number);
    const sum = scores.reduce((a, b) => a + b, 0);
    const avgScore = Math.round((sum / scores.length) * 100) / 100;

    // Dominant Mood calculation
    const counts: Record<string, number> = {};
    for (const e of userScoredEntries) {
      if (e.moodLabel) {
        counts[e.moodLabel] = (counts[e.moodLabel] || 0) + 1;
      }
    }
    let dominantMood = 'reflective';
    let maxCount = 0;
    for (const [label, count] of Object.entries(counts)) {
      if (count > maxCount) {
        maxCount = count;
        dominantMood = label;
      }
    }

    // Momentum: compare average of first half vs second half
    let momentum: 'improving' | 'declining' | 'steady' = 'steady';
    if (scores.length >= 2) {
      const mid = Math.floor(scores.length / 2);
      const firstHalfAvg = scores.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
      const secondHalfAvg = scores.slice(mid).reduce((a, b) => a + b, 0) / (scores.length - mid);
      if (secondHalfAvg - firstHalfAvg > 0.15) momentum = 'improving';
      else if (firstHalfAvg - secondHalfAvg > 0.15) momentum = 'declining';
    }

    // Peaks and Dips
    let peak = userScoredEntries[0];
    let dip = userScoredEntries[0];
    for (const e of userScoredEntries) {
      if ((e.moodScore || 0) > (peak.moodScore || 0)) peak = e;
      if ((e.moodScore || 0) < (dip.moodScore || 0)) dip = e;
    }

    return {
      avgScore,
      dominantMood,
      totalScored: userScoredEntries.length,
      momentum,
      peak,
      dip,
    };
  }, [userScoredEntries]);

  const topics = useMemo(() => {
    const list = Array.from(new Set(entries.filter((e) => e.userId === user.uid).map((e) => e.topic).filter(Boolean)));
    return ['All', ...list];
  }, [entries, user.uid]);

  // Custom Tooltip Component for Recharts
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const badge = getMoodBadgeColor(data.moodLabel, data.moodScore);

      return (
        <div className="bg-stone-900 text-white p-3.5 rounded-xl shadow-xl border border-stone-800 text-xs max-w-xs pointer-events-none">
          <div className="flex items-center justify-between gap-2 mb-1.5 opacity-75 text-[10px]">
            <span>{data.fullTime}</span>
            <span className="font-medium bg-stone-800 px-1.5 py-0.5 rounded">{data.topic}</span>
          </div>
          <div className="font-serif font-semibold text-sm text-stone-100 mb-2 leading-snug">
            {data.title}
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase tracking-wider ${badge.bg} ${badge.text}`}
            >
              {data.moodLabel}
            </span>
            <span className="font-mono text-stone-300 font-bold">
              {data.moodScore > 0 ? `+${data.moodScore.toFixed(2)}` : data.moodScore.toFixed(2)}
            </span>
          </div>
          <p className="text-stone-300 italic text-[11px] leading-relaxed border-t border-stone-800 pt-1.5">
            "{data.sentimentExplanation}"
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-stone-900">
              Personal Mood & Sentiment Trends
            </h2>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-medium">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Per-User Scoped
            </span>
          </div>
          <p className="text-stone-500 text-sm mt-1">
            Structured sentiment metadata derived by Gemini 3.6 Flash from your reflections, strictly isolated to your account.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Timeframe selector */}
          <div className="bg-stone-200/70 p-1 rounded-xl flex items-center text-xs font-medium text-stone-700">
            <button
              onClick={() => setTimeframe('all')}
              className={`px-3 py-1.5 rounded-lg transition ${
                timeframe === 'all' ? 'bg-white text-stone-900 shadow-xs font-semibold' : 'hover:text-stone-950'
              }`}
            >
              All Time
            </button>
            <button
              onClick={() => setTimeframe('30d')}
              className={`px-3 py-1.5 rounded-lg transition ${
                timeframe === '30d' ? 'bg-white text-stone-900 shadow-xs font-semibold' : 'hover:text-stone-950'
              }`}
            >
              Past 30 Days
            </button>
            <button
              onClick={() => setTimeframe('7d')}
              className={`px-3 py-1.5 rounded-lg transition ${
                timeframe === '7d' ? 'bg-white text-stone-900 shadow-xs font-semibold' : 'hover:text-stone-950'
              }`}
            >
              Past 7 Days
            </button>
          </div>

          <button
            id="btn-trend-new-reflection"
            onClick={onNewEntry}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Write Entry</span>
          </button>
        </div>
      </div>

      {/* Privacy and Isolation Notice */}
      <div className="mb-6 p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2.5">
        <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="flex-1 leading-relaxed">
          <strong>Privacy & Isolation Guarantee:</strong> Sentiment metadata is analyzed and strictly scoped to your private authenticated profile. No cross-user aggregates, shared leaderboards, or public metrics are ever generated.
        </div>
      </div>

      {/* High-Level Analytical KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-stone-500 font-medium">Average Valence</div>
          <div className="text-2xl font-bold text-stone-900 mt-1 flex items-baseline gap-1.5 font-mono">
            {stats.avgScore > 0 ? `+${stats.avgScore.toFixed(2)}` : stats.avgScore.toFixed(2)}
            <span className="text-xs font-sans text-stone-500 font-normal">/ ±1.0</span>
          </div>
          <div className="text-[11px] text-stone-500 mt-1 capitalize">
            {stats.avgScore >= 0.3 ? 'Prominently positive' : stats.avgScore <= -0.3 ? 'Processing challenges' : 'Balanced equilibrium'}
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-stone-500 font-medium">Dominant Emotional Tone</div>
          <div className="text-xl font-bold text-stone-900 mt-1 capitalize truncate">
            {stats.dominantMood}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Across {stats.totalScored} recorded reflections
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-stone-500 font-medium">Emotional Momentum</div>
          <div className="text-xl font-bold text-stone-900 mt-1 flex items-center gap-1.5 capitalize">
            {stats.momentum === 'improving' ? (
              <>
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span className="text-emerald-700">Uplifting</span>
              </>
            ) : stats.momentum === 'declining' ? (
              <>
                <TrendingDown className="w-4 h-4 text-amber-600" />
                <span className="text-amber-800">Tender / Gentle</span>
              </>
            ) : (
              <>
                <Smile className="w-4 h-4 text-stone-500" />
                <span className="text-stone-700">Steady</span>
              </>
            )}
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Trajectory over recent entries
          </div>
        </div>

        <div className="bg-white border border-stone-200 rounded-2xl p-4 shadow-xs">
          <div className="text-xs text-stone-500 font-medium">Active Topic Filter</div>
          <div className="mt-1">
            <select
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 text-stone-800 rounded-lg text-xs py-1.5 px-2 focus:outline-hidden focus:border-stone-400 font-medium"
            >
              {topics.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-stone-500 mt-1">
            Filter trend timeline
          </div>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div>
            <h3 className="font-serif text-lg font-semibold text-stone-900">
              Emotional Valence Timeline
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Visualizes progression from distress (-1.0) to joyful flourishing (+1.0)
            </p>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5 text-emerald-800">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <span>Positive (+0.1 to +1.0)</span>
            </div>
            <div className="flex items-center gap-1.5 text-stone-500">
              <span className="w-2.5 h-0.5 bg-stone-400" />
              <span>Neutral (0.0)</span>
            </div>
            <div className="flex items-center gap-1.5 text-rose-800">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>Challenging (-0.1 to -1.0)</span>
            </div>
          </div>
        </div>

        {chartData.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center p-6 bg-stone-50 rounded-xl border border-dashed border-stone-200">
            <Sparkles className="w-8 h-8 text-amber-600 mb-2" />
            <div className="font-serif font-medium text-stone-800 text-sm">
              No sentiment data available for this view
            </div>
            <p className="text-xs text-stone-500 max-w-sm mt-1 mb-4">
              Write a reflection entry with Gemini to begin tracking your personal emotional valence timeline.
            </p>
            <button
              onClick={onNewEntry}
              className="px-4 py-2 bg-stone-900 text-white rounded-xl text-xs font-medium hover:bg-stone-800 transition"
            >
              Start First Reflection
            </button>
          </div>
        ) : (
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorMood" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                    <stop offset="50%" stopColor="#d97706" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#e11d48" stopOpacity={0.25} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e7e5e4" />

                <XAxis
                  dataKey="dateStr"
                  tick={{ fontSize: 11, fill: '#78716c' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e7e5e4' }}
                />

                <YAxis
                  domain={[-1, 1]}
                  ticks={[-1, -0.5, 0, 0.5, 1]}
                  tick={{ fontSize: 11, fill: '#78716c', fontFamily: 'monospace' }}
                  tickLine={false}
                  axisLine={{ stroke: '#e7e5e4' }}
                  tickFormatter={(val) => (val > 0 ? `+${val}` : `${val}`)}
                />

                <Tooltip content={<CustomTooltip />} />

                {/* Zero line indicates neutral contemplative balance */}
                <ReferenceLine
                  y={0}
                  stroke="#a8a29e"
                  strokeDasharray="4 4"
                  label={{
                    value: 'Neutral Equilibrium (0.0)',
                    position: 'insideBottomRight',
                    fill: '#78716c',
                    fontSize: 10,
                  }}
                />

                <Area
                  type="monotone"
                  dataKey="moodScore"
                  stroke="#059669"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorMood)"
                  activeDot={{
                    r: 6,
                    stroke: '#059669',
                    strokeWidth: 2,
                    fill: '#ffffff',
                  }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Chronological Journal Entries & Sentiment Breakdown List */}
      <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-serif text-lg font-semibold text-stone-900">
              Scored Reflection Entries
            </h3>
            <p className="text-xs text-stone-500">
              Click any entry to view or continue your reflection conversation
            </p>
          </div>
          <span className="text-xs font-medium text-stone-400">
            {userScoredEntries.length} entries
          </span>
        </div>

        <div className="divide-y divide-stone-100">
          {userScoredEntries.length === 0 ? (
            <div className="py-8 text-center text-xs text-stone-400">
              No entries found matching current filter.
            </div>
          ) : (
            [...userScoredEntries].reverse().map((entry) => {
              const badge = getMoodBadgeColor(entry.moodLabel, entry.moodScore);
              const scoreFormatted =
                (entry.moodScore || 0) > 0
                  ? `+${(entry.moodScore || 0).toFixed(2)}`
                  : (entry.moodScore || 0).toFixed(2);

              return (
                <div
                  key={entry.id}
                  onClick={() => onSelectEntry(entry)}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-stone-50/80 px-3 rounded-xl transition cursor-pointer group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-medium text-stone-500">
                        {new Date(entry.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      <span>•</span>
                      <span className="text-[11px] text-stone-500 bg-stone-100 px-2 py-0.5 rounded-full">
                        {entry.topic}
                      </span>
                    </div>

                    <h4 className="font-medium text-sm text-stone-900 group-hover:text-amber-800 transition truncate">
                      {entry.title}
                    </h4>

                    {entry.sentimentExplanation && (
                      <p className="text-xs text-stone-600 mt-1 line-clamp-1 italic">
                        "{entry.sentimentExplanation}"
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {entry.moodLabel}
                      </span>
                      <span className="font-mono text-xs font-bold text-stone-700 bg-stone-100 px-2 py-1 rounded-md">
                        {scoreFormatted}
                      </span>
                    </div>

                    <ArrowRight className="w-4 h-4 text-stone-400 group-hover:text-stone-700 group-hover:translate-x-0.5 transition" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
