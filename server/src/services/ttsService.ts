import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

export type TtsVoiceKey = 'female' | 'male';

const VOICE_MAP: Record<TtsVoiceKey, string> = {
  female: 'pt-BR-FranciscaNeural',
  male: 'pt-BR-AntonioNeural',
};

const VALID_NEURAL_VOICE_REGEX = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9]+Neural$/;
const MAX_CACHE_ENTRIES = 150;
const MAX_TEXT_LENGTH = 600;

const lruCache = new Map<string, Buffer>();
const inFlight = new Map<string, Promise<Buffer>>();

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getFromLru(key: string): Buffer | undefined {
  const hit = lruCache.get(key);
  if (!hit) return undefined;
  lruCache.delete(key);
  lruCache.set(key, hit);
  return hit;
}

function setInLru(key: string, audio: Buffer): void {
  if (lruCache.has(key)) {
    lruCache.delete(key);
  } else if (lruCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = lruCache.keys().next().value;
    if (oldestKey !== undefined) {
      lruCache.delete(oldestKey);
    }
  }
  lruCache.set(key, audio);
}

async function synthesizeWithEdgeTts(text: string, voiceName: string): Promise<Buffer> {
  const tts = new MsEdgeTTS({
    connectionTimeoutMs: 10000,
    synthesisTimeoutMs: 15000,
  });

  try {
    await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapeXml(text));

    const chunks: Buffer[] = [];
    for await (const chunk of audioStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    const buffer = Buffer.concat(chunks);
    if (buffer.length === 0) {
      throw new Error('Áudio retornado vazio pelo serviço TTS.');
    }
    return buffer;
  } finally {
    try {
      tts.close();
    } catch {
      // Ignora erro ao encerrar socket
    }
  }
}

export async function generateNeuralTts(
  rawText: string,
  voice: TtsVoiceKey = 'female',
  customVoiceName?: string
): Promise<Buffer> {
  const cleaned = rawText.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
  if (!cleaned) {
    throw new Error('EMPTY_TEXT');
  }

  const voiceKey: TtsVoiceKey = voice === 'male' ? 'male' : 'female';
  const resolvedVoiceName =
    customVoiceName && VALID_NEURAL_VOICE_REGEX.test(customVoiceName.trim())
      ? customVoiceName.trim()
      : VOICE_MAP[voiceKey];

  const cacheKey = `${resolvedVoiceName}:${cleaned}`;

  const cached = getFromLru(cacheKey);
  if (cached) return cached;

  const existingPromise = inFlight.get(cacheKey);
  if (existingPromise) return existingPromise;

  const task = synthesizeWithEdgeTts(cleaned, resolvedVoiceName)
    .then((buffer) => {
      setInLru(cacheKey, buffer);
      return buffer;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, task);
  return task;
}
