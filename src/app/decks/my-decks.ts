import { Component, ElementRef, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { I18nService, TranslationKey } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { cardLanguageName } from '../scryfall/card-languages';
import { LanguageOption, LanguageSelect } from '../settings/language-select';
import { cardLanguageOptions } from '../settings/language-settings';
import { DeckSort, SettingsService } from '../settings/settings.service';
import { DECK_EXPORT_FORMATS, DeckExportFormat } from './deck-formats';
import { DeckOverview } from './deck-overview';
import { DeckService, countCards } from './deck.service';
import { countEntries, parseDecklist } from './decklist';
import { ImportDialog } from './import-dialog';

type View = 'overview' | 'text';

const AUTO_LANGUAGE = 'auto';

@Component({
  selector: 'app-my-decks',
  imports: [TranslatePipe, RouterLink, RouterLinkActive, DeckOverview, ImportDialog, LanguageSelect],
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
  templateUrl: './my-decks.html',
  styleUrl: './my-decks.scss',
})
export class MyDecks {
  private readonly deckService = inject(DeckService);
  private readonly i18n = inject(I18nService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = input<string>();

  protected readonly view = signal<View>('overview');
  protected readonly sort = this.settings.deckSort.asReadonly();
  protected readonly sortOptions: { value: DeckSort; label: TranslationKey }[] = [
    { value: 'category', label: 'decks.sortCategory' },
    { value: 'type', label: 'decks.sortType' },
    { value: 'mana', label: 'decks.sortMana' },
  ];
  protected readonly exportFormats = DECK_EXPORT_FORMATS;
  protected readonly exportMenuOpen = signal(false);
  protected readonly importMode = signal<'new' | 'replace' | undefined>(undefined);
  protected readonly toast = signal<{ key: TranslationKey; format?: string; error?: boolean } | undefined>(undefined);
  private toastTimer?: ReturnType<typeof setTimeout>;

  protected readonly decks = computed(() =>
    this.deckService.decks().map((deck) => ({ ...deck, cardCount: countCards(deck.text) })),
  );

  protected readonly deck = computed(() => this.decks().find((deck) => deck.id === this.id()));

  protected readonly entries = computed(() => parseDecklist(this.deck()?.text ?? ''));
  protected readonly sideboardCount = computed(() => countEntries(this.entries(), ['sideboard']));

  protected readonly deckLanguage = computed(() => this.deck()?.language ?? this.settings.cardLanguage());
  protected readonly deckLanguageValue = computed(() => this.deck()?.language ?? AUTO_LANGUAGE);

  protected readonly deckLanguageOptions = computed((): LanguageOption[] => {
    const uiLanguage = this.i18n.language();
    const auto = this.i18n.translate('decks.languageAuto', {
      language: cardLanguageName(this.settings.cardLanguage(), uiLanguage),
    });
    return [{ code: AUTO_LANGUAGE, label: auto }, ...cardLanguageOptions(uiLanguage)];
  });

  protected readonly updatedAt = computed(() => {
    const deck = this.deck();
    return deck
      ? new Intl.DateTimeFormat(this.i18n.language(), { dateStyle: 'medium', timeStyle: 'short' }).format(
          new Date(deck.updatedAt),
        )
      : '';
  });

  protected create(): void {
    const deck = this.deckService.create(this.i18n.translate('decks.defaultName'));
    this.router.navigate(['/decks', deck.id]);
  }

  protected rename(id: string, event: Event): void {
    this.deckService.rename(id, (event.target as HTMLInputElement).value);
  }

  protected updateText(id: string, event: Event): void {
    this.deckService.updateText(id, (event.target as HTMLTextAreaElement).value);
  }

  protected delete(id: string, name: string): void {
    const label = name.trim() || this.i18n.translate('decks.untitled');
    if (confirm(this.i18n.translate('decks.confirmDelete', { name: label }))) {
      this.deckService.delete(id);
      this.router.navigate(['/decks']);
    }
  }

  protected setSort(event: Event): void {
    this.settings.deckSort.set((event.target as HTMLSelectElement).value as DeckSort);
  }

  protected setDeckLanguage(id: string, code: string): void {
    this.deckService.setLanguage(id, code === AUTO_LANGUAGE ? undefined : code);
  }

  protected onImported(text: string): void {
    const current = this.deck();
    if (this.importMode() === 'replace' && current) {
      this.deckService.updateText(current.id, text);
    } else {
      const deck = this.deckService.create(this.i18n.translate('decks.importedName'), text);
      this.router.navigate(['/decks', deck.id]);
    }
    this.importMode.set(undefined);
    this.view.set('overview');
  }

  protected async export(format: DeckExportFormat): Promise<void> {
    this.exportMenuOpen.set(false);
    try {
      await navigator.clipboard.writeText(format.export(this.entries()));
      this.showToast({ key: 'export.copied', format: format.label });
    } catch {
      this.showToast({ key: 'export.failed', error: true });
    }
  }

  protected onDocumentClick(event: MouseEvent): void {
    const menu = this.host.nativeElement.querySelector('.export');
    if (this.exportMenuOpen() && menu && !menu.contains(event.target as Node)) {
      this.exportMenuOpen.set(false);
    }
  }

  private showToast(toast: { key: TranslationKey; format?: string; error?: boolean }): void {
    clearTimeout(this.toastTimer);
    this.toast.set(toast);
    this.toastTimer = setTimeout(() => this.toast.set(undefined), 3000);
  }
}
