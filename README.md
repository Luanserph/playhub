<p align="center">
  <img src="./public/favicon.svg" alt="PlayHub" width="76" height="76" />
</p>

<h1 align="center">PlayHub</h1>

<p align="center">
  Catálogo editorial limpo e reprodução instantânea de filmes e séries, unindo a praticidade do <code>imdb.su</code> com um player nativo e experiência de cinema em casa.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-em%20desenvolvimento%20ativo-18181B?style=flat-square" alt="Em desenvolvimento ativo" />
  <img src="https://img.shields.io/badge/React%20%2B%20Fastify-TypeScript-27272A?style=flat-square" alt="React + Fastify TypeScript" />
</p>

> **Aviso:** o PlayHub está em **desenvolvimento ativo**, recebendo melhorias frequentes na interface, fontes e player — e em breve ganhará builds instaláveis para Windows e Android.

---

## O que o PlayHub faz hoje

- **Catálogo TMDB completo com proxy e cache local:** carrega filmes, séries, detalhes em tela cheia (com slideshow de backdrops, logo oficial, elenco, ficha técnica, temporadas/episódios e títulos semelhantes) usando proxy server-side (`/api/tmdb` e `/api/tmdb-image`) com cache em memória e fallback automático.
- **Busca Spotlight (`Ctrl+K`):** pesquise instantaneamente por nome ou cole direto um link/ID do IMDb (ex: `tt0371746`).
- **Player Nativo + Modo Híbrido (`imdb.su`):**
  - Reprodução P2P local com `torrent-stream` + remux/transcode inteligente via FFmpeg (com suporte a NVENC quando disponível), seek rápido e controle de **Proporção de Tela** (`Ajustar`, `Preencher`, `Esticar`, `16:9`, `4:3`, `21:9`).
  - Alternância com 1 clique para o modo **Embed (`imdb.su`)** quando preferir iniciar sem esperar peers.
  - **Up Next automático** nos últimos 30 segundos de episódios de séries.
- **Legendas Multi-Fonte e Upload Local:**
  - Busca paralela no **OpenSubtitles**, **Wyzie Subs** e faixas **embutidas no próprio MKV/MP4** (extraídas sob demanda via `ffprobe`/`ffmpeg`).
  - Separação estrita entre **PT-BR** real (`pob`/`pt-br`) e **PT-PT** (`por`), com tradução automática **IA PT-BR** quando não houver legenda brasileira nativa.
  - Suporte a upload próprio e arrastar-e-soltar (`.srt`, `.vtt` e `.ass`), ajuste de tamanho (`P` / `M` / `G`) e sincronia (`-0.5s` / `+0.5s`).
- **Dublagem Neural opcional (Edge-TTS):** sintetiza falas a partir da legenda ativa com redução suave do áudio original (audio ducking) e pré-carregamento.
- **Player Externo (VLC / MPV):** baixa um arquivo `playhub-stream.m3u` apontando direto para o stream bruto (`/api/torrent-raw`), copia o link do vídeo ou exporta a legenda ativa em `.srt`.
- **Downloads e Biblioteca Offline (com legenda PT-BR automática):** baixe filmes e episódios direto para a sua pasta local (com pausa, retomada real por peças verificadas, download automático da legenda `PT-BR` junto ao vídeo e reprodução 100% offline com suporte a `Range`/FFmpeg).
- **Sincronização e Backup JSON:** listas, histórico ("Continuar Assistindo" em 16:9), notas, preferências e add-ons sincronizam localmente e podem ser exportados/importados em JSON.

---

## Atalhos do Player

| Tecla | Ação |
| :---: | :--- |
| `Espaço` / `K` | Pausar ou continuar |
| `←` / `→` | Voltar ou avançar 10 segundos |
| `A` | Alternar proporção de tela (Aspect Ratio) |
| `C` | Ligar ou desligar legendas |
| `G` / `H` | Ajustar delay da legenda (`-0.5s` / `+0.5s`) |
| `M` | Silenciar / ativar som |
| `F` | Tela cheia |
| `Esc` | Fechar popover ou sair do player |

---

## Como rodar localmente

Você só precisa do **Node.js 20+** instalado (e `ffmpeg` no PATH caso queira remux/transcode de MKV e extração de legendas embutidas).

### 1. Instale as dependências (frontend e backend)

```bash
npm install
cd server && npm install && cd ..
```

### 2. Inicie o backend e o frontend

Em um terminal, suba o servidor local (`http://127.0.0.1:3001`):

```bash
cd server
npm run dev
```

Em outro terminal, suba a interface web (`http://localhost:5173`):

```bash
npm run dev
```

### 3. Conecte sua chave gratuita do TMDB

Não é necessário editar arquivos `.env`. Ao abrir o PlayHub pela primeira vez, o **Guia Inicial** aparece automaticamente: basta colar sua **API Key (v3)** ou **Token de Leitura (v4)** do TMDB e clicar em **Testar e Salvar** — o catálogo carrega na hora.

---

## Próximos passos (Roadmap)

- [ ] **Instalador Windows Tudo-em-Um (Tauri `.exe`):** app desktop nativo empacotando interface, servidor local e FFmpeg — sem precisar instalar Node ou configurar nada manualmente.
- [ ] **App Android (APK):** versão mobile dedicada para assistir na palma da mão ou transmitir na TV.
- [ ] **Mais fontes e refinamentos:** novos provedores, melhorias contínuas na detecção de faixas e ajustes finos na interface.
