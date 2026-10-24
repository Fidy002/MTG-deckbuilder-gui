import { Injectable, effect, signal } from '@angular/core';
import { DEFAULT_UI_LANGUAGE, UI_LANGUAGES } from '../i18n/ui-languages';
import { CARD_LANGUAGES, DEFAULT_CARD_LANGUAGE } from '../scryfall/card-languages';

const STORAGE_KEY = 'mtg-deckbuilder.settings';

export type DeckSort = 'category' | 'type' | 'mana';
const DECK_SORTS: readonly DeckSort[] = ['category', 'type', 'mana'];

interface StoredSettings {
  uiLanguage?: string;
  cardLanguage?: string;
  deckSort?: DeckSort;
  legalityCheck?: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly stored = readStoredSettings();

  readonly uiLanguage = signal(
    validUiLanguage(this.stored.uiLanguage) ?? validUiLanguage(browserLanguage()) ?? DEFAULT_UI_LANGUAGE,
  );

  readonly cardLanguage = signal(
    validCardLanguage(this.stored.cardLanguage) ?? validCardLanguage(browserLanguage()) ?? DEFAULT_CARD_LANGUAGE,
  );

  readonly deckSort = signal<DeckSort>(
    DECK_SORTS.includes(this.stored.deckSort as DeckSort) ? this.stored.deckSort! : 'category',
  );

  readonly legalityCheck = signal(this.stored.legalityCheck ?? true);

  constructor() {
    effect(() => {
      const settings: StoredSettings = {
        uiLanguage: this.uiLanguage(),
        cardLanguage: this.cardLanguage(),
        deckSort: this.deckSort(),
        legalityCheck: this.legalityCheck(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
      }
    });
  }
}

function readStoredSettings(): StoredSettings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as StoredSettings;
  } catch {
    return {};
  }
}

function browserLanguage(): string | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.language?.split('-')[0];
}

function validUiLanguage(code: string | undefined): string | undefined {
  return UI_LANGUAGES.some((l) => l.code === code) ? code : undefined;
}

function validCardLanguage(code: string | undefined): string | undefined {
  return CARD_LANGUAGES.some((l) => l.scryfallCode === code) ? code : undefined;
}
