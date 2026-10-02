/**
 * POST /api/brain/transcribe — multipart `audio` (+ optional `language`) → { text, language }.
 * 503 when voice is unavailable, so the browser falls back to Web Speech (#17).
 */
import { NextResponse } from 'next/server';
import { VoiceUnavailable, transcribe } from '@/lib/server/elevenlabs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 25 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data with an `audio` file.' }, { status: 400 });
  }
  const audio = form.get('audio');
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'Missing `audio` file.' }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Audio is larger than 25MB.' }, { status: 413 });
  }
  const language = typeof form.get('language') === 'string' ? (form.get('language') as string) : undefined;

  try {
    return NextResponse.json(await transcribe(audio, language));
  } catch (err) {
    console.error('[brain/transcribe]', (err as Error).message);
    const status = err instanceof VoiceUnavailable ? 503 : 502;
    return NextResponse.json({ error: 'Transcription is unavailable right now.' }, { status });
  }
}
