import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  Pause,
  Play,
  Subtitles,
  Volume2,
} from 'lucide-react';
import {
  cleanCueText,
  NeuralDubbingController,
  type DubCueItem,
} from '../services/neuralDubbing';
import type { DubVoiceKey, SubtitleStatus } from '../services/playerApi';
import type { LanguageConfig } from '../utils/locale';

interface EmbedSubtitleOverlayProps {
  subtitleUrl: string | null;
  subtitleStatus: SubtitleStatus;
  languageConfig: LanguageConfig;
  defaultSubtitlesEnabled: boolean;
  defaultDubbingEnabled: boolean;
  dubVoice: DubVoiceKey;
  dubVolume: number;
  onChangeDubVoice: (voice: DubVoiceKey) => void;
  onChangeDubVolume: (volume: number) => void;
}

function parseVttTimestamp(raw: string): number {
  const cleaned = raw.trim().split(/\s+/)[0] ?? '';
  const parts = cleaned.split(':');
  if (parts.length === 3) {
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    const s = Number(parts[2]?.replace(',', '.'));
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = Number(parts[0]);
    const s = Number(parts[1]?.replace(',', '.'));
    return m * 60 + s;
  }
  return Number.NaN;
}

function parseVttContent(rawVtt: string): DubCueItem[] {
  const body = rawVtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .trim();

  if (!body) return [];

  const blocks = body.split(/\n{2,}/);
  const cues: DubCueItem[] = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((line) => line.includes('-->'));
    if (timingIdx === -1) continue;

    const timingLine = lines[timingIdx] ?? '';
    const [rawStart, rawEnd] = timingLine.split('-->');
    if (!rawStart || !rawEnd) continue;

    const startTime = parseVttTimestamp(rawStart);
    const endTime = parseVttTimestamp(rawEnd);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      continue;
    }

    const text = cleanCueText(lines.slice(timingIdx + 1).join('\n'));
    if (!text) continue;

    cues.push({ startTime, endTime, text });
  }

  return cues;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function parseJumpInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  }
  if (parts.length === 3) {
    return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
  }
  return null;
}

export function EmbedSubtitleOverlay({
  subtitleUrl,
  subtitleStatus,
  languageConfig,
  defaultSubtitlesEnabled,
  defaultDubbingEnabled,
  dubVoice,
  dubVolume,
  onChangeDubVoice,
  onChangeDubVolume,
}: EmbedSubtitleOverlayProps) {
  const [cues, setCues] = useState<DubCueItem[]>([]);
  const [overlayTime, setOverlayTime] = useState(0);
  const [clockRunning, setClockRunning] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(defaultSubtitlesEnabled);
  const [dubbingEnabled, setDubbingEnabled] = useState(defaultDubbingEnabled);
  const [collapsed, setCollapsed] = useState(false);
  const [jumpInput, setJumpInput] = useState('');

  const clockRunningRef = useRef(clockRunning);
  const lastTickRef = useRef<number>(0);
  const lastSpokenCueIdxRef = useRef<number>(-1);
  const dubbingRef = useRef<NeuralDubbingController | null>(null);

  useEffect(() => {
    clockRunningRef.current = clockRunning;
  }, [clockRunning]);

  // Carrega e faz parse da legenda .vtt
  useEffect(() => {
    if (!subtitleUrl) return;
    const controller = new AbortController();
    let active = true;

    fetch(subtitleUrl, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return [];
        const text = await res.text();
        return parseVttContent(text);
      })
      .then((parsed) => {
        if (active) setCues(parsed);
      })
      .catch(() => {
        if (active) setCues([]);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [subtitleUrl]);

  // Relógio interno sincronizável (tick preciso de 100ms via performance.now)
  useEffect(() => {
    if (!clockRunning) return;
    lastTickRef.current = performance.now();

    const interval = window.setInterval(() => {
      const now = performance.now();
      const deltaSec = (now - lastTickRef.current) / 1000;
      lastTickRef.current = now;
      setOverlayTime((prev) => prev + deltaSec);
    }, 100);

    return () => window.clearInterval(interval);
  }, [clockRunning]);

  // Atalho Shift + Espaço para Play/Pause do timer da legenda
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.shiftKey && e.code === 'Space') {
        e.preventDefault();
        setClockRunning((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Controlador de Dublagem Neural
  useEffect(() => {
    if (!dubbingEnabled || !subtitleUrl) {
      dubbingRef.current?.dispose();
      dubbingRef.current = null;
      return;
    }

    const controller = new NeuralDubbingController({
      video: null,
      isPaused: () => !clockRunningRef.current,
      voice: dubVoice,
      voiceName: languageConfig.ttsVoices[dubVoice],
      dubVolume,
    });
    dubbingRef.current = controller;

    return () => {
      controller.dispose();
      if (dubbingRef.current === controller) {
        dubbingRef.current = null;
      }
    };
    // dubVoice, voiceName e dubVolume sincronizados separadamente para preservar cache de Blob URLs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dubbingEnabled, subtitleUrl]);

  useEffect(() => {
    dubbingRef.current?.setVoice(dubVoice, languageConfig.ttsVoices[dubVoice]);
  }, [dubVoice, languageConfig.ttsVoices]);

  useEffect(() => {
    dubbingRef.current?.setDubVolume(dubVolume);
  }, [dubVolume]);

  useEffect(() => {
    if (!clockRunning) {
      dubbingRef.current?.stop();
    }
  }, [clockRunning]);

  // Encontra o cue ativo no instante atual
  const activeCueIndex = useMemo(() => {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (!c) continue;
      if (overlayTime >= c.startTime && overlayTime <= c.endTime) {
        return i;
      }
      if (c.startTime > overlayTime) break;
    }
    return -1;
  }, [cues, overlayTime]);

  const activeCue = activeCueIndex >= 0 ? cues[activeCueIndex] : null;

  // Pré-carrega os próximos 2 cues e dispara dublagem quando o cue muda
  useEffect(() => {
    const controller = dubbingRef.current;
    if (!controller || !dubbingEnabled || !clockRunning || cues.length === 0) return;

    controller.prefetchCueItems(cues, overlayTime);

    if (activeCueIndex >= 0 && activeCueIndex !== lastSpokenCueIdxRef.current) {
      lastSpokenCueIdxRef.current = activeCueIndex;
      const cue = cues[activeCueIndex];
      if (cue) {
        void controller.playCue(cue.text, cue.startTime, cue.endTime);
      }
    }
  }, [activeCueIndex, cues, dubbingEnabled, clockRunning, overlayTime]);

  const adjustTime = useCallback((delta: number) => {
    dubbingRef.current?.stop();
    lastSpokenCueIdxRef.current = -1;
    setOverlayTime((prev) => Math.max(0, prev + delta));
  }, []);

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetSec = parseJumpInput(jumpInput);
    if (targetSec === null) return;
    dubbingRef.current?.stop();
    lastSpokenCueIdxRef.current = -1;
    setOverlayTime(targetSec);
    setJumpInput('');
  };

  if (!subtitleUrl) return null;

  return (
    <>
      {/* Legenda centralizada acima da barra inferior do iframe */}
      <AnimatePresence>
        {subtitlesEnabled && activeCue && (
          <motion.div
            key={activeCueIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="pointer-events-none fixed inset-x-0 bottom-16 z-40 flex justify-center px-6 sm:bottom-20"
          >
            <p className="max-w-3xl whitespace-pre-line rounded-xl bg-[#09090B]/85 px-4 py-2 text-center text-base font-medium leading-snug text-[#FAFAFA] shadow-lg backdrop-blur-sm sm:text-xl">
              {activeCue.text}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Barra flutuante compacta e recolhível no canto superior direito */}
      <div className="fixed right-4 top-[72px] z-40 w-64 sm:right-6">
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#121215]/90 text-[#FAFAFA] shadow-2xl backdrop-blur-md">
          {/* Cabeçalho compacto */}
          <div className="flex items-center justify-between gap-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setClockRunning((prev) => !prev)}
                title="Play / Pause do timer (Shift + Espaço)"
                aria-label={clockRunning ? 'Pausar legenda' : 'Iniciar legenda'}
                className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-zinc-950 transition-colors hover:bg-zinc-200"
              >
                {clockRunning ? (
                  <Pause className="h-3.5 w-3.5 fill-zinc-950" />
                ) : (
                  <Play className="h-3.5 w-3.5 translate-x-[0.5px] fill-zinc-950" />
                )}
              </button>

              <div className="leading-tight">
                <p className="font-mono text-xs font-semibold tabular-nums text-white">
                  {formatClock(overlayTime)}
                </p>
                <p className="text-[10px] text-white/55">
                  {subtitleStatus === 'native-pt' || subtitleStatus === 'native'
                    ? `${languageConfig.shortLabel} Nativa`
                    : `${languageConfig.shortLabel} Traduzida`}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              aria-label={collapsed ? 'Expandir controles de legenda' : 'Recolher controles'}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          </div>

          {/* Corpo expansível */}
          <AnimatePresence initial={false}>
            {!collapsed && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden border-t border-white/10"
              >
                <div className="space-y-3 p-3">
                  {/* Ir para MM:SS */}
                  <form onSubmit={handleJumpSubmit} className="flex gap-1.5">
                    <input
                      type="text"
                      value={jumpInput}
                      onChange={(e) => setJumpInput(e.target.value)}
                      placeholder="MM:SS"
                      aria-label="Ir para minuto e segundo"
                      className="h-8 flex-1 rounded-lg border border-white/10 bg-[#09090B]/80 px-2.5 font-mono text-xs text-white placeholder-white/40 outline-none focus:border-white/30 tabular-nums"
                    />
                    <button
                      type="submit"
                      className="h-8 rounded-lg border border-white/10 bg-white/10 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-white/20"
                    >
                      Ir para
                    </button>
                  </form>

                  {/* Ajuste fino */}
                  <div className="grid grid-cols-4 gap-1">
                    {([-1, -0.5, 0.5, 1] as const).map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => adjustTime(delta)}
                        className="rounded-lg border border-white/10 bg-white/[0.05] py-1 text-[11px] font-medium text-white/85 transition-colors hover:bg-white/15 tabular-nums"
                      >
                        {delta > 0 ? `+${delta}s` : `${delta}s`}
                      </button>
                    ))}
                  </div>

                  {/* Toggles: Legenda PT-BR + Dublagem IA */}
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setSubtitlesEnabled((prev) => !prev)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                        subtitlesEnabled
                          ? 'bg-white text-zinc-950'
                          : 'border border-white/10 bg-white/[0.04] text-white/70 hover:text-white'
                      }`}
                    >
                      <Subtitles className="h-3.5 w-3.5" />
                      <span>Legenda</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDubbingEnabled((prev) => !prev)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[11px] font-medium transition-colors ${
                        dubbingEnabled
                          ? 'bg-white text-zinc-950'
                          : 'border border-white/10 bg-white/[0.04] text-white/70 hover:text-white'
                      }`}
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                      <span>Dublagem IA</span>
                    </button>
                  </div>

                  {/* Voz e volume da Dublagem IA */}
                  {dubbingEnabled && (
                    <div className="space-y-2 border-t border-white/10 pt-2.5">
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
                        {(
                          [
                            ['female', languageConfig.ttsVoices.femaleLabel],
                            ['male', languageConfig.ttsVoices.maleLabel],
                          ] as const
                        ).map(([key, label]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => onChangeDubVoice(key)}
                            className={`rounded-md py-1 text-[11px] font-medium transition-colors ${
                              dubVoice === key
                                ? 'bg-white text-zinc-950'
                                : 'text-white/70 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-white/60">Vol</span>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.05}
                          value={dubVolume}
                          onChange={(e) => onChangeDubVolume(Number(e.target.value))}
                          aria-label="Volume da dublagem"
                          className="h-1 flex-1 cursor-pointer accent-white"
                        />
                        <span className="w-7 text-right font-mono text-[10px] text-white/80 tabular-nums">
                          {Math.round(dubVolume * 100)}%
                        </span>
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-white/45">
                    Atalho: <kbd className="font-mono text-white/70">Shift + Espaço</kbd>
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
