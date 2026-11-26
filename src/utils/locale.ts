export type LanguagePreference = 'auto' | 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

export interface LanguageConfig {
  locale: 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';
  label: string;
  shortLabel: string;
  tmdbLang: string;
  iso2: string;
  openSubCodes: string[];
  ttsVoices: {
    female: string;
    male: string;
    femaleLabel: string;
    maleLabel: string;
  };
  matchTerms: string[];
}

export const SUPPORTED_LANGUAGES: Record<LanguageConfig['locale'], LanguageConfig> = {
  'pt-BR': {
    locale: 'pt-BR',
    label: 'Português (Brasil)',
    shortLabel: 'PT-BR',
    tmdbLang: 'pt-BR',
    iso2: 'pt',
    openSubCodes: ['pob', 'por'],
    ttsVoices: {
      female: 'pt-BR-FranciscaNeural',
      male: 'pt-BR-AntonioNeural',
      femaleLabel: 'Francisca',
      maleLabel: 'Antonio',
    },
    matchTerms: ['pt', 'por', 'pob', 'pt-br', 'ptbr', 'portugues', 'português', 'portuguese', 'brazil', 'brasil', 'br', 'dublado'],
  },
  'en-US': {
    locale: 'en-US',
    label: 'English (US)',
    shortLabel: 'EN-US',
    tmdbLang: 'en-US',
    iso2: 'en',
    openSubCodes: ['eng'],
    ttsVoices: {
      female: 'en-US-JennyNeural',
      male: 'en-US-GuyNeural',
      femaleLabel: 'Jenny',
      maleLabel: 'Guy',
    },
    matchTerms: ['en', 'eng', 'en-us', 'english', 'inglês', 'ingles'],
  },
  'es-ES': {
    locale: 'es-ES',
    label: 'Español',
    shortLabel: 'ES',
    tmdbLang: 'es-ES',
    iso2: 'es',
    openSubCodes: ['spa'],
    ttsVoices: {
      female: 'es-ES-ElviraNeural',
      male: 'es-ES-AlvaroNeural',
      femaleLabel: 'Elvira',
      maleLabel: 'Álvaro',
    },
    matchTerms: ['es', 'spa', 'es-es', 'es-mx', 'spanish', 'español', 'espanol', 'latino'],
  },
  'fr-FR': {
    locale: 'fr-FR',
    label: 'Français',
    shortLabel: 'FR',
    tmdbLang: 'fr-FR',
    iso2: 'fr',
    openSubCodes: ['fre', 'fra'],
    ttsVoices: {
      female: 'fr-FR-DeniseNeural',
      male: 'fr-FR-HenriNeural',
      femaleLabel: 'Denise',
      maleLabel: 'Henri',
    },
    matchTerms: ['fr', 'fre', 'fra', 'fr-fr', 'french', 'français', 'francais'],
  },
};

export function getSystemLocale(): string {
  if (typeof navigator !== 'undefined' && typeof navigator.language === 'string' && navigator.language.trim()) {
    return navigator.language.trim();
  }
  return 'pt-BR';
}

export function resolveLanguageConfig(localeOrPref: string): LanguageConfig {
  const raw = localeOrPref === 'auto' ? getSystemLocale() : localeOrPref;
  const normalized = (raw || 'pt-BR').trim().toLowerCase();

  if (normalized.startsWith('pt')) return SUPPORTED_LANGUAGES['pt-BR'];
  if (normalized.startsWith('en')) return SUPPORTED_LANGUAGES['en-US'];
  if (normalized.startsWith('es')) return SUPPORTED_LANGUAGES['es-ES'];
  if (normalized.startsWith('fr')) return SUPPORTED_LANGUAGES['fr-FR'];

  return SUPPORTED_LANGUAGES['pt-BR'];
}
