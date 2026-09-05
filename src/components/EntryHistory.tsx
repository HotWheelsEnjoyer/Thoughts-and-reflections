import React, { useState } from 'react';
import {
  Calendar,
  MessageSquare,
  Sparkles,
  Trash2,
  Search,
  ArrowRight,
  BookOpen,
  Filter,
  MapPin,
} from 'lucide-react';
import type { JournalEntry } from '../types';

interface EntryHistoryProps {
  entries: JournalEntry[];
  onSelectEntry: (entry: JournalEntry) => void;
  onDeleteEntry: (entryId: string) => void;
  onNewEntry: () => void;
}

export const EntryHistory: React.FC<EntryHistoryProps> = ({
  entries,
  onSelectEntry,
  onDeleteEntry,
  onNewEntry,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTopic, setSelectedTopic] = useState<string>('All');

  const topics = ['All', ...Array.from(new Set(entries.map((e) => e.topic).filter(Boolean)))];

  const filteredEntries = entries.filter((entry) => {
    const matchesSearch =
      entry.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (entry.summary && entry.summary.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (entry.location?.name && entry.location.name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      entry.turns.some((t) => t.content.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesTopic = selectedTopic === 'All' || entry.topic === selectedTopic;
    return matchesSearch && matchesTopic;
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-stone-900">
            Reflection History
          </h2>
          <p className="text-stone-500 text-sm mt-0.5">
            Your private, user-isolated entries stored securely in Cloud Firestore
          </p>
        </div>

        <button
          id="btn-history-new-entry"
          onClick={onNewEntry}
          className="inline-flex items-center gap-2 px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white text-xs font-medium rounded-xl shadow-xs transition"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Write New Reflection
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            id="search-entries-input"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search entries, keywords, or topics..."
            className="w-full pl-10 pr-4 py-2 bg-white border border-stone-200 rounded-xl text-xs text-stone-800 placeholder:text-stone-400 focus:outline-hidden focus:border-stone-400"
          />
        </div>

        {topics.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <Filter className="w-3.5 h-3.5 text-stone-400 mr-1 shrink-0" />
            {topics.map((t) => (
              <button
                key={t}
                onClick={() => setSelectedTopic(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                  selectedTopic === t
                    ? 'bg-stone-900 text-white'
                    : 'bg-white border border-stone-200 text-stone-600 hover:bg-stone-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Entry Cards List */}
      {filteredEntries.length === 0 ? (
        <div className="bg-white border border-dashed border-stone-200 rounded-2xl p-10 text-center">
          <BookOpen className="w-10 h-10 text-stone-300 mx-auto mb-3" />
          <h3 className="font-serif text-lg font-medium text-stone-800 mb-1">
            {entries.length === 0 ? 'No reflections saved yet' : 'No matching entries found'}
          </h3>
          <p className="text-stone-500 text-sm max-w-md mx-auto mb-6">
            {entries.length === 0
              ? 'Start your first multi-turn journaling session with Gemini to generate reflections and insights.'
              : 'Try adjusting your search query or topic filter to locate past reflections.'}
          </p>
          {entries.length === 0 && (
            <button
              id="btn-empty-start"
              onClick={onNewEntry}
              className="inline-flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-xs font-medium rounded-xl hover:bg-stone-800 transition"
            >
              Start Journaling
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredEntries.map((entry) => (
            <div
              key={entry.id}
              className="bg-white border border-stone-200 rounded-2xl p-5 hover:border-stone-300 transition shadow-xs group"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex-1 cursor-pointer" onClick={() => onSelectEntry(entry)}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-stone-100 text-stone-700 text-[11px] font-medium">
                      {entry.topic || 'Personal Growth'}
                    </span>
                    <span className="text-stone-300">•</span>
                    <span className="flex items-center gap-1 text-xs text-stone-400">
                      <Calendar className="w-3 h-3" />
                      {new Date(entry.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="text-stone-300">•</span>
                    <span className="flex items-center gap-1 text-xs text-stone-400">
                      <MessageSquare className="w-3 h-3" />
                      {entry.turns.length} turn{entry.turns.length === 1 ? '' : 's'}
                    </span>
                    {entry.location && (
                      <>
                        <span className="text-stone-300">•</span>
                        <span
                          className="flex items-center gap-1 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-md font-medium"
                          title={`Approx. coordinates: ${entry.location.lat}, ${entry.location.lng}`}
                        >
                          <MapPin className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {entry.location.name || `${entry.location.lat.toFixed(2)}°, ${entry.location.lng.toFixed(2)}°`}
                          </span>
                        </span>
                      </>
                    )}
                  </div>

                  <h3 className="font-serif text-lg font-semibold text-stone-900 group-hover:text-amber-800 transition">
                    {entry.title || 'Untitled Reflection'}
                  </h3>

                  {/* Summary preview */}
                  {entry.summary ? (
                    <div className="mt-2.5 p-3 rounded-xl bg-amber-50/60 border border-amber-100 text-xs text-stone-700 line-clamp-3">
                      <div className="flex items-center gap-1 text-amber-800 font-semibold mb-1 text-[11px]">
                        <Sparkles className="w-3 h-3" />
                        <span>Gemini Synthesis</span>
                      </div>
                      <p>{entry.summary}</p>
                    </div>
                  ) : (
                    entry.turns.length > 0 && (
                      <p className="mt-2 text-xs text-stone-500 line-clamp-2">
                        {entry.turns[0].content}
                      </p>
                    )
                  )}
                </div>

                <div className="flex items-center gap-2 self-end sm:self-start">
                  <button
                    id={`btn-open-entry-${entry.id}`}
                    onClick={() => onSelectEntry(entry)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-medium rounded-lg transition"
                  >
                    <span>Continue</span>
                    <ArrowRight className="w-3 h-3 text-stone-500" />
                  </button>

                  <button
                    id={`btn-delete-entry-${entry.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Are you sure you want to delete this reflection?')) {
                        onDeleteEntry(entry.id);
                      }
                    }}
                    className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                    title="Delete Entry"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
