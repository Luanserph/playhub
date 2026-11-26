import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Hls from 'hls.js';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Server,
  Settings,
  Shield,
  SkipForward,
  Subtitles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { EmbedSubtitleOverlay } from './EmbedSubtitleOverlay';
import { NeuralDubbingController } from '../services/neuralDubbing';
import {
  DEMO_TEST_STREAM,
  fetchLastStreamError,
  fetchTorrentMeta,
  fetchTorrentStatus,
  resolvePlayback,
  type DubVoiceKey,
  type ResolvedStream,
  type ResolveReason,
  type ResolveSubtitleInfo,
  type TorrentStatusInfo,
} from '../services/playerApi';
import type { PlaybackPreferences, SourcePreferences } from '../services/storage';
import type { MediaItem, PlayRequest } from '../types/media';
import type { LanguageConfig } from '../utils/locale';

interface VideoPlayerProps {
  item: MediaItem;
  request: PlayRequest;
  addons: string[];
  preferences: PlaybackPreferences;
  sourcePreferences: SourcePreferences;
  languageConfig: LanguageConfig;
  initialTimeSeconds?: number;
  initialProgressPercent?: number;
  onClose: () => void;
  onOpenSettings?: () => void;
  onSaveProgress: (
    item: MediaItem,
    req: PlayRequest,
    progressPercent: number,
    currentTime: number,
    duration: number
  ) => void;
  onNextEpisode?: () => void;
}

interface AudioTrackItem {
  id: number;
  name: string;
  lang?: string;
}

type PopoverType = 'audio' | 'subtitles' | 'sources' | null;
type PlayerMode = 'native' | 'embed';

const STARTUP_TIMEOUT_MS = 6000;
const CONTROLS_HIDE_MS = 3000;
const PT_AUDIO_REGEX = /\b(pt|por|pob|pt-br|ptbr|portugues|português|brazil|brasil|dublado)\b/i;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function shiftTrackCues(track: TextTrack | undefined, delta: number): void {
  const cues = track?.cues;
  if (!cues) return;
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i] as VTTCue | undefined;
    if (!cue) continue;
    const nextStart = Math.max(0, cue.startTime + delta);
    const nextEnd = Math.max(nextStart + 0.1, cue.endTime + delta);
    cue.startTime = nextStart;
    cue.endTime = nextEnd;
  }
}

export function VideoPlayer({
  item,
  request,
  addons,
  preferences,
  sourcePreferences,
  languageConfig,
  initialTimeSeconds,
  initialProgressPercent,
  onClose,
  onOpenSettings,
  onSaveProgress,
  onNextEpisode,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dubbingRef = useRef<NeuralDubbingController | null>(null);
  const startupTimerRef = useRef<number | null>(null);
  const seekDebounceRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const hasResumedRef = useRef(false);
  const userVolumeRef = useRef(1);

  const initialMode: PlayerMode =
    preferences.defaultPlayerMode === 'native' ? 'native' : 'embed';

  const [phase, setPhase] = useState<
    'resolving' | 'empty' | 'loading-stream' | 'ready' | 'error'
  >(initialMode === 'embed' ? 'ready' : 'resolving');
  const [playerMode, setPlayerMode] = useState<PlayerMode>(initialMode);
  const [blockPopups, setBlockPopups] = useState(false);
  const [embedOverlayOpen, setEmbedOverlayOpen] = useState(false);
  const [embedNotice, setEmbedNotice] = useState<string | null>(null);
  const [emptyReason, setEmptyReason] = useState<ResolveReason | null>(null);
  const [statusMessage, setStatusMessage] = useState('Buscando melhor fonte...');
  const [streams, setStreams] = useState<ResolvedStream[]>([]);
  const [activeStreamIndex, setActiveStreamIndex] = useState(0);
  const [useProxy, setUseProxy] = useState(false);
  const [forceTranscode, setForceTranscode] = useState(false);
  const [subtitle, setSubtitle] = useState<ResolveSubtitleInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [technicalDetail, setTechnicalDetail] = useState<string | null>(null);
  const [possibleShieldsBlock, setPossibleShieldsBlock] = useState(false);
  const [torrentStatus, setTorrentStatus] = useState<TorrentStatusInfo | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Estado de reprodução
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [realDuration, setRealDuration] = useState(0);
  const [isTranscodedStream, setIsTranscodedStream] = useState(false);
  const [seekOffset, setSeekOffset] = useState(0);
  const [pendingSeekTime, setPendingSeekTime] = useState<number | null>(null);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Controles e popovers
  const [controlsVisible, setControlsVisible] = useState(true);
  const [activePopover, setActivePopover] = useState<PopoverType>(null);

  // Áudio, legendas e dublagem neural
  const [audioTracks, setAudioTracks] = useState<AudioTrackItem[]>([]);
  const [activeAudioTrack, setActiveAudioTrack] = useState<number>(-1);
  const [hasNativePtBrAudio, setHasNativePtBrAudio] = useState(false);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState(preferences.autoSubtitlesPtBr);
  const [subtitleOffset, setSubtitleOffset] = useState(0);
  const [aiDubbingEnabled, setAiDubbingEnabled] = useState(preferences.experimentalAiDubbing);
  const [dubVoice, setDubVoice] = useState<DubVoiceKey>('female');
  const [dubVolume, setDubVolume] = useState(1);

  const activeStream = streams[activeStreamIndex] ?? null;
  const isTranscoded = Boolean(
    activeStream?.sourceType === 'torrent' && (isTranscodedStream || forceTranscode)
  );
  const effectiveDuration =
    realDuration > 0 ? realDuration : Number.isFinite(duration) && duration > 0 ? duration : 0;
  const displayTime =
    pendingSeekTime !== null
      ? pendingSeekTime
      : isTranscoded
        ? seekOffset + currentTime
        : currentTime;

  const effectiveSubtitleUrl = subtitle?.url
    ? isTranscoded && seekOffset > 0
      ? `${subtitle.url}${subtitle.url.includes('?') ? '&' : '?'}offset=${Math.floor(seekOffset)}`
      : subtitle.url
    : null;

  const aiDubbingActive =
    playerMode === 'native' &&
    aiDubbingEnabled &&
    !hasNativePtBrAudio &&
    Boolean(effectiveSubtitleUrl);

  const embedLangHint = `ds_lang=${encodeURIComponent(languageConfig.iso2)}&sub_lang=${encodeURIComponent(languageConfig.iso2)}&lang=${encodeURIComponent(languageConfig.iso2)}`;
  const embedUrl =
    request.type === 'tv'
      ? `https://imdb.su/embed/tv/${request.imdbId.toLowerCase()}/${request.season ?? 1}/${
          request.episode ?? 1
        }?${embedLangHint}`
      : `https://imdb.su/embed/movie/${request.imdbId.toLowerCase()}?${embedLangHint}`;

  // Oculta o aviso discreto do modo embed após 4 segundos
  useEffect(() => {
    if (!embedNotice) return;
    const timer = window.setTimeout(() => setEmbedNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [embedNotice]);

  const handleSwitchMode = useCallback(
    (nextMode: PlayerMode) => {
      if (nextMode === playerMode) return;
      setActivePopover(null);
      if (nextMode === 'embed') {
        videoRef.current?.pause();
        dubbingRef.current?.stop();
        setIsBuffering(false);
        setPlayerMode('embed');
        setPhase('ready');
      } else {
        setPlayerMode('native');
        if (streams.length === 0) {
          setPhase('empty');
          setIsBuffering(false);
        } else {
          setPhase('loading-stream');
          setIsBuffering(true);
        }
      }
    },
    [playerMode, streams.length]
  );

  // Bloqueia scroll do body enquanto o player está aberto
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Persiste progresso real no watchHistory (considerando seekOffset em transcode FFmpeg)
  const flushProgress = useCallback(() => {
    const video = videoRef.current;
    const totalDur =
      realDuration > 0
        ? realDuration
        : video && Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : 0;
    const realPos = isTranscoded ? seekOffset + (video?.currentTime ?? 0) : (video?.currentTime ?? 0);
    if (totalDur <= 0 || realPos <= 0) return;
    const pct = Math.max(1, Math.min(100, Math.round((realPos / totalDur) * 100)));
    onSaveProgress(item, request, pct, realPos, totalDur);
  }, [item, request, onSaveProgress, realDuration, isTranscoded, seekOffset]);

  const handleClose = useCallback(() => {
    flushProgress();
    dubbingRef.current?.stop();
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    onClose();
  }, [flushProgress, onClose]);

  // Salva progresso real a cada 10 segundos
  useEffect(() => {
    const interval = window.setInterval(() => {
      flushProgress();
    }, 10000);
    return () => window.clearInterval(interval);
  }, [flushProgress]);

  // 1. Pipeline inicial: resolve streams + legenda PT-BR no backend
  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    const subtitleHintTimer = window.setTimeout(() => {
      if (active && preferences.autoSubtitlesPtBr) {
        setStatusMessage('Traduzindo legenda...');
      }
    }, 1200);

    resolvePlayback(
      {
        imdbId: request.imdbId,
        type: request.type,
        season: request.season,
        episode: request.episode,
        addons,
        enableBuiltInProviders: sourcePreferences.enableBuiltInProviders,
        torznabUrl: sourcePreferences.torznabUrl,
        torznabApiKey: sourcePreferences.torznabApiKey,
        preferPtBr: preferences.prioritizePtBrAudio,
        autoSubtitles: preferences.autoSubtitlesPtBr,
        lang: languageConfig.locale,
        iso2: languageConfig.iso2,
        openSubCodes: languageConfig.openSubCodes,
      },
      controller.signal
    )
      .then((data) => {
        if (!active) return;
        window.clearTimeout(subtitleHintTimer);

        setStreams(data.streams);
        setSubtitle(data.subtitle);
        setActiveStreamIndex(0);
        setUseProxy(false);
        setForceTranscode(false);

        // Se o modo padrão configurado for Embed, mantém no Embed sem interromper a reprodução
        if (initialMode === 'embed') {
          setEmptyReason(
            data.streams.length === 0
              ? (data.reason ?? (addons.length === 0 ? 'NO_ADDONS' : 'NO_STREAMS_FOUND'))
              : null
          );
          setPhase('ready');
          setIsBuffering(false);
          return;
        }

        if (data.streams.length === 0) {
          setEmptyReason(data.reason ?? (addons.length === 0 ? 'NO_ADDONS' : 'NO_STREAMS_FOUND'));
          setPlayerMode('embed');
          setEmbedOverlayOpen(false);
          setEmbedNotice('Nenhuma fonte nos add-ons — usando player imdb.su');
          setPhase('ready');
          setIsBuffering(false);
          return;
        }

        setEmptyReason(null);
        setPlayerMode('native');

        if (data.subtitle.status === 'native-pt' || data.subtitle.status === 'native') {
          setStatusMessage(`Injetando legenda ${languageConfig.shortLabel}...`);
        } else if (data.subtitle.status === 'auto-translated') {
          setStatusMessage(`Injetando legenda ${languageConfig.shortLabel} traduzida...`);
        } else {
          setStatusMessage('Carregando melhor fonte...');
        }

        setPhase('loading-stream');
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        window.clearTimeout(subtitleHintTimer);
        if (initialMode === 'embed') {
          // Mesmo que o backend local esteja offline, o Embed continua funcionando
          setPhase('ready');
          setIsBuffering(false);
          return;
        }
        setPhase('error');
        setErrorMessage(
          'Não foi possível conectar ao servidor do player (http://localhost:3001).'
        );
      });

    return () => {
      active = false;
      window.clearTimeout(subtitleHintTimer);
      controller.abort();
    };
  }, [
    request.imdbId,
    request.type,
    request.season,
    request.episode,
    addons,
    sourcePreferences.enableBuiltInProviders,
    sourcePreferences.torznabUrl,
    sourcePreferences.torznabApiKey,
    preferences.prioritizePtBrAudio,
    preferences.autoSubtitlesPtBr,
    languageConfig.locale,
    languageConfig.iso2,
    languageConfig.openSubCodes,
    languageConfig.shortLabel,
    initialMode,
    reloadNonce,
  ]);

  // 2. Carrega o stream ativo com reset completo do <video>, hls.js apenas para .m3u8 e tratamento claro de erros
  useEffect(() => {
    if (
      playerMode !== 'native' ||
      !activeStream ||
      phase === 'resolving' ||
      phase === 'empty' ||
      phase === 'error'
    ) {
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    let started = false;

    const isTorrent = activeStream.sourceType === 'torrent';
    const baseUrl = useProxy ? activeStream.proxyUrl : activeStream.url;
    const extraParams: string[] = [];
    if (isTorrent && forceTranscode) extraParams.push('transcode=1');
    if (isTorrent && (isTranscodedStream || forceTranscode) && seekOffset > 0) {
      extraParams.push(`start=${Math.floor(seekOffset)}`);
    }
    const effectiveUrl =
      extraParams.length > 0
        ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${extraParams.join('&')}`
        : baseUrl;
    const isHlsUrl = !isTorrent && effectiveUrl.toLowerCase().includes('.m3u8');

    const clearStartupTimer = () => {
      if (startupTimerRef.current !== null) {
        window.clearTimeout(startupTimerRef.current);
        startupTimerRef.current = null;
      }
    };

    clearStartupTimer();

    const handleStreamFailure = (reason?: string, browserCode?: string) => {
      if (cancelled || started) return;
      clearStartupTimer();

      if (
        !isTorrent &&
        !useProxy &&
        activeStream.proxyUrl &&
        activeStream.proxyUrl !== activeStream.url
      ) {
        setStatusMessage('Ativando proxy anti-CORS...');
        setUseProxy(true);
        return;
      }

      const isBraveOrShields =
        browserCode === 'MEDIA_ERR_NETWORK' ||
        (typeof navigator !== 'undefined' &&
          'brave' in navigator &&
          browserCode === 'MEDIA_ERR_SRC_NOT_SUPPORTED');

      setPossibleShieldsBlock(Boolean(isBraveOrShields));
      setTechnicalDetail(browserCode ? `Navegador: ${browserCode}` : null);

      // Busca o último erro técnico do backend/FFmpeg para diagnóstico discreto
      void fetchLastStreamError().then((lastErr) => {
        if (!lastErr) return;
        const recent = Date.now() - lastErr.timestamp < 45000;
        if (!recent) return;
        setTechnicalDetail((prev) => {
          const backendLine = `${lastErr.source.toUpperCase()}: ${lastErr.message}`;
          return prev ? `${prev} · ${backendLine}` : backendLine;
        });
      });

      setPhase('error');
      setIsBuffering(false);
      setIsPlaying(false);
      setErrorMessage(
        reason ||
          (isTorrent
            ? 'Não foi possível reproduzir este torrent no navegador (timeout de peers ou formato MKV/HEVC/AC3 não suportado).'
            : 'Falha ao carregar esta fonte de vídeo.')
      );
    };

    // Timeout de 6s apenas para streams HTTP; torrents P2P têm timeout de 15s controlado pelo backend (504)
    if (!isTorrent) {
      startupTimerRef.current = window.setTimeout(() => {
        if (!started && !cancelled) {
          handleStreamFailure('Tempo esgotado ao conectar nesta fonte HTTP.');
        }
      }, STARTUP_TIMEOUT_MS);
    }

    const markStarted = () => {
      if (started || cancelled) return;
      started = true;
      clearStartupTimer();
      setPhase('ready');
      setIsBuffering(false);
    };

    const onCanPlay = () => markStarted();
    const onPlaying = () => {
      markStarted();
      setIsPlaying(true);
      setIsBuffering(false);
    };
    const onWaiting = () => setIsBuffering(true);
    const onPause = () => {
      setIsPlaying(false);
      flushProgress();
      dubbingRef.current?.stop();
    };
    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        setDuration(video.duration);
      }
      if (
        !isTranscoded &&
        !hasResumedRef.current &&
        Number.isFinite(video.duration) &&
        video.duration > 0
      ) {
        if (
          initialTimeSeconds &&
          initialTimeSeconds > 2 &&
          initialTimeSeconds < video.duration - 5
        ) {
          video.currentTime = initialTimeSeconds;
        } else if (
          initialProgressPercent &&
          initialProgressPercent > 2 &&
          initialProgressPercent < 96
        ) {
          video.currentTime = (initialProgressPercent / 100) * video.duration;
        }
        hasResumedRef.current = true;
      }
    };
    const onVideoError = () => {
      const mediaErr = video.error;
      // Retry automático único com &transcode=1 se o navegador rejeitar o codec de um torrent
      if (
        isTorrent &&
        !forceTranscode &&
        (mediaErr?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ||
          mediaErr?.code === MediaError.MEDIA_ERR_DECODE)
      ) {
        setStatusMessage('Ativando remux/transcode FFmpeg...');
        setIsBuffering(true);
        setForceTranscode(true);
        return;
      }

      if (mediaErr?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        handleStreamFailure(
          activeStream.containerTag === 'MKV' || !activeStream.isBrowserFriendly
            ? 'Formato/codec não suportado pelo navegador (MKV/HEVC ou áudio AC3/DTS). Tente uma fonte MP4.'
            : 'Fonte rejeitada pelo navegador ou timeout do servidor (504).',
          'MEDIA_ERR_SRC_NOT_SUPPORTED'
        );
      } else if (mediaErr?.code === MediaError.MEDIA_ERR_DECODE) {
        handleStreamFailure(
          'Erro ao decodificar o vídeo nesta fonte (codec incompatível).',
          'MEDIA_ERR_DECODE'
        );
      } else if (mediaErr?.code === MediaError.MEDIA_ERR_NETWORK) {
        handleStreamFailure(
          'Erro de rede ao baixar o stream de vídeo.',
          'MEDIA_ERR_NETWORK'
        );
      } else {
        handleStreamFailure(undefined, mediaErr ? `MEDIA_ERR_${mediaErr.code}` : undefined);
      }
    };

    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('error', onVideoError);

    // Reset completo antes de carregar a nova URL
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    video.pause();
    video.removeAttribute('src');
    video.load();

    const syncHlsAudioTracks = (hls: Hls) => {
      const tracks = hls.audioTracks.map((t, index) => ({
        id: index,
        name: t.name || t.lang || `Faixa ${index + 1}`,
        lang: t.lang,
      }));
      setAudioTracks(tracks);

      const ptTrack = tracks.find((t) =>
        PT_AUDIO_REGEX.test(`${t.lang ?? ''} ${t.name}`)
      );

      if (ptTrack) {
        setHasNativePtBrAudio(true);
        if (preferences.prioritizePtBrAudio) {
          hls.audioTrack = ptTrack.id;
          setActiveAudioTrack(ptTrack.id);
          return;
        }
      } else {
        setHasNativePtBrAudio(false);
      }

      setActiveAudioTrack(hls.audioTrack);
    };

    // Usa hls.js APENAS se a URL contiver .m3u8 (nunca para /api/torrent-stream/...)
    if (isHlsUrl && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        backBufferLength: 90,
      });
      hlsRef.current = hls;

      hls.loadSource(effectiveUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (cancelled) return;
        syncHlsAudioTracks(hls);
        void video.play().catch(() => {
          markStarted();
        });
      });

      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
        if (!cancelled) syncHlsAudioTracks(hls);
      });

      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data) => {
        if (!cancelled) setActiveAudioTrack(data.id);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          hls.destroy();
          hlsRef.current = null;
          handleStreamFailure();
        }
      });
    } else {
      video.src = effectiveUrl;
      video.load();
      void video.play().catch(() => {
        // Autoplay pode aguardar interação após metadata carregar
      });
    }

    return () => {
      cancelled = true;
      clearStartupTimer();
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('error', onVideoError);
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [
    playerMode,
    activeStream,
    activeStreamIndex,
    useProxy,
    forceTranscode,
    isTranscodedStream,
    isTranscoded,
    seekOffset,
    streams.length,
    phase,
    preferences.prioritizePtBrAudio,
    initialTimeSeconds,
    initialProgressPercent,
    flushProgress,
  ]);

  // 2b. Polling de status de peers a cada 1.5s enquanto conecta a um torrent P2P
  useEffect(() => {
    if (
      playerMode !== 'native' ||
      activeStream?.sourceType !== 'torrent' ||
      !activeStream.infoHash ||
      (phase !== 'loading-stream' && !isBuffering)
    ) {
      return;
    }

    const hash = activeStream.infoHash;
    let active = true;
    const controller = new AbortController();

    const poll = () => {
      void fetchTorrentStatus(hash, controller.signal).then((status) => {
        if (active && status) {
          setTorrentStatus(status);
        }
      });
    };

    poll();
    const interval = window.setInterval(poll, 1500);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [playerMode, activeStream?.sourceType, activeStream?.infoHash, phase, isBuffering]);

  // 2c. Consulta duração real e flag isTranscoded do torrent via /api/torrent-meta
  useEffect(() => {
    if (
      playerMode !== 'native' ||
      activeStream?.sourceType !== 'torrent' ||
      !activeStream.infoHash ||
      phase === 'resolving' ||
      phase === 'empty'
    ) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    void fetchTorrentMeta(
      activeStream.infoHash,
      activeStream.fileIdx ?? 'auto',
      controller.signal
    ).then((meta) => {
      if (!active || !meta) return;
      if (meta.duration > 0) setRealDuration(meta.duration);
      setIsTranscodedStream(meta.isTranscoded);

      if (meta.isTranscoded && !hasResumedRef.current) {
        let resumeSec = 0;
        if (
          initialTimeSeconds &&
          initialTimeSeconds > 2 &&
          (meta.duration <= 0 || initialTimeSeconds < meta.duration - 5)
        ) {
          resumeSec = Math.floor(initialTimeSeconds);
        } else if (
          initialProgressPercent &&
          initialProgressPercent > 2 &&
          initialProgressPercent < 96 &&
          meta.duration > 0
        ) {
          resumeSec = Math.floor((initialProgressPercent / 100) * meta.duration);
        }
        hasResumedRef.current = true;
        if (resumeSec > 2) {
          setSeekOffset(resumeSec);
        }
      }
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    playerMode,
    activeStream?.sourceType,
    activeStream?.infoHash,
    activeStream?.fileIdx,
    phase,
    initialTimeSeconds,
    initialProgressPercent,
  ]);

  // 3. Controla visibilidade da faixa de legenda (showing / hidden)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !effectiveSubtitleUrl) return;

    const applyMode = () => {
      const track = video.textTracks[0];
      if (!track) return;
      track.mode = subtitlesEnabled ? 'showing' : aiDubbingActive ? 'hidden' : 'disabled';
    };

    applyMode();
    const trackEl = trackRef.current;
    trackEl?.addEventListener('load', applyMode);
    return () => {
      trackEl?.removeEventListener('load', applyMode);
    };
  }, [effectiveSubtitleUrl, subtitlesEnabled, aiDubbingActive]);

  // 4. Motor de Dublagem Neural (/api/tts) com pré-carregamento + audio ducking
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !aiDubbingActive || !effectiveSubtitleUrl) {
      dubbingRef.current?.dispose();
      dubbingRef.current = null;
      return;
    }

    const controller = new NeuralDubbingController({
      video,
      getUserVolume: () => userVolumeRef.current,
      voice: dubVoice,
      voiceName: languageConfig.ttsVoices[dubVoice],
      dubVolume,
    });
    dubbingRef.current = controller;

    const handleCueChange = () => {
      if (video.paused) return;
      const track = video.textTracks[0];
      const activeCues = track?.activeCues;
      if (!activeCues || activeCues.length === 0) return;

      const texts: string[] = [];
      let minStart = Number.POSITIVE_INFINITY;
      let maxEnd = 0;

      for (let i = 0; i < activeCues.length; i++) {
        const cue = activeCues[i] as VTTCue | undefined;
        if (!cue?.text) continue;
        texts.push(cue.text);
        if (cue.startTime < minStart) minStart = cue.startTime;
        if (cue.endTime > maxEnd) maxEnd = cue.endTime;
      }

      if (texts.length > 0) {
        const start = Number.isFinite(minStart) ? minStart : video.currentTime;
        const end = maxEnd > start ? maxEnd : start + 2.5;
        void controller.playCue(texts.join(' '), start, end);
      }
    };

    const handlePrefetch = () => {
      const track = video.textTracks[0];
      if (!track?.cues) return;
      controller.prefetchUpcoming(track.cues, video.currentTime);
    };

    const handleSeeking = () => {
      controller.stop();
      handlePrefetch();
    };

    const attachTrackListener = () => {
      const track = video.textTracks[0];
      if (!track) return;
      if (track.mode === 'disabled') track.mode = 'hidden';
      track.addEventListener('cuechange', handleCueChange);
      controller.prefetchUpcoming(track.cues, video.currentTime);
    };

    attachTrackListener();
    const trackEl = trackRef.current;
    trackEl?.addEventListener('load', attachTrackListener);
    video.addEventListener('timeupdate', handlePrefetch);
    video.addEventListener('seeking', handleSeeking);

    return () => {
      const track = video.textTracks[0];
      track?.removeEventListener('cuechange', handleCueChange);
      trackEl?.removeEventListener('load', attachTrackListener);
      video.removeEventListener('timeupdate', handlePrefetch);
      video.removeEventListener('seeking', handleSeeking);
      controller.dispose();
      if (dubbingRef.current === controller) {
        dubbingRef.current = null;
      }
    };
    // dubVoice e dubVolume são sincronizados via efeitos dedicados abaixo sem descartar o cache local
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDubbingActive, effectiveSubtitleUrl]);

  useEffect(() => {
    dubbingRef.current?.setVoice(dubVoice, languageConfig.ttsVoices[dubVoice]);
  }, [dubVoice, languageConfig.ttsVoices]);

  useEffect(() => {
    dubbingRef.current?.setDubVolume(dubVolume);
  }, [dubVolume]);

  // 5. Auto-ocultação dos controles após 3s de inatividade
  const showControls = controlsVisible || !isPlaying || activePopover !== null;

  const scheduleControlsHide = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (isPlaying && activePopover === null) {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, CONTROLS_HIDE_MS);
    }
  }, [isPlaying, activePopover]);

  useEffect(() => {
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    if (isPlaying && activePopover === null) {
      hideTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, CONTROLS_HIDE_MS);
    }
    return () => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [isPlaying, activePopover]);

  // Fullscreen listener
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Controles de vídeo
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, []);

  // Limpa debounce de seek ao desmontar
  useEffect(() => {
    return () => {
      if (seekDebounceRef.current !== null) {
        window.clearTimeout(seekDebounceRef.current);
      }
    };
  }, []);

  const commitTranscodeSeek = useCallback((targetSeconds: number) => {
    const clamped = Math.max(0, Math.floor(targetSeconds));
    dubbingRef.current?.stop();
    setPendingSeekTime(clamped);

    if (seekDebounceRef.current !== null) {
      window.clearTimeout(seekDebounceRef.current);
    }

    seekDebounceRef.current = window.setTimeout(() => {
      seekDebounceRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      setSeekOffset(clamped);
      setCurrentTime(0);
      setPendingSeekTime(null);
      setIsBuffering(true);
      setStatusMessage(`Avançando para ${formatTime(clamped)}...`);
    }, 250);
  }, []);

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const video = videoRef.current;
      if (isTranscoded) {
        const maxDur = effectiveDuration > 0 ? effectiveDuration : 86400;
        const target = Math.max(0, Math.min(maxDur, displayTime + deltaSeconds));
        commitTranscodeSeek(target);
        return;
      }
      if (!video || !Number.isFinite(video.duration)) return;
      const target = Math.max(0, Math.min(video.duration, video.currentTime + deltaSeconds));
      dubbingRef.current?.stop();
      video.currentTime = target;
      setCurrentTime(target);
    },
    [isTranscoded, effectiveDuration, displayTime, commitTranscodeSeek]
  );

  const handleSeekBarChange = (value: number) => {
    if (isTranscoded) {
      commitTranscodeSeek(value);
      return;
    }
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    dubbingRef.current?.stop();
    video.currentTime = value;
    setCurrentTime(value);
  };

  const handleVolumeChange = (nextVol: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.max(0, Math.min(1, nextVol));
    userVolumeRef.current = clamped;
    video.volume = clamped;
    video.muted = clamped === 0;
    setVolume(clamped);
    setMuted(clamped === 0);
  };

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setMuted(nextMuted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen().catch(() => {});
    }
  }, []);

  const adjustSubtitleOffset = (delta: number) => {
    shiftTrackCues(videoRef.current?.textTracks[0], delta);
    setSubtitleOffset((prev) => Math.round((prev + delta) * 10) / 10);
  };

  const resetSubtitleOffset = () => {
    if (subtitleOffset !== 0) {
      adjustSubtitleOffset(-subtitleOffset);
    }
  };

  const handleSelectAudioTrack = (trackId: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.audioTrack = trackId;
    setActiveAudioTrack(trackId);
    const chosen = audioTracks.find((t) => t.id === trackId);
    setHasNativePtBrAudio(
      Boolean(chosen && PT_AUDIO_REGEX.test(`${chosen.lang ?? ''} ${chosen.name}`))
    );
  };

  const handleSelectSource = (index: number) => {
    setActivePopover(null);
    if (index === activeStreamIndex && phase !== 'error') {
      return;
    }
    if (startupTimerRef.current !== null) {
      window.clearTimeout(startupTimerRef.current);
      startupTimerRef.current = null;
    }
    if (seekDebounceRef.current !== null) {
      window.clearTimeout(seekDebounceRef.current);
      seekDebounceRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
    dubbingRef.current?.stop();
    setTorrentStatus(null);
    setErrorMessage(null);
    setTechnicalDetail(null);
    setPossibleShieldsBlock(false);
    setCurrentTime(0);
    setDuration(0);
    setRealDuration(0);
    setIsTranscodedStream(false);
    setSeekOffset(0);
    setPendingSeekTime(null);
    setIsPlaying(false);
    setUseProxy(false);
    setForceTranscode(false);
    setStatusMessage('Conectando à nova fonte...');
    setIsBuffering(true);
    setActiveStreamIndex(index);
    setPhase('loading-stream');
  };

  const handleTryNextMp4Source = () => {
    // Procura a próxima fonte compatível com navegador (MP4/H264) após a atual
    const nextFriendlyIdx = streams.findIndex(
      (s, idx) => idx > activeStreamIndex && s.isBrowserFriendly
    );
    if (nextFriendlyIdx !== -1) {
      handleSelectSource(nextFriendlyIdx);
      return;
    }
    const anyFriendlyIdx = streams.findIndex(
      (s, idx) => idx !== activeStreamIndex && s.isBrowserFriendly
    );
    if (anyFriendlyIdx !== -1) {
      handleSelectSource(anyFriendlyIdx);
      return;
    }
    if (activeStreamIndex + 1 < streams.length) {
      handleSelectSource(activeStreamIndex + 1);
    } else if (streams.length > 0) {
      handleSelectSource(0);
    }
  };

  // Atalhos de teclado: Espaço, Setas, F, M, Esc
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        if (activePopover) {
          setActivePopover(null);
        } else {
          handleClose();
        }
        return;
      }

      // No modo Embed, não intercepta atalhos do iframe nem Shift+Espaço do overlay de legenda
      if (playerMode === 'embed') return;

      if (e.key === ' ' || e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePlay();
        scheduleControlsHide();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekBy(10);
        scheduleControlsHide();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekBy(-10);
        scheduleControlsHide();
      } else if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key.toLowerCase() === 'm') {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    playerMode,
    activePopover,
    handleClose,
    togglePlay,
    seekBy,
    toggleFullscreen,
    toggleMute,
    scheduleControlsHide,
  ]);

  const progressRatio =
    effectiveDuration > 0 ? Math.min(100, (displayTime / effectiveDuration) * 100) : 0;

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      onMouseMove={scheduleControlsHide}
      onTouchStart={scheduleControlsHide}
      className={`fixed inset-0 z-50 flex flex-col bg-black text-[#FAFAFA] select-none ${
        playerMode === 'embed' || showControls ? 'cursor-default' : 'cursor-none'
      }`}
    >
      {/* Mídia: Vídeo Nativo ou Embed (imdb.su) */}
      {playerMode === 'embed' ? (
        <div className="relative h-full w-full bg-black pt-16">
          <iframe
            key={`${embedUrl}-${blockPopups ? 'sandboxed' : 'free'}`}
            src={embedUrl}
            title={request.title}
            allowFullScreen
            referrerPolicy="origin"
            {...(blockPopups
              ? { sandbox: 'allow-scripts allow-same-origin allow-forms allow-presentation' }
              : {})}
            className="h-full w-full border-0 bg-black"
          />

          {/* Overlay de Legenda + Dublagem Neural sobre o iframe (desativado por padrão para evitar duplicidade) */}
          {embedOverlayOpen && subtitle && (
            <EmbedSubtitleOverlay
              subtitleUrl={subtitle.url}
              subtitleStatus={subtitle.status}
              languageConfig={languageConfig}
              defaultSubtitlesEnabled
              defaultDubbingEnabled={preferences.experimentalAiDubbing}
              dubVoice={dubVoice}
              dubVolume={dubVolume}
              onChangeDubVoice={setDubVoice}
              onChangeDubVolume={setDubVolume}
            />
          )}
        </div>
      ) : (
        <video
          key={
            activeStream
              ? `${activeStream.id}-${useProxy ? 'proxy' : 'direct'}-${
                  forceTranscode ? 'transcode' : 'raw'
                }-s${seekOffset}`
              : 'video-empty'
          }
          ref={videoRef}
          crossOrigin="anonymous"
          playsInline
          onClick={() => {
            if (activePopover) {
              setActivePopover(null);
            } else {
              togglePlay();
            }
          }}
          onDoubleClick={toggleFullscreen}
          className={`playhub-video h-full w-full bg-black object-contain ${
            showControls ? 'hud-visible' : ''
          }`}
        >
          {effectiveSubtitleUrl && (
            <track
              ref={trackRef}
              key={effectiveSubtitleUrl}
              default
              kind="subtitles"
              src={effectiveSubtitleUrl}
              srcLang={languageConfig.locale}
              label={languageConfig.label}
            />
          )}
        </video>
      )}

      {/* Aviso discreto por 4s quando alterna automaticamente para imdb.su */}
      <AnimatePresence>
        {embedNotice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none fixed left-1/2 top-[72px] z-50 -translate-x-1/2"
          >
            <div className="rounded-full border border-white/10 bg-[#121215]/90 px-4 py-1.5 text-xs font-medium text-[#FAFAFA] shadow-xl backdrop-blur-md">
              {embedNotice}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loader Editorial (Pipeline automático / Buffering) */}
      <AnimatePresence>
        {(phase === 'resolving' ||
          (playerMode === 'native' &&
            (phase === 'loading-stream' || (phase === 'ready' && isBuffering)))) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/55 backdrop-blur-[2px]"
          >
            <div className="flex max-w-md flex-col items-center gap-2.5 rounded-2xl border border-white/[0.08] bg-[#09090B]/90 px-6 py-5 text-center backdrop-blur-xl">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
              <p className="text-sm font-medium text-[#FAFAFA]">
                {activeStream?.sourceType === 'torrent' && phase !== 'resolving'
                  ? `Conectando aos peers (${torrentStatus?.numPeers ?? 0} peers · ${Math.round(
                      (torrentStatus?.downloadSpeed ?? 0) / 1024
                    )} KB/s)...`
                  : phase === 'ready'
                    ? 'Carregando vídeo...'
                    : statusMessage}
              </p>
              {activeStream && phase !== 'resolving' && (
                <p className="max-w-xs truncate text-[11px] text-[#A1A1AA]">
                  {torrentStatus?.fileName || activeStream.releaseTitle || activeStream.name}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Estado vazio: Nenhum Add-on configurado ou nenhuma fonte encontrada */}
      <AnimatePresence>
        {phase === 'empty' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex items-center justify-center bg-[#09090B]/95 px-6 backdrop-blur-md"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#121215] p-6 text-center shadow-2xl">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-[#18181B]">
                <Server className="h-5 w-5 text-[#FAFAFA]" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[#FAFAFA]">
                {emptyReason === 'NO_ADDONS'
                  ? 'Nenhum Add-on configurado'
                  : 'Nenhuma fonte encontrada nos seus Add-ons'}
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-[#A1A1AA]">
                {emptyReason === 'NO_ADDONS'
                  ? 'Adicione a URL de um manifest.json compatível com Stremio nas configurações para reproduzir filmes e séries.'
                  : 'Os add-ons configurados não retornaram fontes compatíveis para este título no momento.'}
              </p>

              <div className="mt-6 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('embed')}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
                >
                  <Play className="h-4 w-4 fill-zinc-950" />
                  <span>Assistir via Embed (imdb.su)</span>
                </button>

                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-[#18181B] px-5 text-sm font-medium text-[#FAFAFA] transition-colors hover:bg-white/[0.08]"
                  >
                    <Settings className="h-4 w-4" />
                    <span>Abrir Configurações de Fontes</span>
                  </button>
                )}

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStreams([DEMO_TEST_STREAM]);
                      setActiveStreamIndex(0);
                      setUseProxy(false);
                      setStatusMessage('Carregando stream de demonstração...');
                      setIsBuffering(true);
                      setPhase('loading-stream');
                    }}
                    className="h-9 flex-1 rounded-xl border border-white/[0.08] bg-transparent px-4 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-white/[0.06] hover:text-[#FAFAFA]"
                  >
                    Testar Player com Demo
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="h-9 rounded-xl border border-white/[0.08] bg-transparent px-4 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-white/[0.06] hover:text-[#FAFAFA]"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Estado de erro (abaixo da barra superior z-40 e do popover de fontes z-50) */}
      <AnimatePresence>
        {phase === 'error' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex items-center justify-center bg-[#09090B]/90 px-6 pt-16 backdrop-blur-md"
          >
            <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#121215] p-6 text-center shadow-2xl">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-white/[0.08] bg-[#18181B]">
                <AlertCircle className="h-5 w-5 text-[#FAFAFA]" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-[#FAFAFA]">
                Falha na reprodução
              </h2>
              <p className="mt-1.5 text-sm text-[#A1A1AA]">
                {errorMessage || 'Ocorreu um erro ao carregar o vídeo.'}
              </p>
              {technicalDetail && (
                <p className="mt-2.5 break-words rounded-lg border border-white/[0.06] bg-[#09090B]/80 px-3 py-2 font-mono text-[11px] text-[#A1A1AA]">
                  {technicalDetail}
                </p>
              )}
              {possibleShieldsBlock && (
                <p className="mt-2 text-[11px] text-[#A1A1AA]">
                  Dica: se estiver no Brave ou usando bloqueadores, desative o Brave Shields para{' '}
                  <span className="font-mono text-[#FAFAFA]/80">localhost</span> caso o stream local seja bloqueado.
                </p>
              )}
              <div className="mt-6 flex flex-col gap-2.5">
                {streams.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActivePopover('sources')}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-200"
                  >
                    <Server className="h-4 w-4" />
                    <span>Escolher outra fonte manualmente</span>
                  </button>
                )}

                {streams.length > 1 && (
                  <button
                    type="button"
                    onClick={handleTryNextMp4Source}
                    className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181B] px-5 text-sm font-medium text-[#FAFAFA] transition-colors hover:bg-white/[0.08]"
                  >
                    Tentar próxima fonte MP4
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleSwitchMode('embed')}
                  className="h-10 w-full rounded-xl border border-white/[0.08] bg-[#18181B] px-5 text-sm font-medium text-[#FAFAFA] transition-colors hover:bg-white/[0.08]"
                >
                  Abrir no Embed (imdb.su)
                </button>

                <div className="flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPhase('resolving');
                      setStatusMessage('Buscando melhor fonte...');
                      setErrorMessage(null);
                      setUseProxy(false);
                      setForceTranscode(false);
                      setReloadNonce((n) => n + 1);
                    }}
                    className="h-9 flex-1 rounded-xl border border-white/[0.08] bg-transparent px-4 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-white/[0.06] hover:text-[#FAFAFA]"
                  >
                    Recarregar fontes
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="h-9 rounded-xl border border-white/[0.08] bg-transparent px-4 text-xs font-medium text-[#A1A1AA] transition-colors hover:bg-white/[0.06] hover:text-[#FAFAFA]"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Camada de Controles (barra superior sempre acessível em erro/embed; no Nativo normal oculta após 3s) */}
      <AnimatePresence>
        {(playerMode === 'embed' ||
          phase === 'error' ||
          (showControls && phase !== 'empty')) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute inset-0 z-40 flex flex-col justify-between"
          >
            {/* Barra superior */}
            <div
              className={`pointer-events-auto flex flex-wrap items-center justify-between gap-3 px-4 sm:px-8 ${
                playerMode === 'embed' || phase === 'error'
                  ? 'h-16 border-b border-white/[0.08] bg-[#09090B]/95 backdrop-blur-md'
                  : 'bg-gradient-to-b from-black/80 via-black/40 to-transparent pb-10 pt-5'
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Voltar ao catálogo"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/50 text-white backdrop-blur-md transition-colors hover:bg-white/15"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>

                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-sm font-semibold tracking-tight text-white sm:text-base">
                      {request.title}
                    </h1>
                    {request.type === 'tv' && (
                      <span className="shrink-0 rounded-md border border-white/10 bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/90 tabular-nums">
                        T{request.season ?? 1} · E{request.episode ?? 1}
                      </span>
                    )}
                  </div>
                  {playerMode === 'native' && (
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-white/65 tabular-nums">
                      {activeStream && (
                        <>
                          <span className="font-medium text-white/90">
                            {activeStream.resolution || activeStream.quality}
                          </span>
                          {activeStream.size && <span>· {activeStream.size}</span>}
                          {activeStream.seeders !== undefined && (
                            <span>· 👤 {activeStream.seeders}</span>
                          )}
                          {activeStream.containerTag && (
                            <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                              {activeStream.containerTag}
                            </span>
                          )}
                          {activeStream.audioTags?.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/90"
                            >
                              {tag}
                            </span>
                          ))}
                          {activeStream.releaseTitle && (
                            <span className="hidden max-w-[260px] truncate text-white/50 lg:inline">
                              · {activeStream.releaseTitle}
                            </span>
                          )}
                          {useProxy && <span>· Proxy</span>}
                        </>
                      )}
                      {subtitle && subtitle.status !== 'none' && (
                        <>
                          <span>·</span>
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                            {subtitle.status === 'native-pt' || subtitle.status === 'native'
                              ? `Legenda ${languageConfig.shortLabel} Nativa`
                              : `Legenda ${languageConfig.shortLabel} Traduzida`}
                          </span>
                        </>
                      )}
                      {aiDubbingActive && (
                        <>
                          <span>·</span>
                          <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white">
                            Dublagem Neural ·{' '}
                            {dubVoice === 'female'
                              ? languageConfig.ttsVoices.femaleLabel
                              : languageConfig.ttsVoices.maleLabel}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Ações da direita: Seletor Nativo / Embed + Bloquear pop-ups + Próximo Episódio */}
              <div className="flex items-center gap-2">
                {/* Seletor discreto em pílula */}
                <div className="flex items-center rounded-full border border-white/10 bg-[#121215]/90 p-0.5 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('native')}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      playerMode === 'native'
                        ? 'bg-white text-zinc-950'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    Player Nativo
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('embed')}
                    className={`rounded-full px-3 py-1 text-[11px] font-medium transition-colors ${
                      playerMode === 'embed'
                        ? 'bg-white text-zinc-950'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    Embed (imdb.su)
                  </button>
                </div>

                {/* Toggle rápido do Overlay de Legenda / Dublagem PlayHub (somente no modo Embed) */}
                {playerMode === 'embed' && subtitle?.url && (
                  <button
                    type="button"
                    onClick={() => setEmbedOverlayOpen((prev) => !prev)}
                    aria-pressed={embedOverlayOpen}
                    title="Ativar legenda e dublagem neural do PlayHub sobre o embed"
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors ${
                      embedOverlayOpen
                        ? 'border-white/20 bg-white text-zinc-950'
                        : 'border-white/10 bg-[#121215]/90 text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Subtitles className="h-3.5 w-3.5" />
                    <span className="hidden lg:inline">Legenda / Dublagem PlayHub</span>
                  </button>
                )}

                {/* Toggle compacto Bloquear pop-ups (somente no modo Embed) */}
                {playerMode === 'embed' && (
                  <button
                    type="button"
                    onClick={() => setBlockPopups((prev) => !prev)}
                    aria-pressed={blockPopups}
                    title="Ativa sandbox no iframe para bloquear pop-ups"
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors ${
                      blockPopups
                        ? 'border-white/20 bg-white text-zinc-950'
                        : 'border-white/10 bg-[#121215]/90 text-white/75 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Bloquear pop-ups</span>
                  </button>
                )}

                {/* Botão Próximo Episódio para séries */}
                {request.type === 'tv' && onNextEpisode && (
                  <button
                    type="button"
                    onClick={() => {
                      flushProgress();
                      dubbingRef.current?.stop();
                      onNextEpisode();
                    }}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-black/55 px-3 text-[11px] font-medium text-white backdrop-blur-md transition-colors hover:bg-white/15"
                  >
                    <span className="hidden md:inline">Próximo Episódio</span>
                    <SkipForward className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Controles inferiores e popovers (somente no modo Player Nativo) */}
            {playerMode === 'native' && (
            <div className="pointer-events-auto relative mt-auto flex flex-col bg-gradient-to-t from-black/90 via-black/55 to-transparent px-5 pb-5 pt-14 sm:px-8 sm:pb-7">
              <AnimatePresence>
                {activePopover && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                    onClick={(e) => e.stopPropagation()}
                    className="relative z-50 mb-3 ml-auto w-full max-w-xs rounded-2xl border border-white/10 bg-[#121215]/95 p-4 shadow-2xl backdrop-blur-xl"
                  >
                    {/* Popover: Legendas & Sincronia */}
                    {activePopover === 'subtitles' && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
                              Legendas
                            </p>
                            <p className="mt-0.5 text-xs text-white/85">
                              {subtitle?.status === 'native-pt' || subtitle?.status === 'native'
                                ? `${languageConfig.shortLabel} Nativa`
                                : subtitle?.status === 'auto-translated'
                                  ? `${languageConfig.shortLabel} Traduzida Auto`
                                  : 'Indisponível'}
                            </p>
                          </div>

                          {subtitle?.url && (
                            <button
                              type="button"
                              onClick={() => setSubtitlesEnabled((prev) => !prev)}
                              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                                subtitlesEnabled
                                  ? 'bg-white text-zinc-950'
                                  : 'border border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                              }`}
                            >
                              {subtitlesEnabled ? 'Ligada' : 'Desligada'}
                            </button>
                          )}
                        </div>

                        {subtitle?.url && (
                          <div className="border-t border-white/10 pt-3">
                            <div className="flex items-center justify-between text-xs text-white/70">
                              <span>Sincronia</span>
                              <span className="font-mono tabular-nums text-white">
                                {subtitleOffset > 0
                                  ? `+${subtitleOffset.toFixed(1)}s`
                                  : `${subtitleOffset.toFixed(1)}s`}
                              </span>
                            </div>
                            <div className="mt-2.5 grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => adjustSubtitleOffset(-0.5)}
                                className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/15 tabular-nums"
                              >
                                -0.5s
                              </button>
                              <button
                                type="button"
                                onClick={resetSubtitleOffset}
                                className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white/75 transition-colors hover:bg-white/15"
                              >
                                Reset
                              </button>
                              <button
                                type="button"
                                onClick={() => adjustSubtitleOffset(0.5)}
                                className="rounded-lg border border-white/10 bg-white/5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/15 tabular-nums"
                              >
                                +0.5s
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Popover: Áudio & Dublagem Neural PT-BR */}
                    {activePopover === 'audio' && (
                      <div className="space-y-3.5">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
                            Faixas de Áudio
                          </p>

                          {audioTracks.length > 0 ? (
                            <div className="mt-2 space-y-1">
                              {audioTracks.map((track) => {
                                const selected = track.id === activeAudioTrack;
                                return (
                                  <button
                                    key={track.id}
                                    type="button"
                                    onClick={() => handleSelectAudioTrack(track.id)}
                                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                                      selected
                                        ? 'bg-white/12 text-white'
                                        : 'text-white/75 hover:bg-white/5 hover:text-white'
                                    }`}
                                  >
                                    <span className="truncate">
                                      {track.name}
                                      {track.lang ? ` (${track.lang})` : ''}
                                    </span>
                                    {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <p className="mt-1.5 text-xs text-white/60">
                              Faixa de áudio padrão do stream.
                            </p>
                          )}
                        </div>

                        {/* Controles de Dublagem Neural PT-BR */}
                        <div className="space-y-3 border-t border-white/10 pt-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-xs font-medium text-white">
                                Dublagem IA (PT-BR)
                              </p>
                              <p className="text-[11px] text-white/55">
                                {!subtitle?.url
                                  ? 'Requer legenda PT-BR'
                                  : hasNativePtBrAudio
                                    ? 'Áudio PT-BR nativo ativo'
                                    : 'Voz neural com pré-carregamento'}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={!subtitle?.url || hasNativePtBrAudio}
                              onClick={() => setAiDubbingEnabled((prev) => !prev)}
                              className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                                aiDubbingActive
                                  ? 'bg-white text-zinc-950'
                                  : 'border border-white/15 bg-white/5 text-white/80 hover:bg-white/10'
                              }`}
                            >
                              {aiDubbingActive ? 'Ativa' : 'Off'}
                            </button>
                          </div>

                          {aiDubbingActive && (
                            <>
                              {/* Seletor de Voz */}
                              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] p-1">
                                {(
                                  [
                                    ['female', languageConfig.ttsVoices.femaleLabel],
                                    ['male', languageConfig.ttsVoices.maleLabel],
                                  ] as const
                                ).map(([key, label]) => {
                                  const selected = dubVoice === key;
                                  return (
                                    <button
                                      key={key}
                                      type="button"
                                      onClick={() => setDubVoice(key)}
                                      className={`rounded-lg py-1.5 text-xs font-medium transition-colors ${
                                        selected
                                          ? 'bg-white text-zinc-950'
                                          : 'text-white/70 hover:text-white'
                                      }`}
                                    >
                                      {label}
                                    </button>
                                  );
                                })}
                              </div>

                              {/* Volume da Dublagem */}
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] text-white/65">
                                  <span>Volume da dublagem</span>
                                  <span className="font-mono tabular-nums text-white">
                                    {Math.round(dubVolume * 100)}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={dubVolume}
                                  onChange={(e) => setDubVolume(Number(e.target.value))}
                                  aria-label="Volume da dublagem"
                                  className="h-1 w-full cursor-pointer accent-white"
                                />
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Popover: Seletor Manual de Fontes */}
                    {activePopover === 'sources' && (
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/60">
                            Fontes disponíveis
                          </p>
                          <span className="text-[11px] text-white/50 tabular-nums">
                            {streams.length}
                          </span>
                        </div>
                        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
                          {streams.map((stream, idx) => {
                            const selected = idx === activeStreamIndex;
                            const containerLabel =
                              stream.containerTag ||
                              (stream.isBrowserFriendly ? 'MP4' : stream.codecHint === 'MKV/HEVC' ? 'MKV' : null);

                            return (
                              <button
                                key={stream.id}
                                type="button"
                                onClick={() => handleSelectSource(idx)}
                                className={`flex w-full items-start justify-between gap-2 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                                  selected
                                    ? 'border-white/20 bg-white/12 text-white'
                                    : 'border-transparent text-white/75 hover:bg-white/[0.06] hover:text-white'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold tabular-nums">
                                    <span className="text-white">
                                      {stream.resolution || stream.quality}
                                    </span>
                                    {stream.size && (
                                      <span className="font-normal text-white/70">
                                        · {stream.size}
                                      </span>
                                    )}
                                    {stream.seeders !== undefined && (
                                      <span className="font-normal text-white/70">
                                        · 👤 {stream.seeders}
                                      </span>
                                    )}
                                    {containerLabel && (
                                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-white/90">
                                        {containerLabel}
                                      </span>
                                    )}
                                    {stream.audioTags?.slice(0, 2).map((tag) => (
                                      <span
                                        key={tag}
                                        className="rounded bg-white/15 px-1.5 py-0.5 text-[9px] font-semibold text-white"
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                  <p className="mt-1 truncate text-[11px] text-white/55">
                                    {stream.releaseTitle || stream.name}
                                  </p>
                                </div>
                                {selected && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Barra de Progresso Interativa */}
              <div className="mb-3 flex items-center gap-3">
                <span className="w-12 text-right font-mono text-xs text-white/80 tabular-nums">
                  {formatTime(displayTime)}
                </span>

                <div className="relative flex flex-1 items-center">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                    <div
                      className="h-full bg-white transition-[width] duration-100"
                      style={{ width: `${progressRatio}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={effectiveDuration || 0}
                    step={1}
                    value={Math.min(displayTime, effectiveDuration || displayTime)}
                    onChange={(e) => handleSeekBarChange(Number(e.target.value))}
                    aria-label="Linha do tempo"
                    className="absolute inset-0 h-5 w-full cursor-pointer opacity-0"
                  />
                </div>

                <span className="w-12 font-mono text-xs text-white/60 tabular-nums">
                  {formatTime(effectiveDuration)}
                </span>
              </div>

              {/* Linha de Botões */}
              <div className="flex items-center justify-between gap-3">
                {/* Esquerda: Play, -10s, +10s, Volume */}
                <div className="flex items-center gap-1.5 sm:gap-2.5">
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                    className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-zinc-950 transition-transform hover:bg-zinc-200 active:scale-95"
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4 fill-zinc-950" />
                    ) : (
                      <Play className="h-4 w-4 translate-x-[1px] fill-zinc-950" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(-10)}
                    aria-label="Voltar 10 segundos"
                    title="Voltar 10s (←)"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => seekBy(10)}
                    aria-label="Avançar 10 segundos"
                    title="Avançar 10s (→)"
                    className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <RotateCw className="h-4 w-4" />
                  </button>

                  {/* Volume */}
                  <div className="hidden items-center gap-2 sm:flex">
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-label={muted ? 'Ativar som' : 'Silenciar'}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {muted || volume === 0 ? (
                        <VolumeX className="h-4 w-4" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={muted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      aria-label="Volume"
                      className="h-1 w-20 cursor-pointer accent-white"
                    />
                  </div>
                </div>

                {/* Direita: Fontes, Áudio, Legendas, Tela cheia */}
                <div className="flex items-center gap-1 sm:gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setActivePopover((prev) => (prev === 'sources' ? null : 'sources'))
                    }
                    aria-label="Selecionar fonte"
                    title="Fontes"
                    className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors ${
                      activePopover === 'sources'
                        ? 'bg-white text-zinc-950'
                        : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Server className="h-4 w-4" />
                    <span className="hidden md:inline">Fontes</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setActivePopover((prev) => (prev === 'audio' ? null : 'audio'))
                    }
                    aria-label="Áudio e Dublagem"
                    title="Áudio"
                    className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors ${
                      activePopover === 'audio'
                        ? 'bg-white text-zinc-950'
                        : aiDubbingActive
                          ? 'bg-white/15 text-white hover:bg-white/20'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Volume2 className="h-4 w-4" />
                    <span className="hidden md:inline">Áudio</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setActivePopover((prev) => (prev === 'subtitles' ? null : 'subtitles'))
                    }
                    aria-label="Legendas e sincronia"
                    title="Legendas"
                    className={`flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium transition-colors ${
                      activePopover === 'subtitles'
                        ? 'bg-white text-zinc-950'
                        : subtitlesEnabled && subtitle?.url
                          ? 'bg-white/15 text-white hover:bg-white/20'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Subtitles className="h-4 w-4" />
                    <span className="hidden md:inline">Legendas</span>
                  </button>

                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
                    title="Tela cheia (F)"
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {isFullscreen ? (
                      <Minimize className="h-4 w-4" />
                    ) : (
                      <Maximize className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
