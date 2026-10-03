'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiErrorMessage } from '@/lib/api';
import {
  MAX_ASSISTANT_NAME,
  MAX_COMPANY_CONTEXT,
  MAX_TONE,
  getCompany,
  updateCompany,
  type CompanySettings,
} from '@/lib/settingsApi';
import { cn } from '@/lib/utils';
import { Card } from '../atoms';
import { ErrorLine, Field, SuccessLine, Toggle, inputClass, textareaClass } from './fields';

interface Draft {
  assistantName: string;
  tone: string;
  context: string;
  /** Kept as strings so a field can be cleared while typing. */
  cadence: string;
  maxChases: string;
  threshold: number;
  autoSend: boolean;
}

const fromCompany = (c: CompanySettings): Draft => ({
  assistantName: c.persona_config.assistant_name,
  tone: c.persona_config.tone,
  context: c.persona_config.company_context,
  cadence: String(c.escalation_after_days),
  maxChases: String(c.max_chases),
  threshold: c.auto_approve_threshold,
  autoSend: c.auto_send_internal_followups,
});

const sameDraft = (a: Draft, b: Draft) =>
  a.assistantName === b.assistantName &&
  a.tone === b.tone &&
  a.context === b.context &&
  Number(a.cadence) === Number(b.cadence) &&
  Number(a.maxChases) === Number(b.maxChases) &&
  Math.abs(a.threshold - b.threshold) < 1e-9 &&
  a.autoSend === b.autoSend;

const inRange = (raw: string, min: number, max: number) => {
  const n = Number(raw);
  return raw.trim() !== '' && Number.isInteger(n) && n >= min && n <= max;
};

export function SentinelSettingsForm() {
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const c = await getCompany();
      setCompany(c);
      setDraft(fromCompany(c));
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Could not load the settings.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const errors = useMemo(() => {
    if (!draft) return {};
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!draft.assistantName.trim()) e.assistantName = 'Enter a name.';
    if (!draft.tone.trim()) e.tone = 'Enter a tone.';
    if (!inRange(draft.cadence, 1, 30)) e.cadence = 'Between 1 and 30 days.';
    if (!inRange(draft.maxChases, 1, 5)) e.maxChases = 'Between 1 and 5.';
    return e;
  }, [draft]);

  if (loadError) {
    return (
      <Card className="p-5 space-y-3">
        <ErrorLine message={loadError} />
        <button onClick={load} className="btn-ghost text-xs px-3 py-1.5">Try again</button>
      </Card>
    );
  }

  if (!company || !draft) {
    return (
      <Card className="p-6 flex items-center gap-2 text-sm text-warm-gray">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading settings…
      </Card>
    );
  }

  const dirty = !sameDraft(draft, fromCompany(company));
  const valid = Object.keys(errors).length === 0;

  const edit = (patch: Partial<Draft>) => {
    setDraft({ ...draft, ...patch });
    setSaved(false);
    setSaveError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty || !valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const next = await updateCompany({
        // The server replaces persona_config wholesale: merge into what was loaded so the glossary survives.
        persona_config: {
          ...company.persona_config,
          assistant_name: draft.assistantName.trim(),
          tone: draft.tone.trim(),
          company_context: draft.context,
        },
        escalation_after_days: Number(draft.cadence),
        max_chases: Number(draft.maxChases),
        auto_approve_threshold: Math.round(draft.threshold * 100) / 100,
        auto_send_internal_followups: draft.autoSend,
      });
      setCompany(next);
      setDraft(fromCompany(next));
      setSaved(true);
    } catch (err) {
      setSaveError(apiErrorMessage(err, 'Could not save the settings.'));
    } finally {
      setSaving(false);
    }
  };

  const pct = Math.round(draft.threshold * 100);

  return (
    <Card className="p-5 sm:p-6">
      <form onSubmit={save} className="space-y-5" noValidate>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="assistant-name" label="Assistant name" error={errors.assistantName}>
            <input
              id="assistant-name"
              value={draft.assistantName}
              maxLength={MAX_ASSISTANT_NAME}
              onChange={(e) => edit({ assistantName: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field id="tone" label="Tone" error={errors.tone} hint="For example: direct, friendly, formal.">
            <input
              id="tone"
              value={draft.tone}
              maxLength={MAX_TONE}
              onChange={(e) => edit({ tone: e.target.value })}
              className={inputClass}
            />
          </Field>
        </div>

        <Field
          id="company-context"
          label="Company context"
          hint="Background Sentinel uses to understand names, roles and terms in your messages."
          aside={
            <span className={cn('text-[11px] tabular-nums', draft.context.length >= MAX_COMPANY_CONTEXT ? 'text-rose-700' : 'text-ash-gray')}>
              {draft.context.length.toLocaleString('en-US')} / {MAX_COMPANY_CONTEXT.toLocaleString('en-US')}
            </span>
          }
        >
          <textarea
            id="company-context"
            rows={5}
            value={draft.context}
            maxLength={MAX_COMPANY_CONTEXT}
            onChange={(e) => edit({ context: e.target.value })}
            className={textareaClass}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="cadence" label="Reminder cadence" error={errors.cadence} hint="Days without an update before a reminder is sent, and the gap between reminders.">
            <div className="flex items-center gap-2">
              <input
                id="cadence"
                type="number"
                inputMode="numeric"
                min={1}
                max={30}
                value={draft.cadence}
                onChange={(e) => edit({ cadence: e.target.value })}
                className={cn(inputClass, 'w-24')}
              />
              <span className="text-sm text-warm-gray">days</span>
            </div>
          </Field>
          <Field id="max-chases" label="Reminders before handing back" error={errors.maxChases} hint="After this many reminders the task comes back to you.">
            <div className="flex items-center gap-2">
              <input
                id="max-chases"
                type="number"
                inputMode="numeric"
                min={1}
                max={5}
                value={draft.maxChases}
                onChange={(e) => edit({ maxChases: e.target.value })}
                className={cn(inputClass, 'w-24')}
              />
              <span className="text-sm text-warm-gray">reminders</span>
            </div>
          </Field>
        </div>

        <Field
          id="threshold"
          label="Auto-approve threshold"
          aside={<span className="text-xs font-medium text-ink-black tabular-nums">{pct}%</span>}
          hint="Extracted tasks at or above this confidence skip the approval queue. 1.0 = everything waits for approval."
        >
          <input
            id="threshold"
            type="range"
            min={0.5}
            max={1}
            step={0.05}
            value={draft.threshold}
            onChange={(e) => edit({ threshold: Number(e.target.value) })}
            className="w-full accent-cyan-signal"
          />
        </Field>

        <div className="flex items-start justify-between gap-4 rounded-cards border border-stone-border bg-white px-4 py-3">
          <div className="min-w-0">
            <label htmlFor="auto-send" className="text-sm text-ink-black">Send internal follow-ups without approval</label>
            <p className="text-[11px] text-warm-gray mt-0.5">Messages to people outside the company always wait for approval.</p>
          </div>
          <Toggle
            id="auto-send"
            label="Send internal follow-ups without approval"
            checked={draft.autoSend}
            onChange={(v) => edit({ autoSend: v })}
          />
        </div>

        <div className="pt-4 border-t border-stone-border flex flex-wrap items-center justify-end gap-3">
          <div className="mr-auto min-w-0">
            {saveError ? <ErrorLine message={saveError} /> : saved ? <SuccessLine message="Saved" /> : null}
          </div>
          <button
            type="submit"
            disabled={!dirty || !valid || saving}
            className="btn-cyan text-sm px-5 py-2 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </form>
    </Card>
  );
}
