import { buildTtsUrl, type DubVoiceKey } from './playerApi';

const DUCK_TARGET_VOLUME = 0.22;
const DUCK_RESTORE_DELAY_MS = 350;
const DUCK_RAMP_MS = 140;
const MIN_RATE = 1.0;
const MAX_RATE = 1.35;
const PREFETCH_AHEAD = 2;
const MAX_LOCAL_BLOBS = 120;

export interface DubCueItem {
  startTime: number;
  endTime: number;
  text: string;
}

export function cleanCueText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\\[^}]+\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface NeuralDubbingOptions {
  video?: HTMLVideoElement | null;
  getUserVolume?: () => number;
  isPaused?: () => boolean;
  voice: DubVoiceKey;
  voiceName?: string;
  dubVolume: number;
}

export class NeuralDubbingController {
  private video: HTMLVideoElement | null;
  private getUserVolume: () => number;
  private isPausedCheck: () => boolean;
  private voice: DubVoiceKey;
  private voiceName?: string;
  private dubVolume: number;

  private blobCache = new Map<string, string>();
  private pendingFetches = new Map<string, Promise<string | null>>();
  private activeAudio: HTMLAudioElement | null = null;
  private playSeq = 0;

  private duckRestoreTimer: number | null = null;
  private rampRafId: number | null = null;
  private isDucked = false;
  private disposed = false;

  constructor(options: NeuralDubbingOptions) {
    this.video = options.video ?? null;
    this.getUserVolume = options.getUserVolume ?? (() => 1);
    this.isPausedCheck = options.isPaused ?? (() => Boolean(this.video?.paused));
    this.voice = options.voice;
    this.voiceName = options.voiceName;
    this.dubVolume = Math.max(0, Math.min(1, options.dubVolume));
  }

  public setVoice(voice: DubVoiceKey, voiceName?: string): void {
    if (this.voice === voice && this.voiceName === voiceName) return;
    this.voice = voice;
    this.voiceName = voiceName;
    this.stop();
  }

  public setDubVolume(volume: number): void {
    this.dubVolume = Math.max(0, Math.min(1, volume));
    if (this.activeAudio) {
      this.activeAudio.volume = this.dubVolume;
    }
  }

  private getCacheKey(text: string): string {
    return `${this.voiceName || this.voice}:${text}`;
  }

  private storeBlob(key: string, blobUrl: string): void {
    if (this.blobCache.has(key)) {
      this.blobCache.delete(key);
    } else if (this.blobCache.size >= MAX_LOCAL_BLOBS) {
      const oldest = this.blobCache.entries().next().value;
      if (oldest) {
        const [oldKey, oldUrl] = oldest;
        this.blobCache.delete(oldKey);
        URL.revokeObjectURL(oldUrl);
      }
    }
    this.blobCache.set(key, blobUrl);
  }

  private fetchAudioBlobUrl(text: string): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null);

    const cleaned = cleanCueText(text);
    if (!cleaned) return Promise.resolve(null);

    const key = this.getCacheKey(cleaned);
    const cached = this.blobCache.get(key);
    if (cached) return Promise.resolve(cached);

    const existing = this.pendingFetches.get(key);
    if (existing) return existing;

    const task = fetch(buildTtsUrl(cleaned, this.voice, this.voiceName))
      .then(async (res) => {
        if (!res.ok) return null;
        const blob = await res.blob();
        if (this.disposed || blob.size === 0) return null;
        const url = URL.createObjectURL(blob);
        this.storeBlob(key, url);
        return url;
      })
      .catch(() => null)
      .finally(() => {
        this.pendingFetches.delete(key);
      });

    this.pendingFetches.set(key, task);
    return task;
  }

  /**
   * Pré-carrega silenciosamente os próximos 2 cues a partir do currentTime (TextTrackCueList).
   */
  public prefetchUpcoming(cues: TextTrackCueList | null | undefined, currentTime: number): void {
    if (this.disposed || !cues || cues.length === 0) return;

    let scheduled = 0;
    for (let i = 0; i < cues.length && scheduled < PREFETCH_AHEAD; i++) {
      const cue = cues[i] as VTTCue | undefined;
      if (!cue || cue.endTime < currentTime) continue;
      if (cue.startTime >= currentTime - 0.15) {
        const text = cleanCueText(cue.text);
        if (text) {
          void this.fetchAudioBlobUrl(text);
          scheduled++;
        }
      }
    }
  }

  /**
   * Pré-carrega silenciosamente os próximos 2 cues a partir de um array parseado (Modo Embed).
   */
  public prefetchCueItems(cues: DubCueItem[], currentTime: number): void {
    if (this.disposed || cues.length === 0) return;

    let scheduled = 0;
    for (let i = 0; i < cues.length && scheduled < PREFETCH_AHEAD; i++) {
      const cue = cues[i];
      if (!cue || cue.endTime < currentTime) continue;
      if (cue.startTime >= currentTime - 0.15) {
        const text = cleanCueText(cue.text);
        if (text) {
          void this.fetchAudioBlobUrl(text);
          scheduled++;
        }
      }
    }
  }

  private rampVideoVolume(target: number): void {
    const video = this.video;
    if (!video) return;

    if (this.rampRafId !== null) {
      window.cancelAnimationFrame(this.rampRafId);
      this.rampRafId = null;
    }

    const startVol = video.volume;
    const clampedTarget = Math.max(0, Math.min(1, target));
    if (Math.abs(startVol - clampedTarget) < 0.01) {
      video.volume = clampedTarget;
      return;
    }

    const startTime = performance.now();

    const step = (now: number) => {
      if (this.disposed) return;
      const t = Math.min(1, (now - startTime) / DUCK_RAMP_MS);
      video.volume = startVol + (clampedTarget - startVol) * t;
      if (t < 1) {
        this.rampRafId = window.requestAnimationFrame(step);
      } else {
        this.rampRafId = null;
      }
    };

    this.rampRafId = window.requestAnimationFrame(step);
  }

  private applyDucking(): void {
    if (!this.video) return;
    if (this.duckRestoreTimer !== null) {
      window.clearTimeout(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }
    this.isDucked = true;
    const userVol = this.getUserVolume();
    this.rampVideoVolume(Math.min(userVol, DUCK_TARGET_VOLUME));
  }

  private scheduleRestoreVolume(immediate = false): void {
    if (!this.video) return;
    if (this.duckRestoreTimer !== null) {
      window.clearTimeout(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }

    if (!this.isDucked) return;

    const restore = () => {
      this.duckRestoreTimer = null;
      this.isDucked = false;
      this.rampVideoVolume(this.getUserVolume());
    };

    if (immediate) {
      restore();
    } else {
      this.duckRestoreTimer = window.setTimeout(restore, DUCK_RESTORE_DELAY_MS);
    }
  }

  public async playCue(text: string, startTime: number, endTime: number): Promise<void> {
    if (this.disposed || this.isPausedCheck()) return;

    const cleaned = cleanCueText(text);
    if (!cleaned) return;

    const seq = ++this.playSeq;

    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
      this.activeAudio = null;
    }

    const blobUrl = await this.fetchAudioBlobUrl(cleaned);
    if (this.disposed || seq !== this.playSeq || this.isPausedCheck() || !blobUrl) {
      return;
    }

    const audio = new Audio(blobUrl);
    audio.volume = this.dubVolume;
    audio.preload = 'auto';
    this.activeAudio = audio;

    const availableWindow = Math.max(0.45, endTime - startTime);

    const startPlayback = () => {
      if (this.disposed || seq !== this.playSeq || this.isPausedCheck()) return;

      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const neededRate = audio.duration / availableWindow;
        audio.playbackRate = Math.max(MIN_RATE, Math.min(MAX_RATE, neededRate));
      } else {
        audio.playbackRate = 1.0;
      }

      this.applyDucking();
      void audio.play().catch(() => {
        if (seq === this.playSeq) {
          this.scheduleRestoreVolume(true);
        }
      });
    };

    audio.addEventListener('loadedmetadata', startPlayback, { once: true });
    audio.addEventListener(
      'ended',
      () => {
        if (seq === this.playSeq) {
          this.activeAudio = null;
          this.scheduleRestoreVolume(false);
        }
      },
      { once: true }
    );
    audio.addEventListener(
      'error',
      () => {
        if (seq === this.playSeq) {
          this.activeAudio = null;
          this.scheduleRestoreVolume(true);
        }
      },
      { once: true }
    );

    if (audio.readyState >= 1) {
      startPlayback();
    }
  }

  public stop(): void {
    this.playSeq++;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
      this.activeAudio = null;
    }
    this.scheduleRestoreVolume(true);
  }

  public dispose(): void {
    this.disposed = true;
    this.playSeq++;
    if (this.activeAudio) {
      this.activeAudio.pause();
      this.activeAudio.src = '';
      this.activeAudio = null;
    }
    if (this.duckRestoreTimer !== null) {
      window.clearTimeout(this.duckRestoreTimer);
      this.duckRestoreTimer = null;
    }
    if (this.rampRafId !== null) {
      window.cancelAnimationFrame(this.rampRafId);
      this.rampRafId = null;
    }
    if (this.isDucked && this.video) {
      this.isDucked = false;
      this.video.volume = this.getUserVolume();
    }
    for (const url of this.blobCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobCache.clear();
    this.pendingFetches.clear();
  }
}
