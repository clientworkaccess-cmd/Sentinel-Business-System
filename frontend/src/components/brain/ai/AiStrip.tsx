'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { AI_APPROVALS, AI_CLIENTS } from '@/demo/ai';
import { AiMark } from './parts';

/** Overview tile: one line on the AI tools connected to Sentinel. */
export function AiStrip() {
  const connected = AI_CLIENTS.filter((a) => a.connected);
  const lookups = connected.reduce((n, a) => n + a.lookupsToday, 0);
  return (
    <Link href="/brain/ai" className="stone-card px-4 py-3 flex flex-wrap items-center gap-3 hover:border-cyan-edge/50 transition group">
      <span className="flex -space-x-1.5">
        {connected.map((a) => <span key={a.id} className="ring-2 ring-stone-canvas rounded-md"><AiMark id={a.id} size="sm" /></span>)}
      </span>
      <p className="flex-1 min-w-[200px] text-sm text-ink-black">
        {connected.length} AI tools connected <span className="text-warm-gray">· {lookups} lookups today · {AI_APPROVALS.length} waiting for approval</span>
      </p>
      <ArrowRight className="w-4 h-4 text-warm-gray group-hover:text-ink-black group-hover:translate-x-0.5 transition" />
    </Link>
  );
}
