import { Component, ElementRef, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { CardSearch } from '../cards/card-search';
import { I18nService, TranslationKey, TranslationParams } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { CARD_LANGUAGES, cardLanguageName } from '../scryfall/card-languages';
import { ScryfallCard, cardDisplayName, deckCardName, manaSymbolUrl } from '../scryfall/scryfall.models';
import { Flag } from '../settings/flag';
import { LanguageOption, LanguageSelect } from '../settings/language-select';
import { cardLanguageOptions } from '../settings/language-settings';
import { DeckSort, SettingsService } from '../settings/settings.service';
import { DECK_EXPORT_FORMATS, DeckExportFormat } from './deck-formats';
import { DeckOverview } from './deck-overview';
import { CONSTRUCTED_FORMATS, LegalityFix, LegalityIssue, applyLegalityFix, canFix, LegalityResult, legalityFormatLabel, legalityIssueKey, legalityIssueParams } from './deck-legality';
import { DeckCardsService, cardKey } from './deck-cards.service';
import { DeckService, countCards } from './deck.service';
import { DeckFormat, countEntries, detectFormat, parseDecklist, serializeDecklist } from './decklist';
import { ImportDialog } from './import-dialog';

type View = 'overview' | 'text';

interface Toast {
  key: TranslationKey;
  params?: TranslationParams;
  error?: boolean;
}

const AUTO_LANGUAGE = 'auto';
const FLASH_TIMEOUT_MS = 4000;

const CARD_FLASH: Keyframe[] = [
  { transform: 'scale(1.06)', filter: 'brightness(1.35) drop-shadow(0 0 14px var(--color-highlight))', offset: 0.3 },
];
const COUNT_FLASH: Keyframe[] = [
  { color: 'var(--color-highlight)', textShadow: '0 0 8px var(--color-highlight)', transform: 'scale(1.15)', offset: 0.3 },
];

@Component({
  selector: 'app-my-decks',
  imports: [TranslatePipe, RouterLink, RouterLinkActive, DeckOverview, ImportDialog, LanguageSelect, Flag, CardSearch],
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
  templateUrl: './my-decks.html',
  styleUrl: './my-decks.scss',
})
export class MyDecks {
  private readonly deckService = inject(DeckService);
  private readonly deckCards = inject(DeckCardsService);
  private readonly i18n = inject(I18nService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = input<string>();

  protected readonly view = signal<View>('overview');
  protected readonly manaSymbolUrl = manaSymbolUrl;
  protected readonly sort = this.settings.deckSort.asReadonly();
  protected readonly legalityCheck = this.settings.legalityCheck.asReadonly();
  protected readonly formatOptions: { value: DeckFormat; label: TranslationKey }[] = [
    { value: 'commander', label: 'decks.formatCommander' },
    { value: 'constructed', label: 'decks.formatConstructed' },
  ];
  protected readonly sortOptions: { value: DeckSort; label: TranslationKey }[] = [
    { value: 'category', label: 'decks.sortCategory' },
    { value: 'type', label: 'decks.sortType' },
    { value: 'mana', label: 'decks.sortMana' },
  ];
  protected readonly constructedFormats = CONSTRUCTED_FORMATS;
  protected readonly exportFormats = DECK_EXPORT_FORMATS;
  protected readonly exportMenuOpen = signal(false);
  protected readonly importMode = signal<'new' | 'replace' | undefined>(undefined);
  protected readonly toast = signal<Toast | undefined>(undefined);
  protected readonly addCardsOpen = signal(false);
  protected readonly legality = signal<LegalityResult | undefined>(undefined);
  protected readonly issueKey = legalityIssueKey;
  protected readonly formatLabel = legalityFormatLabel;
  protected readonly canFix = canFix;
  protected readonly legalityFixes: { fix: LegalityFix; label: TranslationKey }[] = [
    { fix: 'copies', label: 'legality.fixCopies' },
    { fix: 'illegal', label: 'legality.fixIllegal' },
    { fix: 'all', label: 'legality.fixAll' },
  ];
  protected readonly addCardsUsed = signal(false);
  private toastTimer?: ReturnType<typeof setTimeout>;

  protected readonly decks = computed(() => {
    const globalLanguage = this.settings.cardLanguage();
    return this.deckService.decks().map((deck) => {
      const cardCount = countCards(deck.text);
      const language = CARD_LANGUAGES.find((l) => l.scryfallCode === (deck.language ?? globalLanguage));
      return { ...deck, cardCount, colorSymbols: colorSymbols(deck.colors, cardCount), languageFlag: language?.flag };
    });
  });

  // Flags only carry information when at least one deck differs from the global card language.
  protected readonly showDeckFlags = computed(() => {
    const globalLanguage = this.settings.cardLanguage();
    return this.deckService.decks().some((deck) => deck.language && deck.language !== globalLanguage);
  });

  protected readonly deck = computed(() => this.decks().find((deck) => deck.id === this.id()));

  protected readonly entries = computed(() => parseDecklist(this.deck()?.text ?? ''));
  // Decks saved before formats existed fall back to the detection used on import.
  protected readonly deckFormat = computed(() => this.deck()?.format ?? detectFormat(this.entries()));
  protected readonly legalityFormat = computed(() =>
    this.deckFormat() === 'commander' ? 'commander' : (this.deck()?.legalityFormat ?? CONSTRUCTED_FORMATS[0].id),
  );
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

  constructor() {
    effect(() => {
      const first = this.deckService.decks()[0];
      if (!this.id() && first) {
        this.router.navigate(['/decks', first.id], { replaceUrl: true });
      }
    });
  }

  protected toggleAddCards(): void {
    this.addCardsOpen.update((open) => !open);
    this.addCardsUsed.set(true);
  }

  protected addCard(deckId: string, card: ScryfallCard): void {
    const entry = { name: deckCardName(card), set: card.set, collectorNumber: card.collector_number };
    this.deckCards.remember(entry, this.deckLanguage(), card);
    this.deckService.addCard(deckId, entry);
    this.showToast({ key: 'decks.cardAdded', params: { card: cardDisplayName(card) } });
    this.flash(`[data-deck-count="${deckId}"]`, COUNT_FLASH);
    this.flash(`[data-card-key="${CSS.escape(cardKey(entry))}"]`, CARD_FLASH);
  }

  // Waits until the element exists and its card has loaded, then plays a short highlight animation.
  private flash(selector: string, keyframes: Keyframe[]): void {
    const started = Date.now();
    const duration = parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--added-flash-duration')) || 700;
    const attempt = () => {
      const element = this.host.nativeElement.querySelector<HTMLElement>(selector);
      if (element && !(element as HTMLButtonElement).disabled) {
        element.animate(keyframes, { duration, easing: 'ease-out' });
      } else if (Date.now() - started < FLASH_TIMEOUT_MS) {
        setTimeout(attempt, 100);
      }
    };
    setTimeout(attempt, 50);
  }

  protected create(): void {
    const deck = this.deckService.create(this.i18n.translate('decks.defaultName'), '', 'constructed');
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

  protected setDeckColors(id: string, colors: string[]): void {
    this.deckService.setColors(id, colors);
  }

  protected setFormat(id: string, event: Event): void {
    this.deckService.setFormat(id, (event.target as HTMLSelectElement).value as DeckFormat);
  }

  protected setLegalityFormat(id: string, event: Event): void {
    this.deckService.setLegalityFormat(id, (event.target as HTMLSelectElement).value);
  }

  protected issueParams(issue: LegalityIssue, format: string) {
    return legalityIssueParams(issue, format);
  }

  protected fixLegality(id: string, issues: readonly LegalityIssue[], fix: LegalityFix): void {
    const { entries, removed } = applyLegalityFix(this.entries(), issues, fix);
    if (removed) {
      this.deckService.updateText(id, serializeDecklist(entries));
      this.showToast({ key: 'legality.fixed', params: { count: removed } });
    }
  }

  protected toggleLegality(event: Event): void {
    this.settings.legalityCheck.set((event.target as HTMLInputElement).checked);
  }

  protected setSort(event: Event): void {
    this.settings.deckSort.set((event.target as HTMLSelectElement).value as DeckSort);
  }

  protected setDeckLanguage(id: string, code: string): void {
    this.deckService.setLanguage(id, code === AUTO_LANGUAGE ? undefined : code);
  }

  protected onImported(text: string): void {
    const current = this.deck();
    const format = detectFormat(parseDecklist(text));
    if (this.importMode() === 'replace' && current) {
      this.deckService.updateText(current.id, text);
      this.deckService.setFormat(current.id, format);
    } else {
      const deck = this.deckService.create(this.i18n.translate('decks.importedName'), text, format);
      this.router.navigate(['/decks', deck.id]);
    }
    this.importMode.set(undefined);
    this.view.set('overview');
  }

  protected async export(format: DeckExportFormat): Promise<void> {
    this.exportMenuOpen.set(false);
    try {
      await navigator.clipboard.writeText(format.export(this.entries()));
      this.showToast({ key: 'export.copied', params: { format: format.label } });
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

  private showToast(toast: Toast): void {
    clearTimeout(this.toastTimer);
    this.toast.set(toast);
    this.toastTimer = setTimeout(() => this.toast.set(undefined), 3000);
  }
}

function colorSymbols(colors: string[] | undefined, cardCount: number): string[] | undefined {
  if (!colors || cardCount === 0) {
    return undefined;
  }
  return colors.length ? colors : ['C'];
}
