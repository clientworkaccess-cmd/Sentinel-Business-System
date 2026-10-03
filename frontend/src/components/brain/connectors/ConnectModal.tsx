'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, Check, KeyRound, Loader2, Lock, RefreshCw, ShieldCheck, Sparkles, Unplug, X } from 'lucide-react';
import { BrandLockup } from '@/components/ui';
import { CATEGORY_LABELS, type Connector } from '@/demo/connectors';
import { ORG } from '@/demo/org';
import {
  LIVE_CONNECTORS,
  apiErrorMessage,
  disconnectLive,
  since,
  startConnect,
  syncNow,
  type LiveConnector,
} from '@/lib/connectorsApi';
import { useConnectorsStore } from '@/stores/useConnectorsStore';
import { cn } from '@/lib/utils';
import { ConnectorLogo } from './ConnectorLogo';

type Step = 'permissions' | 'authorizing' | 'redirecting' | 'apikey' | 'qr' | 'syncing' | 'done' | 'manage';

const fmt = (n: number) => n.toLocaleString('en-US');

/** The latest callback behind a stable ref, so a step's timer runs once however often the parent re-renders. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * The Connect Now flow.
 *
 * Demo mode (#10): simulated end to end — no credentials leave the page.
 * Backend mode (#33), for Gmail, Calendar, Drive, Docs and Slack: "Continue" asks the
 * API for Composio's consent URL and sends the browser there; Composio returns it to
 * /brain/connectors?result=… once the provider has granted access.
 */
export function ConnectModal({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const status = useConnectorsStore((s) => s.status[connector.id]);
  const lastSync = useConnectorsStore((s) => s.lastSync[connector.id]);
  const live = useConnectorsStore((s) => s.live?.[connector.id]);
  const { connect, disconnect } = useConnectorsStore();
  const isLive = LIVE_CONNECTORS && !!live;
  const [step, setStep] = useState<Step>(
    isLive ? (live.status === 'connected' || live.status === 'pending' ? 'manage' : 'permissions') : status === 'connected' ? 'manage' : 'permissions',
  );
  const dialog = useRef<HTMLDivElement>(null);

  // Esc closes; Tab stays inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return onClose();
      if (e.key !== 'Tab' || !dialog.current) return;
      const focusable = dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href]');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    dialog.current?.querySelector<HTMLElement>('button, input')?.focus();
  }, [step]);

  const begin = () =>
    setStep(isLive ? 'redirecting' : connector.auth === 'qr' ? 'qr' : connector.auth === 'api_key' ? 'apikey' : 'authorizing');

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-ink-black/40 backdrop-blur-[2px] animate-in fade-in duration-150" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-[71] flex items-center justify-center p-4 pointer-events-none">
        <div
          ref={dialog}
          role="dialog"
          aria-modal="true"
          aria-label={`Connect ${connector.name}`}
          className="pointer-events-auto w-full max-w-[460px] rounded-feature border border-stone-border bg-stone-canvas shadow-preview animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between px-5 pt-4">
            <span className="text-[11px] uppercase tracking-wider text-ash-gray">{CATEGORY_LABELS[connector.category]}</span>
            <button onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-full text-warm-gray hover:text-ink-black hover:bg-stone-border/40">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="px-5 pb-5 pt-2">
            {step === 'permissions' && <Permissions connector={connector} live={isLive ? live : undefined} onCancel={onClose} onContinue={begin} />}
            {step === 'authorizing' && <Authorizing connector={connector} onDone={() => setStep('syncing')} />}
            {step === 'redirecting' && <Redirecting connector={connector} onBack={() => setStep('permissions')} />}
            {step === 'apikey' && <ApiKey connector={connector} onDone={() => setStep('syncing')} />}
            {step === 'qr' && <Qr connector={connector} onDone={() => setStep('syncing')} />}
            {step === 'syncing' && <Syncing connector={connector} onDone={() => { connect(connector.id); setStep('done'); }} />}
            {step === 'done' && <Done connector={connector} onClose={onClose} />}
            {step === 'manage' && isLive && (
              <LiveManage connector={connector} live={live} onReconnect={() => setStep('redirecting')} onClose={onClose} />
            )}
            {step === 'manage' && !isLive && (
              <Manage
                connector={connector}
                lastSync={lastSync}
                onResync={() => setStep('syncing')}
                onDisconnect={() => { disconnect(connector.id); onClose(); }}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Handshake({ connector }: { connector: Connector }) {
  return (
    <div className="flex items-center justify-center gap-3 py-2">
      <ConnectorLogo connector={connector} size="lg" />
      <span className="flex items-center gap-1 text-ash-gray" aria-hidden="true">
        {[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-cyan-signal/60 animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />)}
      </span>
      <BrandLockup size="lg" />
    </div>
  );
}

function Permissions({
  connector,
  live,
  onCancel,
  onContinue,
}: {
  connector: Connector;
  live?: LiveConnector;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const reconnect = live?.status === 'needs_reconnect';
  const unavailable = live ? !live.available : false;
  const viaDrive = live && live.servedBy !== live.id;
  return (
    <div className="space-y-5">
      <Handshake connector={connector} />
      <div className="text-center">
        <h2 className="font-display text-[22px] text-ink-black">{reconnect ? 'Reconnect' : 'Connect'} {connector.name}</h2>
        <p className="text-sm text-warm-gray mt-1">{connector.description}</p>
      </div>
      {reconnect && (
        <p className="rounded-cards border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {live?.mine?.statusReason ?? `${connector.name} stopped accepting Sentinel's access. Sign in again to resume syncing.`}
        </p>
      )}
      {viaDrive && (
        <p className="text-xs text-warm-gray text-center">Google Docs are read through your Google Drive connection.</p>
      )}

      <div className="rounded-cards border border-stone-border bg-white p-4 space-y-3">
        <p className="text-xs font-medium text-ink-black">Sentinel will be able to</p>
        <ul className="space-y-2">
          {connector.scopes.map((s) => (
            <li key={s} className="flex gap-2 text-sm text-ink-black/90"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> {s}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {connector.syncs.map((s) => (
            <span key={s} className="text-[11px] px-2 py-0.5 rounded-full border border-stone-border text-warm-gray">{s}</span>
          ))}
        </div>
      </div>

      <div className="rounded-cards border border-stone-border bg-white p-4">
        <p className="text-xs font-medium text-ink-black flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5 text-cyan-edge" /> Who sees what syncs</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-ink-black">Owner</dt><dd className="text-warm-gray">Everything in {ORG.name}</dd>
          <dt className="text-ink-black">Admin</dt><dd className="text-warm-gray">Their team&apos;s items</dd>
          <dt className="text-ink-black">Member</dt><dd className="text-warm-gray">Only items they&apos;re part of</dd>
        </dl>
      </div>

      {unavailable && (
        <p className="text-xs text-warm-gray text-center">Live connections aren&apos;t switched on for this server yet.</p>
      )}
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-ghost flex-1 text-sm">Cancel</button>
        <button
          onClick={onContinue}
          disabled={unavailable}
          className="btn-cyan flex-1 text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
        >
          {connector.auth === 'oauth2' ? `Continue to ${connector.name}` : 'Continue'} <ArrowRight className="w-4 h-4" />
        </button>
      </div>
      {live && (
        <p className="text-[11px] text-ash-gray text-center flex items-center justify-center gap-1">
          <Lock className="w-3 h-3" /> Sentinel never sees or stores your password or tokens.
        </p>
      )}
    </div>
  );
}

/**
 * One consent request per attempt, however often the effect runs. Each request
 * replaces the previous Composio link, so a second one (StrictMode's double effect,
 * a double click) would strand the browser on a link the API no longer expects.
 */
const inflight = new Map<string, Promise<string>>();

/** Backend mode: fetch Composio's consent URL and leave for it. */
function Redirecting({ connector, onBack }: { connector: Connector; onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    const key = `${connector.id}:${attempt}`;
    if (!inflight.has(key)) {
      inflight.set(key, startConnect(connector.id));
      // Forget it once settled, so a later attempt (or reopening the dialog) asks again.
      inflight.get(key)!.finally(() => setTimeout(() => inflight.delete(key), 1000)).catch(() => {});
    }
    inflight.get(key)!
      .then((url) => { if (!cancelled) window.location.assign(url); })
      .catch((err) => { if (!cancelled) setError(apiErrorMessage(err, `Could not start the ${connector.name} sign-in.`)); });
    return () => { cancelled = true; };
  }, [connector.id, connector.name, attempt]);
  return (
    <div className="space-y-5 py-2">
      <Handshake connector={connector} />
      {error ? (
        <div className="space-y-4 text-center">
          <p className="text-sm text-rose-700 flex items-center justify-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {error}</p>
          <div className="flex gap-2">
            <button onClick={onBack} className="btn-ghost flex-1 text-sm">Back</button>
            <button onClick={() => setAttempt((n) => n + 1)} className="btn-cyan flex-1 text-sm">Try again</button>
          </div>
        </div>
      ) : (
        <div className="rounded-cards border border-stone-border bg-white p-5 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-signal" />
          <p className="text-sm text-ink-black">Opening the secure {connector.name} sign-in…</p>
        </div>
      )}
    </div>
  );
}

/** Backend mode: the person's real connection — account, freshness, counts, actions. */
function LiveManage({
  connector,
  live,
  onReconnect,
  onClose,
}: {
  connector: Connector;
  live: LiveConnector;
  onReconnect: () => void;
  onClose: () => void;
}) {
  const loadLive = useConnectorsStore((s) => s.loadLive);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'disconnect' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const mine = live.mine;
  const pending = live.status === 'pending';

  const run = async (kind: 'sync' | 'disconnect') => {
    setBusy(kind);
    setNote(null);
    try {
      if (kind === 'sync') {
        setNote(await syncNow(connector.id));
      } else {
        await disconnectLive(connector.id);
        await loadLive();
        onClose();
        return;
      }
      await loadLive();
    } catch (err) {
      setNote(apiErrorMessage(err, kind === 'sync' ? 'Could not start a sync.' : 'Could not disconnect.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 py-2">
      <div className="flex items-center gap-3">
        <ConnectorLogo connector={connector} size="lg" />
        <div className="min-w-0">
          <h2 className="font-display text-[22px] text-ink-black leading-tight">{connector.name}</h2>
          {pending ? (
            <p className="text-xs text-warm-gray flex items-center gap-1.5 mt-0.5"><Loader2 className="w-3 h-3 animate-spin" /> Waiting for the sign-in to finish</p>
          ) : (
            <p className="text-xs text-emerald-700 flex items-center gap-1.5 mt-0.5 truncate">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              {mine?.syncing
                ? 'Syncing now'
                : mine?.lastSyncedAt
                  ? `Connected · last synced ${since(mine.lastSyncedAt)}`
                  : 'Connected · first sync queued'}
              {mine?.accountLabel ? ` · ${mine.accountLabel}` : ''}
            </p>
          )}
        </div>
      </div>
      <div className="rounded-cards border border-stone-border bg-white p-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-warm-gray">Synced</p>
          <p className="font-display text-2xl text-ink-black tabular-nums">{fmt(mine?.itemCount ?? 0)}</p>
          <p className="text-[11px] text-ash-gray">{live.syncUnit}</p>
        </div>
        <div>
          <p className="text-[11px] text-warm-gray">Includes</p>
          <p className="text-sm text-ink-black mt-1">{connector.syncs.join(', ')}</p>
        </div>
      </div>
      {mine?.lastSyncError && (
        <p className="text-xs text-amber-900 rounded-cards border border-amber-200 bg-amber-50 px-3.5 py-2.5 flex gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {mine.lastSyncError}
        </p>
      )}
      {note && <p className="text-xs text-warm-gray text-center">{note}</p>}
      <div className="flex gap-2">
        {pending ? (
          <button onClick={onReconnect} className="btn-ghost flex-1 text-sm">Restart sign-in</button>
        ) : (
          <button
            onClick={() => run('sync')}
            disabled={busy !== null || mine?.syncing}
            className="btn-ghost flex-1 text-sm inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <RefreshCw className={cn('w-4 h-4', (busy === 'sync' || mine?.syncing) && 'animate-spin')} /> Sync now
          </button>
        )}
        <button
          onClick={() => (confirming ? run('disconnect') : setConfirming(true))}
          disabled={busy !== null}
          className={cn(
            'flex-1 text-sm rounded-full px-4 py-2 inline-flex items-center justify-center gap-1.5 border transition disabled:opacity-50',
            confirming ? 'bg-rose-50 border-rose-200 text-rose-700' : 'border-stone-border text-warm-gray hover:text-rose-700',
          )}
        >
          {busy === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />}
          {confirming ? 'Disconnect and remove its items' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

function Authorizing({ connector, onDone }: { connector: Connector; onDone: () => void }) {
  const done = useLatest(onDone);
  useEffect(() => {
    const t = setTimeout(() => done.current(), 1600);
    return () => clearTimeout(t);
  }, [done]);
  const host = `${connector.name.toLowerCase().replace(/[^a-z]/g, '')}.com`;
  return (
    <div className="space-y-5 py-2">
      <Handshake connector={connector} />
      {/* A stand-in for the provider's consent window — the real one opens in a popup (#11). */}
      <div className="rounded-cards border border-stone-border bg-white overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-border bg-stone-canvas text-[11px] text-warm-gray">
          <Lock className="w-3 h-3" /> accounts.{host}/oauth/authorize
        </div>
        <div className="p-5 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-cyan-signal" />
          <p className="text-sm text-ink-black">Waiting for {connector.name} to confirm access…</p>
        </div>
      </div>
    </div>
  );
}

function ApiKey({ connector, onDone }: { connector: Connector; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [checking, setChecking] = useState(false);
  const done = useLatest(onDone);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setChecking(true);
    setTimeout(() => done.current(), 1100);
  };
  return (
    <form onSubmit={submit} className="space-y-4 py-2">
      <Handshake connector={connector} />
      <div>
        <label htmlFor="apikey" className="text-xs font-medium text-ink-black flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> {connector.name} API key</label>
        <input
          id="apikey"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste a read-only key"
          autoComplete="off"
          className="mt-1.5 w-full h-11 px-3.5 rounded-inputs border border-stone-border bg-white text-sm font-mono text-ink-black placeholder:text-ash-gray placeholder:font-sans focus:outline-none focus:border-cyan-edge/70"
        />
        <p className="mt-1.5 text-[11px] text-ash-gray">
          Find it in {connector.name} → Settings → API. This demo never sends it anywhere.{' '}
          <button type="button" onClick={() => setKey(`demo_${connector.id}_read_only`)} className="text-cyan-edge hover:underline">Use a demo key</button>
        </p>
      </div>
      <button type="submit" disabled={key.trim().length < 8 || checking} className="btn-cyan w-full text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
        {checking ? <><Loader2 className="w-4 h-4 animate-spin" /> Checking key…</> : 'Connect'}
      </button>
    </form>
  );
}

/** A deterministic, QR-looking pattern. Decorative only: there is nothing to scan. */
function FakeQr({ seed }: { seed: string }) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const cells: boolean[] = [];
  for (let i = 0; i < 21 * 21; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    cells.push((h & 3) === 0 || (h & 7) === 5);
  }
  const finder = (x: number, y: number) =>
    [[0, 0], [14, 0], [0, 14]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
  const finderOn = (x: number, y: number) => {
    const [fx, fy] = [[0, 0], [14, 0], [0, 14]].find(([a, b]) => x >= a && x < a + 7 && y >= b && y < b + 7)!;
    const dx = x - fx, dy = y - fy;
    return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  return (
    <svg viewBox="0 0 21 21" className="w-40 h-40" shapeRendering="crispEdges" aria-label="Pairing code">
      <rect width="21" height="21" fill="#fff" />
      {cells.map((on, i) => {
        const x = i % 21, y = Math.floor(i / 21);
        const fill = finder(x, y) ? finderOn(x, y) : on;
        return fill ? <rect key={i} x={x} y={y} width="1" height="1" fill="#0c0a09" /> : null;
      })}
    </svg>
  );
}

function Qr({ connector, onDone }: { connector: Connector; onDone: () => void }) {
  const done = useLatest(onDone);
  useEffect(() => {
    const t = setTimeout(() => done.current(), 4500);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <div className="space-y-4 py-2 text-center">
      <h2 className="font-display text-[22px] text-ink-black">Link your business number</h2>
      <div className="inline-flex p-3 rounded-2xl border border-stone-border bg-white"><FakeQr seed={connector.id} /></div>
      <ol className="text-left text-sm text-warm-gray space-y-1 max-w-[300px] mx-auto list-decimal pl-5">
        <li>Open {connector.name} on your phone</li>
        <li>Settings → Linked devices → Link a device</li>
        <li>Point your phone at this code</li>
      </ol>
      <button onClick={onDone} className="btn-ghost text-sm">I&apos;ve scanned it</button>
    </div>
  );
}

function Syncing({ connector, onDone }: { connector: Connector; onDone: () => void }) {
  const total = connector.syncCount ?? 1000;
  const [n, setN] = useState(0);
  const finish = useLatest(onDone);
  useEffect(() => {
    const start = performance.now();
    const ms = 2400;
    let done = false;
    const tick = () => {
      if (done) return;
      const t = Math.min(1, (performance.now() - start) / ms);
      setN(Math.round(total * (1 - Math.pow(1 - t, 2))));
      if (t >= 1) { done = true; finish.current(); }
    };
    // setInterval, not rAF: a backgrounded tab must still finish the sync.
    const id = setInterval(tick, 60);
    return () => { done = true; clearInterval(id); };
  }, [total, finish]);
  const pct = Math.round((n / total) * 100);
  return (
    <div className="space-y-5 py-2">
      <Handshake connector={connector} />
      <div className="text-center">
        <h2 className="font-display text-[22px] text-ink-black">Syncing {connector.name}</h2>
        <p className="text-sm text-warm-gray mt-1 tabular-nums">
          {fmt(n)} of {fmt(total)} {connector.syncUnit} read and linked to people, clients and projects…
        </p>
      </div>
      <div className="h-2 rounded-full bg-stone-border/60 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-cyan-signal transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Done({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const router = useRouter();
  return (
    <div className="space-y-5 py-2 text-center">
      <span className="mx-auto w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
        <Check className="w-7 h-7 text-emerald-600" />
      </span>
      <div>
        <h2 className="font-display text-[22px] text-ink-black">{connector.name} is connected</h2>
        <p className="text-sm text-warm-gray mt-1">
          {fmt(connector.syncCount ?? 0)} {connector.syncUnit} are now part of {ORG.name}&apos;s memory. New ones sync every 5 minutes.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => router.push(`/brain/chat?q=${encodeURIComponent(`What's new from ${connector.name} this week?`)}`)}
          className="btn-ghost flex-1 text-sm inline-flex items-center justify-center gap-1.5"
        >
          <Sparkles className="w-4 h-4" /> Ask about it
        </button>
        <button onClick={onClose} className="btn-cyan flex-1 text-sm">Done</button>
      </div>
    </div>
  );
}

function Manage({ connector, lastSync, onResync, onDisconnect }: { connector: Connector; lastSync?: string; onResync: () => void; onDisconnect: () => void }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="space-y-5 py-2">
      <div className="flex items-center gap-3">
        <ConnectorLogo connector={connector} size="lg" />
        <div>
          <h2 className="font-display text-[22px] text-ink-black leading-tight">{connector.name}</h2>
          <p className="text-xs text-emerald-700 flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Connected · last synced {lastSync ?? 'recently'}
          </p>
        </div>
      </div>
      <div className="rounded-cards border border-stone-border bg-white p-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-warm-gray">Synced</p>
          <p className="font-display text-2xl text-ink-black tabular-nums">{fmt(connector.syncCount ?? 0)}</p>
          <p className="text-[11px] text-ash-gray">{connector.syncUnit}</p>
        </div>
        <div>
          <p className="text-[11px] text-warm-gray">Includes</p>
          <p className="text-sm text-ink-black mt-1">{connector.syncs.join(', ')}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onResync} className="btn-ghost flex-1 text-sm inline-flex items-center justify-center gap-1.5">
          <RefreshCw className="w-4 h-4" /> Sync now
        </button>
        <button
          onClick={() => (confirming ? onDisconnect() : setConfirming(true))}
          className={cn(
            'flex-1 text-sm rounded-full px-4 py-2 inline-flex items-center justify-center gap-1.5 border transition',
            confirming ? 'bg-rose-50 border-rose-200 text-rose-700' : 'border-stone-border text-warm-gray hover:text-rose-700',
          )}
        >
          <Unplug className="w-4 h-4" /> {confirming ? 'Click again to disconnect' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}
