import { api } from '@/lib/api';

/**
 * Meetings on the real backend (backend auth mode). Contract: backend/app/schemas/meeting.py.
 * Creating and deleting are Owner-only; reading follows the caller's visibility.
 */

export type MeetingStatus = 'pending' | 'transcribing' | 'extracting' | 'completed' | 'failed';

export interface MeetingSummary {
  id: string;
  title: string;
  recorded_at: string;
  duration_seconds?: number | null;
  audio_format?: string | null;
  status: MeetingStatus;
}

export interface MeetingSegment {
  speaker_label: string;
  start_time: number;
  end_time: number;
  text: string;
}

export interface MeetingTask {
  id: string;
  title: string;
  status: string;
  deadline?: string | null;
  owner_name?: string | null;
}

export interface MeetingDetail extends MeetingSummary {
  raw_transcript?: string | null;
  error_message?: string | null;
  segments: MeetingSegment[];
  extracted_tasks: MeetingTask[];
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  const { data } = await api.get<MeetingSummary[]>('/meetings');
  return data;
}

export async function getMeeting(id: string): Promise<MeetingDetail> {
  const { data } = await api.get<MeetingDetail>(`/meetings/${id}`);
  return data;
}

/** Transcribes and extracts on the server; resolves when the meeting is processed. */
export async function uploadAudio(file: File, title?: string): Promise<MeetingDetail> {
  const form = new FormData();
  form.append('file', file);
  if (title?.trim()) form.append('title', title.trim());
  const { data } = await api.post<MeetingDetail>('/meetings/audio', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 300_000,
  });
  return data;
}

export async function createFromText(title: string, transcript: string): Promise<MeetingDetail> {
  const { data } = await api.post<MeetingDetail>('/meetings/text', { title, transcript }, { timeout: 180_000 });
  return data;
}

export async function deleteMeeting(id: string): Promise<void> {
  await api.delete(`/meetings/${id}`);
}
