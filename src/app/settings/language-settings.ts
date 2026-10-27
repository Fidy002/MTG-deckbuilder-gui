import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { CARD_LANGUAGES, cardLanguageName } from '../scryfall/card-languages';
import { Flag } from './flag';
import { LanguageOption, LanguageSelect } from './language-select';
import { SettingsService } from './settings.service';

// A small flag button in the header; both language selects open in a popup below it.
@Component({
  selector: 'app-language-settings',
  imports: [NgTemplateOutlet, TranslatePipe, Flag, LanguageSelect],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'open.set(false)',
  },
  template: `
    <button
      type="button"
      class="trigger"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="summary()"
      [title]="summary()"
      (click)="open.set(!open())"
    >
      <ng-container *ngTemplateOutlet="flag; context: { $implicit: uiOption() }" />
      @if (!sameLanguage()) {
        <span class="separator" aria-hidden="true">/</span>
        <ng-container *ngTemplateOutlet="flag; context: { $implicit: cardOption() }" />
      }
    </button>

    @if (open()) {
      <div class="panel popup" role="dialog" [attr.aria-label]="'settings.languages' | t">
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
      </div>
    }

    <ng-template #flag let-option>
      @if (option?.flag) {
        <app-flag [code]="option.flag" />
      } @else {
        <svg class="icon globe" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
        </svg>
      }
    </ng-template>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .trigger {
      gap: var(--space-2);
      padding: 0 var(--space-3);
      background: var(--color-surface-sunken);
    }
    .separator {
      color: var(--color-text-faint);
    }
    .globe {
      width: 20px;
      height: 15px;
      color: var(--color-text-muted);
    }
    .popup {
      position: absolute;
      top: 100%;
      right: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      min-width: 14rem;
      margin-top: var(--space-1);
      padding: var(--space-4);
      border-color: var(--color-line-strong);
    }
  `,
})
export class LanguageSettings {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly i18n = inject(I18nService);
  protected readonly settings = inject(SettingsService);

  protected readonly open = signal(false);

  protected readonly uiLanguages: LanguageOption[] = this.i18n.languages.map((l) => ({
    code: l.code,
    label: l.nativeName,
    flag: l.flag,
  }));

  protected readonly cardLanguages = computed(() => cardLanguageOptions(this.i18n.language()));

  protected readonly uiOption = computed(() => this.uiLanguages.find((o) => o.code === this.i18n.language()));
  protected readonly cardOption = computed(() => this.cardLanguages().find((o) => o.code === this.settings.cardLanguage()));
  // One flag when UI and cards use the same language, otherwise "UI flag / card flag".
  protected readonly sameLanguage = computed(() => !!this.uiOption()?.flag && this.uiOption()?.flag === this.cardOption()?.flag);

  protected readonly summary = computed(
    () =>
      `${this.i18n.translate('settings.uiLanguage')}: ${this.uiOption()?.label ?? ''} · ` +
      `${this.i18n.translate('settings.cardLanguage')}: ${this.cardOption()?.label ?? ''}`,
  );

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}

export function cardLanguageOptions(uiLanguage: string): LanguageOption[] {
  return CARD_LANGUAGES.map((l) => ({
    code: l.scryfallCode,
    label: cardLanguageName(l.scryfallCode, uiLanguage),
    flag: l.flag,
  }));
}
