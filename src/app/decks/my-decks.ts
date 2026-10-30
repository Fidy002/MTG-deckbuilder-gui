import { Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
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
import { DeckOverview, flashAdded, flashWhenReady } from './deck-overview';
import { CONSTRUCTED_FORMATS, LegalityFix, LegalityIssue, applyLegalityFix, canFix, LegalityResult, legalityFormatLabel, legalityIssueKey, legalityIssueParams } from './deck-legality';
import { DeckCardsService, cardKey } from './deck-cards.service';
import { Deck, DeckService, countCards, countSideboard } from './deck.service';
import { Badge, suggestionBadges } from '../shared/card-badges/card-badges';
import { categoryRole } from './auto-categories';
import { MarqueeArt } from '../shared/card-marquee/card-marquee';
import { DeckAdvice, DeckAdvisor, RankedSuggestion, mixSuggestions, rolesByNeed, suggestionShares } from './deck-advisor';
import { SuggestionRole } from './deck-suggestions';
import { DeckFormat, countEntries, detectFormat, parseDecklist, serializeDecklist, DeckEntry } from './decklist';
import { ImportDialog } from './import-dialog';
import { NewDeckDialog } from './new-deck-dialog';
import { BRACKETS, Bracket, estimateBracket } from './deck-brackets';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { manaCurve } from './deck-curve';
import { ManaCurve } from './mana-curve';

type View = 'overview' | 'text';

interface Toast {
  key: TranslationKey;
  params?: TranslationParams;
  error?: boolean;
}

const AUTO_LANGUAGE = 'auto';
const COUNT_FLASH: Keyframe[] = [
  { color: 'var(--color-highlight)', textShadow: '0 0 8px var(--color-highlight)', transform: 'scale(1.15)', offset: 0.3 },
];

const SUGGESTIONS_PER_CLICK = 20;

@Component({
  selector: 'app-my-decks',
  imports: [TranslatePipe, RouterLink, RouterLinkActive, DeckOverview, ImportDialog, NewDeckDialog, LanguageSelect, Flag, CardSearch, ManaCurve],
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'drawerOpen.set(false); legalityOpen.set(false); bracketInfoOpen.set(false)',
  },
  templateUrl: './my-decks.html',
  styleUrl: './my-decks.scss',
})
export class MyDecks {
  private readonly deckService = inject(DeckService);
  private readonly deckCards = inject(DeckCardsService);
  private readonly advisor = inject(DeckAdvisor);
  private readonly i18n = inject(I18nService);
  private readonly settings = inject(SettingsService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = input<string>();

  protected readonly view = signal<View>('overview');
  protected readonly drawerOpen = signal(false);
  protected readonly legalityOpen = signal(false);
  protected readonly manaSymbolUrl = manaSymbolUrl;
  protected readonly sort = this.settings.deckSort.asReadonly();
  protected readonly legalityCheck = computed(() => this.deck()?.legalityCheck ?? this.settings.legalityCheck());
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
      return { ...deck, cardCount, sideboardCount: countSideboard(deck.text), colorSymbols: colorSymbols(deck.colors, cardCount), languageFlag: language?.flag };
    });
  });

  // Flags only carry information when at least one deck differs from the global card language.
  protected readonly showDeckFlags = computed(() => {
    const globalLanguage = this.settings.cardLanguage();
    return this.deckService.decks().some((deck) => deck.language && deck.language !== globalLanguage);
  });

  protected readonly deck = computed(() => this.decks().find((deck) => deck.id === this.id()));

  protected readonly entries = computed(() => parseDecklist(this.deck()?.text ?? ''));

  // The deck's cards as resolved from Scryfall (main deck only), for the mana curve.
  private readonly mainCards = toSignal(
    toObservable(computed(() => ({ entries: this.entries().filter((e) => e.section === 'main'), language: this.deckLanguage() }))).pipe(
      debounceTime(300),
      switchMap(({ entries, language }) =>
        entries.length
          ? this.deckCards.resolve(entries, language).pipe(
              map((resolved) => entries.flatMap((e) => resolved.get(cardKey(e))?.card ? [{ card: resolved.get(cardKey(e))!.card, count: e.count }] : [])),
              catchError(() => of([])),
            )
          : of([]),
      ),
    ),
  );

  protected readonly deckCurve = computed(() => {
    const cards = this.mainCards();
    return cards?.length ? manaCurve(cards) : undefined;
  });

  // The marquee shows the art of the open deck's cards, taken once per deck: editing the deck doesn't swap the pictures.
  private readonly marqueeArt = inject(MarqueeArt);
  private marqueeDeck?: string;
  private readonly showDeckArt = effect(() => {
    const id = this.deck()?.id;
    const cards = this.mainCards();
    if (id && cards?.length && id !== this.marqueeDeck) {
      this.marqueeDeck = id;
      untracked(() => this.marqueeArt.cards.set(cards.map((c) => c.card)));
    }
  });
  private readonly restoreMarquee = inject(DestroyRef).onDestroy(() => this.marqueeArt.cards.set(undefined));
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

  protected toggleAddCards(): void {
    this.addCardsOpen.update((open) => !open);
    this.addCardsUsed.set(true);
  }

  protected addCard(deckId: string, card: ScryfallCard): void {
    const entry = { name: deckCardName(card), set: card.set, collectorNumber: card.collector_number };
    this.deckCards.remember(entry, this.deckLanguage(), card);
    this.deckService.addCard(deckId, entry);
    this.showToast({ key: 'decks.cardAdded', params: { card: cardDisplayName(card) } });
    flashWhenReady(this.host.nativeElement, `[data-deck-count="${deckId}"]`, COUNT_FLASH);
    flashAdded(this.host.nativeElement, cardKey(entry));
  }

  // Names (lower case) of the cards in the open deck, outside the side- and maybeboard: they show a check in the search.
  protected readonly deckNames = computed(() => {
    const deck = this.deck();
    return new Set(
      deck ? parseDecklist(deck.text).filter((e) => e.section !== 'sideboard' && e.section !== 'maybeboard').map((e) => e.name.toLowerCase()) : [],
    );
  });

  // Remove mode of the overview: clicking a card takes it out of the deck.
  protected readonly removingCards = signal(false);

  protected removeCard(deckId: string, entry: DeckEntry): void {
    this.deckService.setCount(deckId, entry, 0);
    this.showToast({ key: 'decks.cardRemoved', params: { card: entry.name } });
    if (!this.entries().length) {
      this.removingCards.set(false);
    }
  }

  // Clicking a card in the search adds it to the deck; clicking a card the deck already has takes it out again.
  protected toggleCard(deckId: string, card: ScryfallCard): void {
    const deck = this.deck();
    const name = deckCardName(card).toLowerCase();
    const inDeck = deck
      ? parseDecklist(deck.text).filter((e) => e.section !== 'sideboard' && e.section !== 'maybeboard' && e.name.toLowerCase() === name)
      : [];
    if (!inDeck.length) {
      this.addCard(deckId, card);
      return;
    }
    inDeck.forEach((entry) => this.deckService.setCount(deckId, entry, 0));
    this.showToast({ key: 'decks.cardRemoved', params: { card: cardDisplayName(card) } });
  }

  protected readonly choosingNew = signal(false);

  // The deck wizard for this deck, starting with its own cards.
  protected openWizard(id: string): void {
    this.router.navigate(['/decks', id, 'wizard']);
  }

  // Suggestions for the open deck, shown in the search row a few at a time; every click shows the next ones.
  // Each click looks at what the deck misses most right now and searches that role only (once per role and deck).
  private readonly suggested = signal<
    { deckId: string; cards: ScryfallCard[]; badges: Map<string, Badge[]> } | undefined
  >(undefined);
  private suggestionState?: { deckId: string; advice: DeckAdvice; shown: Set<string> };
  protected readonly suggesting = signal(false);

  protected readonly suggestionsFailed = signal(false);

  private readonly currentSuggestions = computed(() => {
    const deck = this.deck();
    const suggested = this.suggested();
    return deck && suggested?.deckId === deck.id ? suggested : undefined;
  });
  protected readonly suggestions = computed(() => this.currentSuggestions()?.cards);
  protected readonly suggestionBadges = computed(() => this.currentSuggestions()?.badges);

  protected async suggestCards(deck: Deck, search: CardSearch): Promise<void> {
    search.clear();
    this.suggesting.set(true);
    this.suggestionsFailed.set(false);
    try {
      const language = this.deckLanguage();
      if (this.suggestionState?.deckId !== deck.id) {
        this.suggestionState = { deckId: deck.id, advice: await this.advisor.advise(deck, language), shown: new Set() };
      }
      const state = this.suggestionState;
      // What the deck misses right now decides the mix: e.g. more ramp while ramp is missing most.
      const missing = await this.advisor.missing(deck, state.advice, language);
      const inDeck = new Set(parseDecklist(deck.text).map((e) => e.name.toLowerCase()));
      const fresh = (list: RankedSuggestion[]) => list.filter((s) => !inDeck.has(deckCardName(s.card).toLowerCase()) && !state.shown.has(s.card.name));
      const plans = [state.advice.plan.main, state.advice.plan.backup];
      const isSynergy = (s: RankedSuggestion) => s.rating.synergies.length > 0 || s.plans.some((id) => plans.includes(id));
      const order = rolesByNeed(state.advice.targets, missing);
      const shares = new Map(suggestionShares(order, missing, SUGGESTIONS_PER_CLICK));
      // Each role is searched once; a role beyond the shares only when the others can't fill the click.
      const pick = async (): Promise<RankedSuggestion[]> => {
        const lists: [SuggestionRole, RankedSuggestion[]][] = [];
        let mixed: RankedSuggestion[] = [];
        for (const role of order) {
          if (!shares.has(role) && mixed.length >= SUGGESTIONS_PER_CLICK) {
            break;
          }
          lists.push([role, fresh(await this.advisor.candidates(state.advice, role))]);
          mixed = mixSuggestions(lists, shares, SUGGESTIONS_PER_CLICK, isSynergy);
        }
        return mixed;
      };
      let batch = await pick();
      if (!batch.length) {
        // Everything was shown once: start over.
        state.shown.clear();
        batch = await pick();
      }
      batch.forEach((s) => state.shown.add(s.card.name));
      const commander = state.advice.commander;
      const badges = new Map(
        batch.map((s) => [
          s.card.name,
          suggestionBadges(this.i18n, {
            rating: s.rating,
            plans: s.plans,
            deckPlans: [state.advice.plan.main, state.advice.plan.backup],
            commanderName: commander && cardDisplayName(commander),
            gameChanger: s.card.game_changer,
            style: s.styleFit ? state.advice.options.style : undefined,
            role: categoryRole(s.card),
          }),
        ]),
      );
      const cards = await this.advisor.localize(batch.map((s) => s.card), language);
      this.suggested.set(batch.length ? { deckId: deck.id, cards, badges } : undefined);
    } catch {
      this.suggestionsFailed.set(true);
    } finally {
      this.suggesting.set(false);
    }
  }

  protected create(): void {
    this.choosingNew.set(true);
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

  protected toggleLegality(id: string, event: Event): void {
    this.deckService.setLegalityCheck(id, (event.target as HTMLInputElement).checked);
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
    const bracket = this.host.nativeElement.querySelector('.bracket');
    if (this.bracketInfoOpen() && bracket && !bracket.contains(event.target as Node)) {
      this.bracketInfoOpen.set(false);
    }
  }

  protected readonly brackets = BRACKETS;
  protected readonly bracketInfoOpen = signal(false);

  // The bracket follows the cards: a while after each change to a commander deck it is estimated again (from the
  // cached cards, a newer change cancels it) and stored with the deck.
  protected readonly bracketEstimate = toSignal(
    toObservable(
      computed(() => {
        const id = this.deck()?.id;
        const entries = this.entries().filter((e) => e.section === 'commander' || e.section === 'companion' || e.section === 'main');
        const key = `${id}|${this.deckLanguage()}|${entries.map((e) => `${e.count} ${cardKey(e)}`).join('\n')}`;
        return { id, entries, language: this.deckLanguage(), key, commander: this.deckFormat() === 'commander' };
      }),
    ).pipe(
      distinctUntilChanged((a, b) => a.key === b.key && a.commander === b.commander),
      debounceTime(800),
      switchMap(({ id, entries, language, commander }) =>
        id && commander && entries.length
          ? this.deckCards.resolve(entries, language).pipe(
              map((resolved) => estimateBracket([...resolved.values()].flatMap((r) => (r ? [r.card] : [])))),
              tap((estimate) => this.deck()?.bracket !== estimate.bracket && this.deckService.setBracket(id, estimate.bracket)),
              catchError(() => of(undefined)),
            )
          : of(undefined),
      ),
    ),
  );

  protected bracketLevelKey(bracket: Bracket): TranslationKey {
    return `bracket.level${bracket}`;
  }

  protected bracketNameKey(bracket: Bracket): TranslationKey {
    return `bracket.name${bracket}`;
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
