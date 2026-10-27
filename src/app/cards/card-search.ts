import { Component, DestroyRef, ElementRef, Injector, afterNextRender, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Observable, catchError, combineLatest, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { I18nService, TranslationKey } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { SettingsService } from '../settings/settings.service';
import { cardLanguageName } from '../scryfall/card-languages';
import { CardSearchResult, ScryfallCard, deckCardName, manaSymbolUrl } from '../scryfall/scryfall.models';
import { Badge } from '../shared/card-badges/card-badges';
import { ScryfallService } from '../scryfall/scryfall.service';
import { CardPreview } from './card-preview';
import { CardHoverOverlay } from '../shared/card-hover/card-hover-overlay.service';
import { CardTile } from './card-tile';
import { SetSelect } from './set-select';

const MIN_QUERY_LENGTH = 2;
const COLOR_FILTERS = ['W', 'U', 'B', 'R', 'G', 'C', 'M'] as const;
type ColorFilter = (typeof COLOR_FILTERS)[number];

const isManaColor = (c: ColorFilter) => c !== 'C' && c !== 'M';

/**
 * Scryfall filter for the color and land toggles, like the ones in MTG Arena: with colors chosen, a card may only
 * use those colors (red + black finds red, black and red-black cards, but no white-black ones); C also lets
 * colorless cards through, M keeps only multicolored ones. With the land toggle only lands, and the colors then
 * are alternatives for the mana they produce.
 */
export function filterQuery(colors: readonly ColorFilter[], lands: boolean): string {
  if (lands) {
    const parts = colors.filter((c) => c !== 'M').map((c) => `produces:${c.toLowerCase()}`);
    return ['t:land', parts.length ? `(${parts.join(' or ')})` : ''].filter(Boolean).join(' ');
  }
  const letters = colors.filter(isManaColor).join('').toLowerCase();
  const colorless = colors.includes('C');
  const multi = colors.includes('M');
  if (!letters) {
    const parts = [colorless ? 'c:c' : '', multi ? 'c:m' : ''].filter(Boolean);
    return parts.length > 1 ? `(${parts.join(' or ')})` : (parts[0] ?? '');
  }
  const extra = multi ? (colorless ? '(c:c or c:m)' : 'c:m') : colorless ? '' : '-c:c';
  return [`c<=${letters}`, extra].filter(Boolean).join(' ');
}

/** The same filter as filterQuery, applied to cards that are already loaded (e.g. suggestions). */
export function matchesFilter(card: ScryfallCard, colors: readonly ColorFilter[], lands: boolean): boolean {
  const isLand = (card.type_line ?? '').includes('Land');
  if (lands && !isLand) {
    return false;
  }
  if (lands) {
    const wanted = colors.filter((c) => c !== 'M');
    return !wanted.length || wanted.some((c) => (card.produced_mana ?? []).includes(c));
  }
  if (!colors.length) {
    return true;
  }
  const cardColors = new Set(card.colors ?? card.card_faces?.flatMap((face) => face.colors ?? []) ?? []);
  const letters = colors.filter(isManaColor);
  const colorless = cardColors.size === 0;
  const multi = cardColors.size > 1;
  const kindAllowed = (colors.includes('C') && colorless) || (colors.includes('M') && multi);
  if (!letters.length) {
    return kindAllowed;
  }
  const inColors = [...cardColors].every((c) => (letters as string[]).includes(c));
  if (colors.includes('M')) {
    return inColors && kindAllowed;
  }
  return inColors && (colors.includes('C') || !colorless);
}
const DEBOUNCE_MS = 350;
const LOAD_MORE_THRESHOLD_PX = 600;

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; result: CardSearchResult };

@Component({
  selector: 'app-card-search',
  imports: [TranslatePipe, CardTile, CardPreview, SetSelect],
  host: { '[class.compact]': 'compact()' },
  templateUrl: './card-search.html',
  styleUrl: './card-search.scss',
})
export class CardSearch {
  private readonly scryfall = inject(ScryfallService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  readonly compact = input(false);
  readonly language = input<string>();
  // Toggle mode: a click selects or deselects a card (deck names in lower case) instead of adding it via the lower half.
  readonly toggle = input(false);
  // Cards to show in the result row while nothing is searched or filtered, e.g. suggestions for the deck.
  readonly suggestions = input<readonly ScryfallCard[]>();
  // Why each suggestion fits (by English card name).
  readonly suggestionBadges = input<ReadonlyMap<string, readonly Badge[]>>();
  readonly chosen = input<ReadonlySet<string>>(new Set());
  readonly picked = output<ScryfallCard>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly hoverOverlay = inject(CardHoverOverlay);

  protected deckName(card: ScryfallCard): string {
    return deckCardName(card).toLowerCase();
  }
  private readonly lastResult = signal<CardSearchResult | undefined>(undefined);

  private readonly searchLanguage = computed(() => this.language() ?? this.settings.cardLanguage());

  protected readonly minQueryLength = MIN_QUERY_LENGTH;
  protected readonly query = signal('');
  protected readonly selectedSets = signal<string[]>([]);
  protected readonly colorFilters = COLOR_FILTERS;
  protected readonly manaSymbolUrl = manaSymbolUrl;
  protected readonly colors = signal<ColorFilter[]>([]);
  protected readonly landsOnly = signal(false);
  private readonly filter = computed(() => filterQuery(this.colors(), this.landsOnly()));

  protected colorLabel(color: ColorFilter): TranslationKey {
    return `search.color.${color}`;
  }

  protected toggleColor(color: ColorFilter): void {
    this.colors.update((colors) => (colors.includes(color) ? colors.filter((c) => c !== color) : [...colors, color]));
  }

  protected toggleLands(): void {
    this.landsOnly.update((lands) => !lands);
  }

  /** Empties the search box and turns the color and land filters off, e.g. to show suggestions again. */
  clear(): void {
    this.query.set('');
    this.colors.set([]);
    this.landsOnly.set(false);
  }
  protected readonly state = signal<SearchState>({ status: 'idle' });
  protected readonly loadingMore = signal(false);
  protected readonly selectedCard = signal<ScryfallCard | undefined>(undefined);

  protected readonly result = computed(() => {
    const state = this.state();
    return state.status === 'done' ? state.result : undefined;
  });

  protected readonly fallbackLanguage = computed(() => {
    const result = this.result();
    return result?.isFallback ? cardLanguageName(this.searchLanguage(), this.i18n.language()) : undefined;
  });

  // Compact mode: the result row opens with the first results, stays open without results
  // and folds away again once the search is cleared.
  protected readonly expanded = signal(false);
  // While the row folds away, the last results stay rendered so there is something to animate.
  private readonly collapsingResult = signal<CardSearchResult | undefined>(undefined);
  private collapseTimer?: ReturnType<typeof setTimeout>;
  protected readonly shownResult = computed(() => this.result() ?? this.collapsingResult());

  protected readonly visibleCards = computed(() => {
    const cards = (this.shownResult() ?? this.suggestionResult())?.cards ?? [];
    if (!this.toggle()) {
      return cards;
    }
    const chosen = this.chosen();
    return cards.filter((card) => !chosen.has(this.deckName(card)));
  });

  protected pick(card: ScryfallCard): void {
    if (this.toggle() && !this.chosen().has(this.deckName(card))) {
      this.slideIntoGap(card);
    }
    this.picked.emit(card);
  }

  private tiles(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('app-card-tile[data-card-id]')];
  }

  private slideIntoGap(card: ScryfallCard): void {
    const tiles = this.tiles();
    const before = new Map(tiles.map((tile) => [tile.dataset['cardId'], tile.getBoundingClientRect().left]));
    const removed = tiles.find((tile) => tile.dataset['cardId'] === card.id);
    if (removed) {
      this.hoverOverlay.spawnEmbers(removed.getBoundingClientRect());
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const duration = parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--card-slide-duration')) || 500;
    afterNextRender(
      () => {
        for (const tile of this.tiles()) {
          const left = before.get(tile.dataset['cardId']);
          const delta = left === undefined ? 0 : left - tile.getBoundingClientRect().left;
          if (delta) {
            tile.animate([{ transform: `translateX(${delta}px)` }, { transform: 'none' }], { duration, easing: 'ease-in-out' });
          }
        }
      },
      { injector: this.injector },
    );
  }

  protected readonly suggestionResult = computed((): CardSearchResult | undefined => {
    const cards = this.suggestions();
    if (!cards?.length || this.state().status !== 'idle') {
      return undefined;
    }
    const shown = cards.filter((card) => matchesFilter(card, this.colors(), this.landsOnly()));
    return { cards: shown, totalCards: shown.length, language: this.searchLanguage(), isFallback: false };
  });

  constructor() {
    effect(() => {
      const state = this.state();
      if (!this.compact()) {
        return;
      }
      if (state.status === 'idle' && untracked(this.expanded)) {
        this.collapsingResult.set(untracked(this.lastResult));
        this.expanded.set(false);
        clearTimeout(this.collapseTimer);
        this.collapseTimer = setTimeout(() => this.collapsingResult.set(undefined), this.collapseDuration());
      } else if (state.status === 'done') {
        clearTimeout(this.collapseTimer);
        this.collapsingResult.set(undefined);
        this.lastResult.set(state.result);
        if (state.result.cards.length) {
          this.expanded.set(true);
        }
      }
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.collapseTimer));

    const query$ = toObservable(this.query).pipe(
      debounceTime(DEBOUNCE_MS),
      map((q) => q.trim()),
      distinctUntilChanged(),
    );

    combineLatest([query$, toObservable(this.selectedSets), toObservable(this.searchLanguage), toObservable(this.filter)])
      .pipe(
        switchMap(([query, sets, language, filter]) => this.search(query, sets, language, filter)),
        takeUntilDestroyed(),
      )
      .subscribe((state) => this.state.set(state));
  }

  // In the compact single row the mouse wheel scrolls sideways, but only if the results are wider than the row;
  // otherwise the page scrolls as usual.
  protected onRowWheel(event: WheelEvent, row: HTMLElement): void {
    if (!this.compact() || Math.abs(event.deltaY) <= Math.abs(event.deltaX) || row.scrollWidth <= row.clientWidth) {
      return;
    }
    event.preventDefault();
    row.scrollLeft += event.deltaY;
  }

  protected onRowScroll(row: HTMLElement): void {
    if (this.compact() && row.scrollLeft + row.clientWidth >= row.scrollWidth - LOAD_MORE_THRESHOLD_PX) {
      this.loadMore();
    }
  }

  private collapseDuration(): number {
    const value = getComputedStyle(this.host.nativeElement).getPropertyValue('--results-expand-duration');
    return (parseFloat(value) || 600) + 50;
  }

  protected onInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected loadMore(): void {
    const result = this.result();
    if (!result?.nextPage || this.loadingMore()) {
      return;
    }
    this.loadingMore.set(true);
    this.scryfall.loadNextPage(result).subscribe({
      next: (next) => {
        if (this.result() === result) {
          this.state.set({ status: 'done', result: next });
        }
        this.loadingMore.set(false);
      },
      error: () => this.loadingMore.set(false),
    });
  }

  private search(query: string, sets: string[], language: string, filter: string): Observable<SearchState> {
    // The color and land toggles only narrow a search; on their own they start none (they filter the suggestions instead).
    if (query.length < MIN_QUERY_LENGTH && !(query.length === 0 && sets.length > 0)) {
      return of({ status: 'idle' });
    }
    return this.scryfall.searchCards(query, language, sets, filter).pipe(
      map((result): SearchState => ({ status: 'done', result })),
      startWith<SearchState>({ status: 'loading' }),
      catchError(() => of<SearchState>({ status: 'error' })),
    );
  }
}
