# Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere ao [Versionamento Semântico](https://semver.org/lang/pt-BR/).

## [0.2.0] - 2026-11-26

### Adicionado
- **Instalador Windows autossuficiente (NSIS / Tauri v2)**:
  - Empacota o servidor local (`playhub-server`), `ffmpeg` e `ffprobe`, iniciando sem janela de console (`CREATE_NO_WINDOW`) com logs em `%APPDATA%\...\server.log` e encerrando toda a árvore de processos ao fechar o app.
  - Smoke test automático do sidecar (`/api/health`) no workflow de Release do GitHub Actions antes de gerar o instalador.
- **Catálogo TMDB completo + Proxy local**:
  - Tela de detalhes Full-View com slideshow, elenco, barra de temporadas temática e efeito Ambilight nos cards.
  - Proxy server-side para API e imagens do TMDB.
- **Player Híbrido e Nativo aprimorado**:
  - Controle de proporção de tela (`16:9`, `4:3`, `21:9`, Preencher e Esticar) e envio para players externos VLC/MPV (`.m3u`).
- **Legendas PT-BR inteligentes**:
  - Separação entre `PT-BR` e `PT-PT`, extração de legendas embutidas em MKV, busca multi-fonte, tradução automática e upload de arquivos `.srt`/`.ass`.
- **Downloads e Modo Offline**:
  - Download de filmes e episódios com legenda `PT-BR` salva automaticamente em `Downloads\PlayHub` para reprodução sem internet.
- **Catálogo de Add-ons integrado**:
  - Lista curada embutida com instalação em 1 clique para **Torrentio**, **Comet**, **MediaFusion**, **Brazuca Torrents**, **Peerflix** e **OpenSubtitles v3**, mesclada com o diretório comunitário via backend.

### Corrigido
- Links externos (`IMDb`, `TMDB`, etc.) agora abrem no navegador padrão do Windows dentro do WebView2 do Tauri (`@tauri-apps/plugin-shell` + interceptador global).
- Padronização de todas as chamadas da API local para `http://127.0.0.1:3001` com retry automático (3 tentativas × 1s) durante a inicialização do sidecar.

## [0.1.0] - 2026-11-26

### Adicionado
- **Catálogo Completo TMDB**:
  - Home editorial com trilhos (*Continuar Assistindo*, *Em Alta*, *Filmes Populares*, *Séries em Destaque*, *Mais Bem Avaliados* e *Lançamentos*) e atalho "Ver tudo".
  - Abas **Filmes** e **Séries** com scroll infinito via `/discover/movie` e `/discover/tv`, contador real de `total_results` e filtros por gênero, ordenação e ano.
  - Busca global (`Ctrl+K`) com paginação e resolução direta de IDs (`tt...`) e URLs do IMDb.
- **Player Híbrido (Nativo + Embed `imdb.su`)**:
  - Streaming P2P via `torrent-stream` (DHT + lista reforçada de trackers públicos) com streaming direto via HTTP `Range` (`206`) para MP4 compatível.
  - Remux/Transcode em tempo real via FFmpeg (`h264_nvenc` com fallback automático para `libx264`) para `.mkv`, `.avi`, HEVC, AC3/EAC3 e DTS.
  - Seek real em streams transcodificados usando `ffprobe` (`/api/torrent-meta`), fast input seek (`-ss` antes de `-i`), debounce de 250ms e retomada sincronizada de progresso.
  - Modo Embed (`imdb.su`) com alternância instantânea e opção de modo padrão (Nativo ou Embed) nas Configurações.
- **Agregador Multi-Fontes**:
  - Suporte a add-ons Stremio com normalização automática de `stremio://`, leitura do nome real no `manifest.json` e carregamento automático de listas de add-ons por URL.
  - Integração com YTS, EZTV, APIBay e indexadores Torznab, com parser de resolução (`4K`/`1080p`/`720p`/`480p`), seeders, tamanho e tags de áudio (`PT-BR`, `DUAL`, `DUBLADO`, `MULTI`).
- **Idioma do Sistema, Legendas e Dublagem Neural**:
  - Detecção automática de idioma via `navigator.language` (`src/utils/locale.ts`) aplicada ao catálogo, OpenSubtitles, tradução automática e vozes Edge-TTS.
  - Sincronização de legendas VTT com deslocamento de timestamp (`?offset=`) em buscas de tempo e prevenção de duplicidade de legendas no modo Embed.
  - Dublagem Neural via `msedge-tts` (`/api/tts`) sincronizada com as legendas e com reinicialização limpa durante seek.
- **Persistência, Onboarding e Chave TMDB Dinâmica**:
  - Sincronização automática de configurações em disco (`server/data/store.json` via `GET/PUT /api/config`) entre navegadores.
  - Exportação e importação em JSON com opção para incluir ou omitir a chave pessoal do TMDB.
  - Configuração dinâmica da chave TMDB (v3 ou token v4) pela interface e Guia Inicial interativo de Primeiro Uso.
- **Preparação para GitHub e Releases**:
  - Configuração de `.gitignore`, `.env.example`, `README.md` completo e `CHANGELOG.md`.
