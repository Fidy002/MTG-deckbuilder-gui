import { Component, computed, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { CARD_LANGUAGES, cardLanguageName } from '../scryfall/card-languages';
import { SettingsService } from './settings.service';

@Component({
  selector: 'app-language-settings',
  imports: [TranslatePipe],
  template: `
    <label>
      <span>{{ 'settings.uiLanguage' | t }}</span>
      <select (change)="i18n.setLanguage(selectValue($event))">
        @for (language of i18n.languages; track language.code) {
          <option [value]="language.code" [selected]="language.code === i18n.language()">
            {{ language.nativeName }}
          </option>
        }
      </select>
    </label>
    <label>
      <span>{{ 'settings.cardLanguage' | t }}</span>
      <select (change)="settings.cardLanguage.set(selectValue($event))">
        @for (language of cardLanguages(); track language.code) {
          <option [value]="language.code" [selected]="language.code === settings.cardLanguage()">
            {{ language.name }}
          </option>
        }
      </select>
    </label>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    label {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.8rem;
      color: var(--text-muted);
    }
  `,
})
export class LanguageSettings {
  protected readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);

  protected readonly cardLanguages = computed(() => {
    const uiLanguage = this.i18n.language();
    return CARD_LANGUAGES.map((l) => ({
      code: l.scryfallCode,
      name: cardLanguageName(l.scryfallCode, uiLanguage),
    }));
  });

  protected selectValue(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
