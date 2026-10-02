/**
 * POST /api/brain/speak — { text, voice?: 'en' | 'ur' } → streamed audio/mpeg.
 * 503 when voice is unavailable, so the browser falls back to speechSynthesis (#17).
 */
import { NextResponse } from 'next/server';
import { VoiceUnavailable, pickVoice, speak } from '@/lib/server/elevenlabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CHARS = 2_000;

export async function POST(req: Request) {
  let body: { text?: unknown; voice?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: '`text` is required.' }, { status: 400 });
  if (text.length > MAX_CHARS) return NextResponse.json({ error: '`text` is longer than 2,000 characters.' }, { status: 413 });
  const voice = body.voice === 'en' || body.voice === 'ur' ? body.voice : undefined;

  try {
    const audio = await speak(text, pickVoice(text, voice));
    return new Response(audio, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[brain/speak]', (err as Error).message);
    const status = err instanceof VoiceUnavailable ? 503 : 502;
    return NextResponse.json({ error: 'Voice is unavailable right now.' }, { status });
  }
}
