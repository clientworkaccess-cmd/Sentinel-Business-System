'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '@/lib/api';
import { getMeeting, listMeetings, type MeetingDetail } from '@/lib/meetingsApi';
import type { ActionItem, TranscriptLine } from '@/demo/meetings';

/** A backend meeting in the shape the meetings layout renders. */
export interface LiveEntry {
  id: string;
  title: string;
  dateLabel: string;
  source: 'recording' | 'transcript';
  durationMin?: number;
  actions: ActionItem[];
  transcript: TranscriptLine[];
  status: MeetingDetail['status'];
  error?: string | null;
}

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const ACTION_STATUS: Record<string, ActionItem['status']> = {
  pending_approval: 'pending_approval',
  done: 'done',
  rejected: 'rejected',
};

export function toEntry(m: MeetingDetail): LiveEntry {
  const transcript: TranscriptLine[] = m.segments?.length
    ? m.segments.map((s) => ({ speaker: s.speaker_label, at: mmss(s.start_time), text: s.text }))
    : (m.raw_transcript ?? '')
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const said = line.match(/^([^:]{1,40}):\s*(.+)$/);
          return said ? { speaker: said[1], at: '', text: said[2] } : { speaker: '', at: '', text: line };
        });
  return {
    id: `live:${m.id}`,
    title: m.title,
    dateLabel: fmtWhen(m.recorded_at),
    source: m.audio_format && m.audio_format !== 'text' ? 'recording' : 'transcript',
    durationMin: m.duration_seconds ? Math.max(1, Math.round(m.duration_seconds / 60)) : undefined,
    actions: (m.extracted_tasks ?? []).map((t) => ({
      id: t.id,
      text: t.title,
      ownerId: '',
      ownerName: t.owner_name ?? undefined,
      due: t.deadline ?? undefined,
      status: ACTION_STATUS[t.status] ?? 'open',
    })),
    transcript,
    status: m.status,
    error: m.error_message,
  };
}

/**
 * Meetings from the API, each with its detail (for action counts and the
 * "needs approval" filter). Disabled in demo mode.
 */
export function useLiveMeetings(enabled: boolean) {
  const [entries, setEntries] = useState<LiveEntry[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const list = await listMeetings();
      const details = await Promise.all(list.slice(0, 50).map((m) => getMeeting(m.id).catch(() => ({ ...m, segments: [], extracted_tasks: [] }))));
      setEntries(details.map(toEntry));
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not load meetings.'));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { entries, loading, error, refresh, setEntries };
}
