export interface CardLanguage {
  scryfallCode: string;
  bcp47: string;
}

export const CARD_LANGUAGES: readonly CardLanguage[] = [
  { scryfallCode: 'en', bcp47: 'en' },
  { scryfallCode: 'de', bcp47: 'de' },
  { scryfallCode: 'fr', bcp47: 'fr' },
  { scryfallCode: 'it', bcp47: 'it' },
  { scryfallCode: 'es', bcp47: 'es' },
  { scryfallCode: 'pt', bcp47: 'pt' },
  { scryfallCode: 'ja', bcp47: 'ja' },
  { scryfallCode: 'ko', bcp47: 'ko' },
  { scryfallCode: 'ru', bcp47: 'ru' },
  { scryfallCode: 'zhs', bcp47: 'zh-Hans' },
  { scryfallCode: 'zht', bcp47: 'zh-Hant' },
];

export const DEFAULT_CARD_LANGUAGE = 'en';

export function cardLanguageName(scryfallCode: string, uiLanguage: string): string {
  const language = CARD_LANGUAGES.find((l) => l.scryfallCode === scryfallCode);
  if (!language) {
    return scryfallCode;
  }
  try {
    return new Intl.DisplayNames([uiLanguage], { type: 'language' }).of(language.bcp47) ?? scryfallCode;
  } catch {
    return scryfallCode;
  }
}
