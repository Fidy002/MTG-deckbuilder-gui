import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { SettingsService } from '../settings/settings.service';
import { en, Translations } from './translations/en';
import { UI_LANGUAGES } from './ui-languages';

type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Paths<Translations>;
export type TranslationParams = Record<string, string | number>;

@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly settings = inject(SettingsService);
  private readonly document = inject(DOCUMENT);

  readonly languages = UI_LANGUAGES;
  readonly language = this.settings.uiLanguage.asReadonly();

  private readonly translations = signal<Translations>(en);

  constructor() {
    effect(() => {
      const code = this.language();
      this.document.documentElement.lang = code;
      const language = UI_LANGUAGES.find((l) => l.code === code);
      language?.load().then((translations) => {
        if (this.language() === code) {
          this.translations.set(translations);
        }
      });
    });
  }

  setLanguage(code: string): void {
    this.settings.uiLanguage.set(code);
  }

  translate(key: TranslationKey, params?: TranslationParams): string {
    const text = lookup(this.translations(), key) ?? lookup(en, key) ?? key;
    if (!params) {
      return text;
    }
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match,
    );
  }
}

function lookup(translations: Translations, key: string): string | undefined {
  let node: unknown = translations;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}
