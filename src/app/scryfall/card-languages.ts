import { FlagCode } from '../settings/flag';

export interface CardLanguage {
  scryfallCode: string;
  bcp47: string;
  flag: FlagCode;
}

export const CARD_LANGUAGES: readonly CardLanguage[] = [
  { scryfallCode: 'en', bcp47: 'en', flag: 'gb' },
  { scryfallCode: 'de', bcp47: 'de', flag: 'de' },
  { scryfallCode: 'fr', bcp47: 'fr', flag: 'fr' },
  { scryfallCode: 'it', bcp47: 'it', flag: 'it' },
  { scryfallCode: 'es', bcp47: 'es', flag: 'es' },
  { scryfallCode: 'pt', bcp47: 'pt', flag: 'br' },
  { scryfallCode: 'ja', bcp47: 'ja', flag: 'jp' },
  { scryfallCode: 'ko', bcp47: 'ko', flag: 'kr' },
  { scryfallCode: 'ru', bcp47: 'ru', flag: 'ru' },
  { scryfallCode: 'zhs', bcp47: 'zh-Hans', flag: 'cn' },
  { scryfallCode: 'zht', bcp47: 'zh-Hant', flag: 'tw' },
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
