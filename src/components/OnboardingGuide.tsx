import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Loader2,
  Play,
  Search,
  Server,
  Subtitles,
  X,
} from 'lucide-react';
import { getTmdbKeySource, validateTmdbKey } from '../services/tmdb';

interface OnboardingGuideProps {
  open: boolean;
  onClose: () => void;
  tmdbApiKey: string;
  onSaveTmdbKey: (key: string) => void;
}

const TOTAL_STEPS = 4;

const stepVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 32 : -32,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -32 : 32,
    opacity: 0,
  }),
};

export function OnboardingGuide({
  open,
  onClose,
  tmdbApiKey,
  onSaveTmdbKey,
}: OnboardingGuideProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [keyInput, setKeyInput] = useState(tmdbApiKey);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const keySource = getTmdbKeySource();

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  const goToStep = (next: number) => {
    if (next < 0 || next >= TOTAL_STEPS) return;
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };

  const handleValidateAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || testing) return;
    setTesting(true);
    setKeyStatus('idle');
    try {
      const valid = await validateTmdbKey(keyInput);
      if (valid) {
        onSaveTmdbKey(keyInput.trim());
        setKeyStatus('success');
      } else {
        setKeyStatus('error');
      }
    } finally {
      setTesting(false);
    }
  };

  const progressPct = ((step + 1) / TOTAL_STEPS) * 100;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Guia inicial do PlayHub"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 bg-[var(--ph-backdrop-overlay)] backdrop-blur-md"
          />

          {/* Card Editorial */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-[var(--ph-border)] bg-[var(--ph-surface)] shadow-2xl"
          >
            {/* Barra de progresso minimalista no topo */}
            <div className="h-1 w-full bg-[var(--ph-surface-2)]">
              <motion.div
                className="h-full bg-[var(--ph-btn-primary-bg)]"
                initial={false}
                animate={{ width: `${progressPct}%` }}
                transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              />
            </div>

            {/* Cabeçalho */}
            <div className="flex items-center justify-between border-b border-[var(--ph-border)] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--ph-btn-primary-bg)] text-[var(--ph-btn-primary-fg)]">
                  <Play className="h-3 w-3 translate-x-[0.5px] fill-current" />
                </span>
                <div>
                  <p className="text-[13px] font-semibold tracking-tight text-[var(--ph-text)]">
                    Guia PlayHub
                  </p>
                  <p className="text-[11px] text-[var(--ph-text-muted)] tabular-nums">
                    Passo {step + 1} de {TOTAL_STEPS}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                aria-label="Fechar tutorial"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Conteúdo animado dos passos */}
            <div className="relative min-h-[340px] overflow-hidden px-6 py-6 sm:px-8">
              <AnimatePresence mode="wait" custom={direction}>
                {step === 0 && (
                  <motion.div
                    key="step-0"
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text)]">
                          <KeyRound className="h-4 w-4" />
                        </span>
                        <h2 className="text-lg font-semibold tracking-tight text-[var(--ph-text)]">
                          Conectar Catálogo (TMDB)
                        </h2>
                      </div>
                      <span className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--ph-text-muted)]">
                        {keySource === 'config'
                          ? 'Ativa via Configuração'
                          : keySource === 'env'
                            ? 'Ativa via .env'
                            : 'Pendente'}
                      </span>
                    </div>

                    <ol className="space-y-1.5 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                      <li>
                        <strong className="text-[var(--ph-text)]">1.</strong> Crie uma conta gratuita no TMDB e abra{' '}
                        <span className="text-[var(--ph-text)]">Configurações → API</span>.
                      </li>
                      <li>
                        <strong className="text-[var(--ph-text)]">2.</strong> Copie a{' '}
                        <span className="text-[var(--ph-text)]">Chave da API (v3)</span> ou o{' '}
                        <span className="text-[var(--ph-text)]">Token de Leitura (v4)</span>.
                      </li>
                      <li>
                        <strong className="text-[var(--ph-text)]">3.</strong> Cole abaixo e clique em{' '}
                        <span className="text-[var(--ph-text)]">Testar e Salvar</span>.
                      </li>
                    </ol>

                    <a
                      href="https://www.themoviedb.org/settings/api"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ph-text)] underline-offset-4 hover:underline"
                    >
                      <span>Abrir página de API do TMDB</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>

                    <form onSubmit={handleValidateAndSave} className="space-y-2.5 pt-1">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <input
                            type={showKey ? 'text' : 'password'}
                            value={keyInput}
                            onChange={(e) => {
                              setKeyInput(e.target.value);
                              if (keyStatus !== 'idle') setKeyStatus('idle');
                            }}
                            placeholder="Cole sua API Key v3 ou Token Bearer v4"
                            className="h-10 w-full rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] pl-3.5 pr-9 font-mono text-xs text-[var(--ph-text)] placeholder-[var(--ph-text-muted)] outline-none focus:border-[var(--ph-border-strong)]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowKey((prev) => !prev)}
                            aria-label={showKey ? 'Ocultar chave' : 'Mostrar chave'}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--ph-text-muted)] hover:text-[var(--ph-text)]"
                          >
                            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>

                        <button
                          type="submit"
                          disabled={testing || !keyInput.trim()}
                          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-4 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)] disabled:opacity-50"
                        >
                          {testing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          <span>{testing ? 'Testando...' : 'Testar e Salvar'}</span>
                        </button>
                      </div>

                      {keyStatus === 'success' && (
                        <p className="text-xs font-medium text-[var(--ph-text)]">
                          Chave validada e salva! O catálogo foi ativado automaticamente.
                        </p>
                      )}
                      {keyStatus === 'error' && (
                        <p className="text-xs text-[var(--ph-text-muted)]">
                          Chave inválida ou sem acesso ao TMDB. Verifique e tente novamente.
                        </p>
                      )}
                    </form>
                  </motion.div>
                )}

                {step === 1 && (
                  <motion.div
                    key="step-1"
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text)]">
                        <Search className="h-4 w-4" />
                      </span>
                      <h2 className="text-lg font-semibold tracking-tight text-[var(--ph-text)]">
                        Busca Inteligente (Ctrl+K)
                      </h2>
                    </div>

                    <p className="text-sm leading-relaxed text-[var(--ph-text-muted)]">
                      Pressione{' '}
                      <kbd className="rounded-md border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--ph-text)]">
                        Ctrl K
                      </kbd>{' '}
                      em qualquer tela para abrir a busca instantânea Spotlight.
                    </p>

                    <div className="space-y-2.5 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4 text-xs">
                      <div className="flex items-center justify-between gap-2 border-b border-[var(--ph-border)] pb-2.5">
                        <span className="text-[var(--ph-text-muted)]">Por título</span>
                        <span className="font-mono text-[var(--ph-text)]">Interestelar</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-b border-[var(--ph-border)] pb-2.5">
                        <span className="text-[var(--ph-text-muted)]">Por link completo do IMDb</span>
                        <span className="truncate font-mono text-[var(--ph-text)]">
                          imdb.com/title/tt0371746/
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[var(--ph-text-muted)]">Ou direto pelo ID</span>
                        <span className="font-mono text-[var(--ph-text)]">tt0371746</span>
                      </div>
                    </div>
                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div
                    key="step-2"
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text)]">
                        <Server className="h-4 w-4" />
                      </span>
                      <h2 className="text-lg font-semibold tracking-tight text-[var(--ph-text)]">
                        Modos de Reprodução
                      </h2>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4">
                        <p className="text-xs font-semibold text-[var(--ph-text)]">
                          Embed (imdb.su)
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                          Início instantâneo sem precisar configurar nada. Ideal para assistir direto no navegador.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-4">
                        <p className="text-xs font-semibold text-[var(--ph-text)]">
                          Player Nativo
                        </p>
                        <p className="mt-1.5 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                          Torrents em alta qualidade com YTS, EZTV, APIBay, add-ons Stremio e Torznab/Prowlarr + remux FFmpeg.
                        </p>
                      </div>
                    </div>

                    <p className="text-xs leading-relaxed text-[var(--ph-text-muted)]">
                      Você pode alternar entre <strong className="text-[var(--ph-text)]">Player Nativo</strong> e{' '}
                      <strong className="text-[var(--ph-text)]">Embed (imdb.su)</strong> com 1 clique na barra superior do player a qualquer momento.
                    </p>
                  </motion.div>
                )}

                {step === 3 && (
                  <motion.div
                    key="step-3"
                    custom={direction}
                    variants={stepVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    className="space-y-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] text-[var(--ph-text)]">
                        <Subtitles className="h-4 w-4" />
                      </span>
                      <h2 className="text-lg font-semibold tracking-tight text-[var(--ph-text)]">
                        Legendas, Dublagem e Backup
                      </h2>
                    </div>

                    <div className="space-y-2.5">
                      <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-3.5">
                        <p className="text-xs font-semibold text-[var(--ph-text)]">
                          Legendas automáticas no seu idioma
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                          Detecta o idioma do sistema, busca legendas nativas e traduz automaticamente quando necessário.
                        </p>
                      </div>

                      <div className="rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-3.5">
                        <p className="text-xs font-semibold text-[var(--ph-text)]">
                          Dublagem Neural IA opcional
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                          Ative no menu de Áudio do player para ouvir falas sintetizadas com vozes neurais e redução suave do áudio original.
                        </p>
                      </div>

                      <div className="flex items-start gap-2.5 rounded-2xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] p-3.5">
                        <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ph-text-muted)]" />
                        <div>
                          <p className="text-xs font-semibold text-[var(--ph-text)]">
                            Sincronização e Backup JSON
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-[var(--ph-text-muted)]">
                            Suas listas, notas e add-ons sincronizam entre navegadores e podem ser exportados/importados nas Configurações.
                          </p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Rodapé de navegação */}
            <div className="flex items-center justify-between gap-3 border-t border-[var(--ph-border)] px-6 py-4">
              <div className="flex items-center gap-2">
                {step > 0 ? (
                  <button
                    type="button"
                    onClick={() => goToStep(step - 1)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ph-border)] bg-[var(--ph-surface-2)] px-3.5 text-xs font-medium text-[var(--ph-text)] transition-colors hover:bg-[var(--ph-hover)]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Anterior</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 rounded-xl px-2.5 text-xs font-medium text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
                  >
                    Pular por enquanto
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {step > 0 && step < TOTAL_STEPS - 1 && (
                  <button
                    type="button"
                    onClick={onClose}
                    className="h-9 rounded-xl px-2.5 text-xs font-medium text-[var(--ph-text-muted)] transition-colors hover:text-[var(--ph-text)]"
                  >
                    Pular
                  </button>
                )}

                {step < TOTAL_STEPS - 1 ? (
                  <button
                    type="button"
                    onClick={() => goToStep(step + 1)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-4 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
                  >
                    <span>Próximo</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ph-btn-primary-bg)] px-5 text-xs font-semibold text-[var(--ph-btn-primary-fg)] transition-colors hover:bg-[var(--ph-btn-primary-hover)]"
                  >
                    <span>Começar a usar</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
