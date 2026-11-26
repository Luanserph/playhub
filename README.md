# PlayHub

Catálogo editorial minimalista de filmes e séries com **Player Híbrido** (Player Nativo P2P/HLS com `torrent-stream` + FFmpeg/NVENC e Modo Embed `imdb.su`), agregador multi-fontes, legendas automáticas traduzidas no idioma do sistema e Dublagem Neural via Edge-TTS.

---

## Recursos Atuais

- **Catálogo Completo TMDB com Scroll Infinito**
  - Home editorial com trilhos (*Continuar Assistindo*, *Em Alta*, *Filmes Populares*, *Séries em Destaque*, *Mais Bem Avaliados* e *Lançamentos*) e atalho **Ver tudo**.
  - Abas **Filmes** e **Séries** baseadas em `/discover` com scroll infinito e filtros por gênero, ordenação e ano.
  - **Busca Inteligente (`Ctrl+K`)**: pesquise por título ou cole diretamente um **ID (`tt...`) ou link do IMDb** para abrir o título imediatamente.
- **Player Nativo (`torrent-stream` + FFmpeg/NVENC) & Seek Real**
  - Streaming P2P direto no navegador via `torrent-stream` com DHT e trackers públicos reforçados.
  - Remux/Transcode em tempo real via FFmpeg (com aceleração GPU `h264_nvenc` para HEVC e fallback automático para `libx264` em CPU) para arquivos `.mkv`/`.avi`/HEVC/AC3/EAC3/DTS, mantendo streaming direto via `Range` (`206`) para MP4 compatível.
  - **Seek rápido real**: duração real detectada via `ffprobe`, seek preciso na barra de progresso (`+10s`/`-10s` e setas) usando fast input seek (`-ss` antes de `-i`) e retomada automática do ponto salvo em *Continuar Assistindo*.
- **Modo Híbrido (`imdb.su`)**
  - Alternância instantânea entre **Player Nativo** e **Modo Embed (`imdb.su`)**, com preferência configurável nas Configurações (Modo Nativo ou Embed como padrão) e troca rápida de fontes sem travar a interface.
- **Agregador Multi-Fontes**
  - Suporte a **Add-ons Stremio** (com normalização automática de `stremio://` e carregamento automático de listas de add-ons via URL), além de fontes integradas **YTS**, **EZTV**, **APIBay** e indexadores **Torznab** (Jackett/Prowlarr).
  - Classificação e metadados precisos por resolução (`4K`/`1080p`/`720p`/`480p`), seeders, tamanho e tags de áudio (`PT-BR`, `DUAL`, `DUBLADO`, `MULTI`, etc.).
- **Legendas Automáticas & Tradução pelo Idioma do Sistema**
  - Detecção automática do idioma do sistema (`navigator.language`) aplicada ao catálogo TMDB, busca de legendas (OpenSubtitles), tradução automática e seleção de vozes neurais.
  - Sincronização de legendas VTT com o offset de seek (`&offset=`) e prevenção de duplicidade no modo Embed.
- **Dublagem Neural (Edge-TTS)**
  - Narração sincronizada por faixa de legenda usando `msedge-tts` com seleção de voz feminina/masculina no idioma ativo e reinicialização limpa ao avançar/retroceder o vídeo.
- **Sincronização Local & Backup JSON**
  - Estado persistido automaticamente em disco no backend (`server/data/store.json`), sincronizando add-ons, preferências, favoritos, avaliações, histórico e chave TMDB entre navegadores (Chrome, Brave, Edge).
  - Exportação e importação em JSON nas Configurações, com opção de incluir ou omitir a chave pessoal do TMDB no backup.

---

## Pré-requisitos

- **Node.js** 20+ (com `npm`)
- **FFmpeg** e **FFprobe** instalados e disponíveis no `PATH` do sistema (necessário para remux/transcode em tempo real e detecção de duração de arquivos MKV/HEVC)
  - Verifique com:
    ```bash
    ffmpeg -version
    ffprobe -version
    ```

---

## Instalação e Execução

```bash
# 1. Instalar dependências do frontend (raiz do projeto)
npm install

# 2. Instalar dependências do backend
cd server
npm install
cd ..
```

Para rodar em modo de desenvolvimento, abra **dois terminais**:

**Terminal 1 — Backend (porta `3001`):**
```bash
cd server
npm run dev
```

**Terminal 2 — Frontend (porta `5173`):**
```bash
npm run dev
```

Acesse `http://localhost:5173` no navegador.

### Build de Produção

```bash
# Frontend
npm run build

# Backend
cd server
npm run build
npm start
```

---

## Primeiro Uso

Não é necessário editar nenhum arquivo `.env` para começar a usar o PlayHub:

1. Inicie o backend e o frontend e abra `http://localhost:5173`.
2. Na primeira execução (sem chave TMDB configurada), o **Guia Inicial do PlayHub** abrirá automaticamente.
3. Crie uma conta gratuita no [TMDB](https://www.themoviedb.org/settings/api) e copie sua **Chave da API (v3)** ou **Token de Acesso de Leitura (v4)** — ambos os formatos são reconhecidos automaticamente.
4. Cole a chave no assistente inicial (ou depois em **Configurações → Conexão com Catálogo (TMDB)**) e clique em **Testar e Salvar**.
5. O catálogo será carregado imediatamente e a configuração ficará salva em `server/data/store.json`.

> Caso prefira configurar via variável de ambiente, copie `.env.example` para `.env` na raiz e preencha `VITE_TMDB_API_KEY` (usada como fallback caso nenhuma chave esteja salva nas Configurações).

---

## Roadmap

- [ ] **App Desktop Windows (Tauri)** — empacotamento nativo `.msi`/`.exe` com backend local embarcado e atualizações via GitHub Releases.
- [ ] **App Android APK (Capacitor)** — experiência mobile dedicada com suporte ao catálogo, player híbrido e sincronização de configurações.
