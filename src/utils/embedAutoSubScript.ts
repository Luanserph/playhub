import { resolveLanguageConfig } from './locale';

/**
 * Gera um script JS leve e autônomo para injeção em WebViews nativas
 * (Tauri no PC e Capacitor no Android) sobre o player embed.
 *
 * 1. Observa qualquer <video> carregado no DOM e ativa automaticamente
 *    a primeira TextTrack cujo language/label combine com o idioma do sistema.
 * 2. Caso nenhuma faixa nativa esteja ativa após 3 segundos, procura com
 *    segurança controles/itens de menu de legenda compatíveis com o idioma.
 */
export function buildEmbedAutoSubScript(locale: string): string {
  const config = resolveLanguageConfig(locale);
  const serializedTerms = JSON.stringify(config.matchTerms);

  return `(function () {
  if (window.__playhubAutoSubInjected) return;
  window.__playhubAutoSubInjected = true;

  var TERMS = ${serializedTerms};
  var CC_BUTTON_HINTS = ['subtitle', 'subtitles', 'caption', 'captions', 'legenda', 'legendas', 'cc'];

  function normalize(str) {
    return (str || '')
      .toString()
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function matchesTargetLang(value) {
    var text = normalize(value);
    if (!text) return false;
    for (var i = 0; i < TERMS.length; i++) {
      var term = normalize(TERMS[i]);
      if (!term) continue;
      if (text === term || text.indexOf(term) !== -1) {
        return true;
      }
    }
    return false;
  }

  function hasActiveTrack(video) {
    if (!video || !video.textTracks) return false;
    for (var i = 0; i < video.textTracks.length; i++) {
      if (video.textTracks[i].mode === 'showing') return true;
    }
    return false;
  }

  function tryActivateNativeTrack(video) {
    if (!video || !video.textTracks || video.textTracks.length === 0) return false;
    if (hasActiveTrack(video)) return true;

    for (var i = 0; i < video.textTracks.length; i++) {
      var track = video.textTracks[i];
      if (!track) continue;
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      if (matchesTargetLang(track.language) || matchesTargetLang(track.label)) {
        for (var j = 0; j < video.textTracks.length; j++) {
          if (video.textTracks[j] !== track && video.textTracks[j].mode === 'showing') {
            video.textTracks[j].mode = 'disabled';
          }
        }
        track.mode = 'showing';
        return true;
      }
    }
    return false;
  }

  function bindVideo(video) {
    if (!video || video.__playhubSubBound) return;
    video.__playhubSubBound = true;

    tryActivateNativeTrack(video);
    video.addEventListener('loadedmetadata', function () {
      tryActivateNativeTrack(video);
    });
    if (video.textTracks && video.textTracks.addEventListener) {
      video.textTracks.addEventListener('addtrack', function () {
        tryActivateNativeTrack(video);
      });
    }
  }

  function scanVideos() {
    var videos = document.querySelectorAll('video');
    var activated = false;
    for (var i = 0; i < videos.length; i++) {
      bindVideo(videos[i]);
      if (tryActivateNativeTrack(videos[i])) activated = true;
    }
    return activated;
  }

  function trySelectFromPlayerMenu() {
    var videos = document.querySelectorAll('video');
    for (var v = 0; v < videos.length; v++) {
      if (hasActiveTrack(videos[v])) return;
    }

    // Procura itens de menu de idioma já presentes no DOM (seguro: apenas button/[role=menuitem]/[role=option]/li)
    var menuItems = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], button, li');
    for (var i = 0; i < menuItems.length; i++) {
      var el = menuItems[i];
      if (!el || el.offsetParent === null) continue;
      var text = normalize(el.textContent || el.getAttribute('aria-label') || '');
      if (text.length > 0 && text.length <= 32 && matchesTargetLang(text)) {
        el.click();
        return;
      }
    }

    // Se o menu estiver fechado, tenta abrir o botão de CC/Legendas de forma segura e selecionar o idioma
    var buttons = document.querySelectorAll('button, [role="button"]');
    for (var b = 0; b < buttons.length; b++) {
      var btn = buttons[b];
      if (!btn || btn.offsetParent === null) continue;
      var label = normalize(
        (btn.getAttribute('aria-label') || '') + ' ' +
        (btn.getAttribute('title') || '') + ' ' +
        (btn.textContent || '')
      );
      var isCcBtn = CC_BUTTON_HINTS.some(function (h) {
        return label.indexOf(h) !== -1;
      });
      if (isCcBtn) {
        btn.click();
        setTimeout(function () {
          var options = document.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"], button, li');
          for (var k = 0; k < options.length; k++) {
            var opt = options[k];
            if (!opt || opt.offsetParent === null) continue;
            var optText = normalize(opt.textContent || opt.getAttribute('aria-label') || '');
            if (optText.length > 0 && optText.length <= 32 && matchesTargetLang(optText)) {
              opt.click();
              return;
            }
          }
        }, 350);
        return;
      }
    }
  }

  scanVideos();

  var observer = new MutationObserver(function () {
    scanVideos();
  });
  if (document.documentElement) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  setTimeout(function () {
    if (!scanVideos()) {
      trySelectFromPlayerMenu();
    }
  }, 3000);
})();`;
}
