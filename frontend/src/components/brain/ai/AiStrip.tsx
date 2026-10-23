'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AI_APPROVALS, AI_CLIENTS, PROMPTS_SAVED_TODAY } from '@/demo/ai';
import { AiMark } from './parts';

/** Overview tile: the memory at work inside the AIs the team already uses. */
export function AiStrip() {
  const connected = AI_CLIENTS.filter((a) => a.connected);
  const lookups = connected.reduce((n, a) => n + a.lookupsToday, 0);
  return (
    <Link href="/brain/ai" className="stone-card p-4 flex flex-wrap items-center gap-4 hover:border-cyan-edge/50 transition group">
      <span className="flex -space-x-1.5">
        {connected.map((a) => <span key={a.id} className="ring-2 ring-stone-canvas rounded-lg"><AiMark id={a.id} size="sm" /></span>)}
      </span>
      <p className="flex-1 min-w-[220px] text-sm text-ink-black">
        <span className="font-semibold">{connected.length} AIs use Sentinel&apos;s memory</span>
        <span className="text-warm-gray"> · {lookups} lookups today · {AI_APPROVALS.length} waiting for approval · {PROMPTS_SAVED_TODAY} went straight out</span>
      </p>
      <span className="text-xs text-cyan-signal inline-flex items-center gap-1">AI &amp; Agents <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition" /></span>
    </Link>
  );
}
