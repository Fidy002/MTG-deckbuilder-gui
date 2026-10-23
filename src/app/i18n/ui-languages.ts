import { Translations } from './translations/en';

export interface UiLanguage {
  code: string;
  nativeName: string;
  load: () => Promise<Translations>;
}

// To add a language: create `translations/<code>.ts` typed as `Translations` and register it here.
export const UI_LANGUAGES: readonly UiLanguage[] = [
  { code: 'en', nativeName: 'English', load: () => import('./translations/en').then((m) => m.en) },
  { code: 'de', nativeName: 'Deutsch', load: () => import('./translations/de').then((m) => m.de) },
];

export const DEFAULT_UI_LANGUAGE = 'en';
