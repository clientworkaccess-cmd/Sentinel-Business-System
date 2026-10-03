/**
 * ElevenLabs speech-to-text and text-to-speech. Server-only: reads
 * ELEVENLABS_API_KEY. Callers turn a thrown VoiceUnavailable into a 503 so the
 * browser can fall back to its own speech APIs.
 */

const API = 'https://api.elevenlabs.io/v1';

export class VoiceUnavailable extends Error {}

function key(): string {
  const k = process.env.ELEVENLABS_API_KEY;
  if (!k) throw new VoiceUnavailable('ELEVENLABS_API_KEY is not set');
  return k;
}

/** Scribe handles English/Urdu code-switching, which is how the team actually talks. */
export async function transcribe(audio: Blob, language?: string): Promise<{ text: string; language: string }> {
  const form = new FormData();
  form.append('file', audio, 'speech.webm');
  form.append('model_id', process.env.ELEVENLABS_STT_MODEL || 'scribe_v1');
  if (language && language !== 'auto') form.append('language_code', language);

  const res = await fetch(`${API}/speech-to-text`, {
    method: 'POST',
    headers: { 'xi-api-key': key() },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new VoiceUnavailable(`speech-to-text ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string; language_code?: string };
  return { text: (data.text ?? '').trim(), language: data.language_code ?? language ?? 'auto' };
}

const URDU_SCRIPT = /[؀-ۿ]/;
const ROMAN_URDU = /\b(hai|hain|kya|mein|aap|ka|ki|ke|nahi|haal)\b/i;

/**
 * The voice to speak with. ELEVENLABS_VOICE_ID is the one to set. The optional
 * ELEVENLABS_VOICE_ID_EN / _UR override it per language (Urdu or Roman Urdu text
 * uses _UR), for a multilingual setup.
 */
export function pickVoice(text: string, requested?: 'en' | 'ur'): string {
  const lang = requested ?? (URDU_SCRIPT.test(text) || ROMAN_URDU.test(text) ? 'ur' : 'en');
  const base = process.env.ELEVENLABS_VOICE_ID;
  const voice = lang === 'ur'
    ? process.env.ELEVENLABS_VOICE_ID_UR || base || process.env.ELEVENLABS_VOICE_ID_EN
    : process.env.ELEVENLABS_VOICE_ID_EN || base;
  if (!voice) throw new VoiceUnavailable('ELEVENLABS_VOICE_ID is not set');
  return voice;
}

export async function speak(text: string, voiceId: string): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_TTS_MODEL || 'eleven_multilingual_v2',
      voice_settings: { stability: 0.45, similarity_boost: 0.8 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok || !res.body) throw new VoiceUnavailable(`text-to-speech ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.body;
}
