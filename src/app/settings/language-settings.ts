import { Component, computed, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { CARD_LANGUAGES, cardLanguageName } from '../scryfall/card-languages';
import { LanguageOption, LanguageSelect } from './language-select';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-language-settings',
  imports: [TranslatePipe, LanguageSelect],
  template: `
    <app-language-select
      [label]="'settings.uiLanguage' | t"
      [options]="uiLanguages"
      [value]="i18n.language()"
      (valueChange)="i18n.setLanguage($event)"
    />
    <app-language-select
      [label]="'settings.cardLanguage' | t"
      [options]="cardLanguages()"
      [value]="settings.cardLanguage()"
      (valueChange)="settings.cardLanguage.set($event)"
    />
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-5);
    }
  `,
})
export class LanguageSettings {
  protected readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);

  protected readonly uiLanguages: LanguageOption[] = this.i18n.languages.map((l) => ({
    code: l.code,
    label: l.nativeName,
    flag: l.flag,
  }));

  protected readonly cardLanguages = computed(() => cardLanguageOptions(this.i18n.language()));
}

export function cardLanguageOptions(uiLanguage: string): LanguageOption[] {
  return CARD_LANGUAGES.map((l) => ({
    code: l.scryfallCode,
    label: cardLanguageName(l.scryfallCode, uiLanguage),
    flag: l.flag,
  }));
}
