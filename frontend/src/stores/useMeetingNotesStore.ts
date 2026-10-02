import { create } from 'zustand';
import type { ActionItem, TranscriptLine } from '@/demo/meetings';

/**
 * Session state for /brain/meetings (#9): voice notes recorded during the demo
 * and the human decisions on drafts that were waiting for approval.
 * Not persisted — a refresh returns the demo to its starting story.
 */

export interface VoiceNote {
  id: string;
  ownerId: string;
  title: string;
  /** "Today · 21:14" — when it was recorded. */
  when: string;
  summary: string;
  transcript: TranscriptLine[];
  actions: ActionItem[];
}

export type Review = { status: 'approved' | 'rejected'; draft?: string; by: string };

interface MeetingNotesState {
  notes: VoiceNote[];
  /** Keyed by action item id. */
  reviews: Record<string, Review>;
  addNote: (note: VoiceNote) => void;
  review: (actionId: string, review: Review) => void;
}

export const useMeetingNotesStore = create<MeetingNotesState>((set) => ({
  notes: [],
  reviews: {},
  addNote: (note) => set((s) => ({ notes: [note, ...s.notes] })),
  review: (actionId, review) => set((s) => ({ reviews: { ...s.reviews, [actionId]: review } })),
}));
