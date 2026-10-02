import {
  Building2, CheckCircle2, FileText, FolderKanban, Gavel, MessagesSquare, Video,
  type LucideIcon,
} from 'lucide-react';
import type { ItemKind, ItemStatus } from '@/demo/types';

export const KIND_META: Record<ItemKind, { label: string; plural: string; icon: LucideIcon }> = {
  project: { label: 'Project', plural: 'Projects', icon: FolderKanban },
  client: { label: 'Client', plural: 'Clients', icon: Building2 },
  meeting: { label: 'Meeting', plural: 'Meetings', icon: Video },
  document: { label: 'Doc', plural: 'Docs', icon: FileText },
  task: { label: 'Task', plural: 'Tasks', icon: CheckCircle2 },
  decision: { label: 'Decision', plural: 'Decisions', icon: Gavel },
  thread: { label: 'Thread', plural: 'Threads', icon: MessagesSquare },
};

/** Tailwind classes per status. The `.dark` overrides in globals.css retint these. */
export const STATUS_META: Record<ItemStatus, { label: string; className: string }> = {
  on_track: { label: 'On track', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  at_risk: { label: 'At risk', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  blocked: { label: 'Blocked', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  done: { label: 'Done', className: 'bg-stone-100 text-stone-600 border-stone-border' },
  pending_approval: { label: 'Needs approval', className: 'bg-sky-50 text-sky-700 border-sky-200' },
};

/** Display names for connector ids that appear as item sources in the demo data. */
export const SOURCE_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  google_docs: 'Google Docs',
  google_drive: 'Google Drive',
  google_calendar: 'Google Calendar',
  google_meet: 'Google Meet',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  zoom: 'Zoom',
  fireflies: 'Fireflies',
  otter: 'Otter',
  fathom: 'Fathom',
  granola: 'Granola',
  voice_note: 'Voice note',
  jira: 'Jira',
  linear: 'Linear',
  clickup: 'ClickUp',
  notion: 'Notion',
  github: 'GitHub',
  figma: 'Figma',
  hubspot: 'HubSpot',
  quickbooks: 'QuickBooks',
};

export const sourceLabel = (id?: string) => (id ? SOURCE_LABELS[id] ?? id : 'Sentinel');

/**
 * Department colour from its hue. Saturation/lightness are fixed so every
 * department reads at the same weight; only the hue tells them apart.
 */
export const hueColor = (hue: number, alpha = 1) => `hsl(${hue} 72% 52% / ${alpha})`;

/** The owner sits above departments, so they wear the brand accent instead of a hue. */
export const OWNER_COLOR = '#3ba6f1';

export function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
