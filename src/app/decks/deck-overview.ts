import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, computed, effect, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounce, map, of, startWith, switchMap, timer } from 'rxjs';
import { CardPreview } from '../cards/card-preview';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { cardLanguageName } from '../scryfall/card-languages';
import { COLOR_ORDER, ScryfallCard, cardDisplayName, cardFaces, manaSymbolUrl } from '../scryfall/scryfall.models';
import { DeckSort } from '../settings/settings.service';
import { CardHover } from '../shared/card-hover/card-hover';
import { CardHoverOverlay } from '../shared/card-hover/card-hover-overlay.service';
import { AUTO_CATEGORIES, autoCategory } from './auto-categories';
import { LegalityIssue, LegalityResult, allowsSecondCommander, canBeCommander, canPair, checkLegality, isCopyIssue, legalityIssueKey, legalityIssueParams } from './deck-legality';
import { DeckCardsService, ResolvedCard, cardKey } from './deck-cards.service';
import { DeckGroupId, deckGroupName, manaValueGroupName } from './deck-group-names';
import { DeckService, EntryChanges } from './deck.service';
import { DeckEntry, DeckSection, cleanCategory } from './decklist';

type CardType = 'creature' | 'planeswalker' | 'battle' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'land' | 'other';

const FLASH_TIMEOUT_MS = 4000;
const CARD_FLASH: Keyframe[] = [
  { transform: 'scale(1.06)', filter: 'brightness(1.35) drop-shadow(0 0 14px var(--color-highlight))', offset: 0.3 },
];
const TOP_GLOW: Keyframe[] = [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }];
const TOP_GLOW_STRETCH = 1.5;

function flashDuration(root: HTMLElement): number {
  return parseFloat(getComputedStyle(root).getPropertyValue('--added-flash-duration')) || 700;
}

export function flashWhenReady(root: HTMLElement, selector: string, keyframes: Keyframe[], then?: () => void): void {
  const started = Date.now();
  const attempt = () => {
    const element = root.querySelector<HTMLElement>(selector);
    if (element && !(element as HTMLButtonElement).disabled && !element.classList.contains('loading')) {
      element.animate(keyframes, { duration: flashDuration(root), easing: 'ease-out' });
      then?.();
    } else if (Date.now() - started < FLASH_TIMEOUT_MS) {
      setTimeout(attempt, 100);
    }
  };
  setTimeout(attempt, 50);
}

export function flashAdded(root: HTMLElement, key: string): void {
  flashWhenReady(root, `[data-card-key="${CSS.escape(key)}"]`, CARD_FLASH, () =>
    root
      .querySelector<HTMLElement>('app-deck-overview .top-glow')
      ?.animate(TOP_GLOW, { duration: flashDuration(root) * TOP_GLOW_STRETCH, easing: 'ease-out' }),
  );
}

const TYPE_ORDER: readonly CardType[] = [
  'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other',
];
const MAX_MANA_GROUP = 7;
const DRAG_THRESHOLD_PX = 5;
const EDGE_GLOW_PULL_PX = 120;

// Card height is 139% of its width; each card in a stack overlaps the previous one by 111% of the width,
// leaving its title bar plus a strip of art (for the count) visible.
const CARD_HEIGHT_RATIO = 680 / 488;
const STACK_OVERLAP = 1.11;
const VISIBLE_STRIP = `${(((CARD_HEIGHT_RATIO - STACK_OVERLAP) / CARD_HEIGHT_RATIO) * 100).toFixed(2)}%`;

const TYPE_PRIORITY: readonly CardType[] = [
  'land', 'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment',
];

interface OverviewCard {
  key: string;
  entry: DeckEntry;
  name: string;
  image?: string;
  largeImage?: string;
  resolved?: ResolvedCard | null;
}

interface OverviewGroup {
  id: string;
  title: string;
  count: number;
  cards: OverviewCard[];
  manaValue?: { symbol: string; orMore: boolean };
}

type ResolveState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; cards: Map<string, ResolvedCard | null>; language: string; deckId: string };

@Component({
  selector: 'app-deck-overview',
  imports: [NgTemplateOutlet, TranslatePipe, CardPreview, CardHover],
  host: { '(document:keydown.escape)': 'picking.set(false)' },
  templateUrl: './deck-overview.html',
  styleUrl: './deck-overview.scss',
})
export class DeckOverview {
  private readonly deckCards = inject(DeckCardsService);
  private readonly deckService = inject(DeckService);
  private readonly i18n = inject(I18nService);

  readonly entries = input.required<DeckEntry[]>();
  readonly language = input.required<string>();
  readonly deckId = input.required<string>();
  readonly sort = input.required<DeckSort>();
  // Scryfall legality key of the format to check against; undefined turns the check off.
  readonly legalityFormat = input<string>();
  // Commander decks show commanders and companion in their own framed zone in front of all groups.
  readonly commanderZone = input(false);
  // Off for lists that are not a saved deck yet (deck wizard): no editing actions in the card preview.
  readonly editable = input(true);
  // Remove mode (deck wizard): clicking a card removes it instead of opening its preview.
  readonly removeMode = input(false);
  // Centers the groups on the screen while they fit (deck wizard); otherwise they start at the left.
  readonly centered = input(false);
  readonly removeCard = output<DeckEntry>();
  readonly colorsChange = output<string[]>();
  readonly legalityChange = output<LegalityResult | undefined>();
  // Clicking any warning triangle asks the page to show the legality details.
  readonly legalityRequested = output<void>();

  protected readonly manaSymbolUrl = manaSymbolUrl;

  protected readonly selected = signal<OverviewCard | undefined>(undefined);
  private lastRequestedDeck?: string;

  private readonly request = computed(() => ({
    entries: this.entries(),
    language: this.language(),
    deckId: this.deckId(),
  }));

  protected readonly state = toSignal(
    toObservable(this.request).pipe(
      // Debounce typing in the text view, but load right away when another deck is opened.
      debounce(({ deckId }) => {
        const sameDeck = deckId === this.lastRequestedDeck;
        this.lastRequestedDeck = deckId;
        return timer(sameDeck ? 400 : 0);
      }),
      switchMap(({ entries, language, deckId }) =>
        this.deckCards.resolve(entries, language).pipe(
          map((cards): ResolveState => ({ status: 'done', cards, language, deckId })),
          startWith<ResolveState>({ status: 'loading' }),
          catchError(() => of<ResolveState>({ status: 'error' })),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ResolveState },
  );

  private readonly lastResult = linkedSignal<
    ResolveState,
    { cards: Map<string, ResolvedCard | null>; language?: string; deckId?: string }
  >({
    source: this.state,
    computation: (state, previous) =>
      state.status === 'done' ? state : (previous?.value ?? { cards: new Map() }),
  });

  private readonly resolved = computed(() => this.lastResult().cards);

  protected readonly pending = computed(() => {
    if (this.state().status === 'error') {
      return false;
    }
    // Only a deck or language switch blocks the view; cards added to the open deck appear as soon as they resolve.
    const { language, deckId } = this.lastResult();
    return language !== this.language() || deckId !== this.deckId();
  });

  private readonly cards = computed(() => {
    const resolved = this.resolved();
    const failed = this.state().status === 'error';
    return this.entries().filter((entry) => failed || resolved.get(cardKey(entry)) !== undefined).map((entry): OverviewCard => {
      const result = resolved.get(cardKey(entry));
      return {
        key: cardKey(entry),
        entry,
        resolved: result,
        name: result ? cardDisplayName(result.card) : entry.name,
        image: result ? cardFaces(result.card)[0]?.image?.normal : undefined,
        largeImage: result ? cardFaces(result.card)[0]?.image?.large : undefined,
      };
    });
  });

  private readonly loadedImages = signal(new Set<string>());

  protected imageLoaded(url: string): void {
    this.loadedImages.update((urls) => new Set(urls).add(url));
  }

  protected isLoading(card: OverviewCard): boolean {
    return !!card.image && !this.loadedImages().has(card.image);
  }

  // Whether pictures of the shown cards are still on their way; one spinner below the board stands for all of them.
  protected readonly imagesLoading = computed(() => {
    const zone = this.zone();
    const shown = [...this.groups().flatMap((g) => g.cards), ...(zone ? [...zone.commanders, ...zone.companions] : [])];
    return shown.some((card) => this.isLoading(card));
  });

  protected readonly groups = computed(() => {
    const cards = this.cards();
    const language = this.language();
    const groups: OverviewGroup[] = [];
    const add = (id: string, title: string, groupCards: OverviewCard[], extra: Partial<OverviewGroup> = {}) => {
      if (groupCards.length) {
        groups.push({ id, title, cards: groupCards, count: groupCards.reduce((sum, c) => sum + c.entry.count, 0), ...extra });
      }
    };
    const addFixed = (id: DeckGroupId, groupCards: OverviewCard[]) => add(id, deckGroupName(id, language), groupCards);
    const addByType = (groupCards: OverviewCard[]) => {
      for (const type of TYPE_ORDER) {
        addFixed(type, groupCards.filter((c) => cardType(c.resolved?.card) === type));
      }
    };
    const inSection = (section: DeckSection) => cards.filter((c) => c.entry.section === section);

    if (!this.commanderZone()) {
      addFixed('commander', inSection('commander'));
      addFixed('companion', inSection('companion'));
    }
    const main = inSection('main');
    switch (this.sort()) {
      case 'category': {
        const fixedGroup = (c: OverviewCard) => matchingFixedGroup(c.entry.category, language) ?? defaultGroup(c);
        const custom = main.filter((c) => c.entry.category && !matchingFixedGroup(c.entry.category, language));
        for (const category of customCategories(custom.map((c) => c.entry))) {
          add(`category:${category}`, category, custom.filter((c) => c.entry.category === category));
        }
        const rest = main.filter((c) => !custom.includes(c));
        for (const id of [...AUTO_CATEGORIES, ...TYPE_ORDER]) {
          addFixed(id, rest.filter((c) => fixedGroup(c) === id));
        }
        break;
      }
      case 'type':
        addByType(main);
        break;
      case 'mana': {
        const spells = main.filter((c) => c.resolved && cardType(c.resolved.card) !== 'land');
        for (let value = 0; value <= MAX_MANA_GROUP; value++) {
          const label = value === MAX_MANA_GROUP ? `${value}+` : String(value);
          add(`mana:${value}`, manaValueGroupName(label, language), spells.filter((c) => manaGroup(c.resolved!.card) === value), {
            manaValue: { symbol: String(value), orMore: value === MAX_MANA_GROUP },
          });
        }
        addFixed('land', main.filter((c) => c.resolved && cardType(c.resolved.card) === 'land'));
        addFixed('other', main.filter((c) => !c.resolved));
        break;
      }
    }
    addFixed('sideboard', inSection('sideboard'));
    addFixed('maybeboard', inSection('maybeboard'));
    return groups;
  });

  protected readonly zone = computed(() => {
    if (!this.commanderZone()) {
      return undefined;
    }
    const cards = this.cards();
    const commanders = cards.filter((c) => c.entry.section === 'commander');
    const first = commanders[0]?.resolved?.card;
    const companions = cards.filter((c) => c.entry.section === 'companion');
    const language = this.language();
    return {
      title: deckGroupName('commander', language),
      companionTitle: deckGroupName('companion', language),
      commanders,
      companions,
      openSlot: commanders.length === 0 ? ('commander' as const) : commanders.length === 1 && first && allowsSecondCommander(first) ? ('partner' as const) : undefined,
    };
  });

  protected readonly picking = signal(false);

  protected readonly candidates = computed(() => {
    const partnerOf = this.zone()?.commanders[0]?.resolved?.card;
    return this.cards().filter((c) => {
      const card = c.resolved?.card;
      if (c.entry.section !== 'main' || !card) {
        return false;
      }
      return partnerOf ? canPair(partnerOf, card) && canBeCommander(card, true) : canBeCommander(card, false);
    });
  });

  protected pickCommander(card: OverviewCard): void {
    this.hoverOverlay.hide();
    this.deckService.updateEntry(this.deckId(), card.entry, { section: 'commander' });
    this.picking.set(false);
  }

  protected readonly categories = computed(() => {
    const language = this.language();
    const automatic = AUTO_CATEGORIES.map((id) => deckGroupName(id, language));
    return [...new Set([...customCategories(this.entries()), ...automatic])];
  });

  protected defaultCategory(card: OverviewCard): string {
    return deckGroupName(defaultGroup(card), this.language());
  }

  protected setCommander(card: OverviewCard, commander: boolean): void {
    this.updateSelected(card, { section: commander ? 'commander' : 'main' });
  }

  private readonly coverCard = computed(() => this.deckService.decks().find((d) => d.id === this.deckId())?.coverCard);

  protected isCover(card: OverviewCard): boolean {
    return this.coverCard()?.toLowerCase() === card.entry.name.toLowerCase();
  }

  protected setCover(card: OverviewCard): void {
    this.deckService.setCoverCard(this.deckId(), card.entry.name);
  }

  protected setCategory(card: OverviewCard, event: Event): void {
    this.updateSelected(card, { category: cleanCategory((event.target as HTMLInputElement).value) });
  }

  private readonly hoverOverlay = inject(CardHoverOverlay);
  protected readonly visibleStrip = VISIBLE_STRIP;
  protected readonly stackOverlap = `-${STACK_OVERLAP * 100}%`;

  private readonly colors = computed(() => {
    if (this.pending()) {
      return undefined;
    }
    const resolved = this.resolved();
    const identity = new Set(
      this.entries()
        .filter((e) => e.section === 'commander' || e.section === 'companion' || e.section === 'main')
        .flatMap((e) => resolved.get(cardKey(e))?.card.color_identity ?? []),
    );
    return COLOR_ORDER.filter((color) => identity.has(color));
  });

  constructor() {
    const resize = new ResizeObserver(() => this.measureBleed());
    effect(() => {
      const groups = this.board()?.nativeElement.parentElement;
      if (groups) {
        resize.observe(groups);
      }
    });
    inject(DestroyRef).onDestroy(() => resize.disconnect());
    effect(() => this.legalityChange.emit(this.legality()));
    inject(DestroyRef).onDestroy(() => this.legalityChange.emit(undefined));
    effect(() => {
      const colors = this.colors();
      if (colors) {
        this.colorsChange.emit(colors);
      }
    });
  }

  private readonly board = viewChild<ElementRef<HTMLElement>>('board');
  // Distances from the board's container to the screen edges; the board reaches over them to both edges.
  protected readonly boardBleed = signal({ left: 0, right: 0 });

  private measureBleed(): void {
    const groups = this.board()?.nativeElement.parentElement;
    if (groups) {
      const rect = groups.getBoundingClientRect();
      this.boardBleed.set({
        left: Math.max(0, rect.left),
        right: Math.max(0, document.documentElement.clientWidth - rect.right),
      });
    }
  }

  private swallowClick?: (event: Event) => void;
  protected readonly edgeGlow = signal<{ side: 'left' | 'right'; strength: number } | undefined>(undefined);

  // Dragging anywhere on the board moves it sideways; a click only counts if the pointer barely moved.
  protected startDrag(event: PointerEvent, board: HTMLElement): void {
    if (event.button !== 0 || event.pointerType === 'touch') {
      return;
    }
    if (this.swallowClick) {
      board.removeEventListener('click', this.swallowClick, { capture: true });
      this.swallowClick = undefined;
    }
    const startX = event.clientX;
    const startLeft = board.scrollLeft;
    let dragging = false;
    const move = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) > DRAG_THRESHOLD_PX) {
        dragging = true;
        board.setPointerCapture(e.pointerId);
        board.classList.add('dragging');
        this.hoverOverlay.hide();
      }
      if (dragging) {
        const target = startLeft - dx;
        const max = board.scrollWidth - board.clientWidth;
        board.scrollLeft = target;
        // Pulling past either end lights up that edge, the brighter the further the pull.
        const overshoot = target < 0 ? -target : target > max ? target - max : 0;
        this.edgeGlow.set(overshoot ? { side: target < 0 ? 'left' : 'right', strength: Math.min(1, overshoot / EDGE_GLOW_PULL_PX) } : undefined);
      }
    };
    const end = () => {
      board.removeEventListener('pointermove', move);
      board.removeEventListener('pointerup', end);
      board.removeEventListener('pointercancel', end);
      this.edgeGlow.set(undefined);
      if (dragging) {
        board.classList.remove('dragging');
        // The click that ends a drag must not open a card.
        this.swallowClick = (e: Event) => {
          e.stopPropagation();
          e.preventDefault();
          this.swallowClick = undefined;
        };
        board.addEventListener('click', this.swallowClick, { capture: true, once: true });
      }
    };
    board.addEventListener('pointermove', move);
    board.addEventListener('pointerup', end);
    board.addEventListener('pointercancel', end);
  }

  protected requestLegality(event: Event): void {
    event.stopPropagation();
    this.hoverOverlay.hide();
    this.legalityRequested.emit();
  }

  protected hideHover(): void {
    this.hoverOverlay.hide();
  }

  protected open(card: OverviewCard): void {
    this.hoverOverlay.hide();
    if (this.removeMode()) {
      this.removeCard.emit(card.entry);
      return;
    }
    this.selected.set(card);
  }

  protected changeCount(card: OverviewCard, delta: number): void {
    const count = card.entry.count + delta;
    this.deckService.setCount(this.deckId(), card.entry, Math.max(count, 0));
    this.selected.set(count > 0 ? { ...card, entry: { ...card.entry, count } } : undefined);
  }

  private updateSelected(card: OverviewCard, changes: EntryChanges): void {
    this.deckService.updateEntry(this.deckId(), card.entry, changes);
    this.selected.set({ ...card, entry: { ...card.entry, ...changes } });
  }

  protected readonly legality = computed(() => {
    const format = this.legalityFormat();
    if (!format || this.pending()) {
      return undefined;
    }
    const resolved = this.resolved();
    return checkLegality(
      format,
      this.entries().map((entry) => ({ key: cardKey(entry), entry, card: resolved.get(cardKey(entry))?.card ?? undefined })),
    );
  });

  // Too many copies only colors the count badge; every other issue marks the whole card.
  protected hasCopyIssue(key: string): boolean {
    return !!this.legality()?.cardIssues.get(key)?.some(isCopyIssue);
  }

  protected groupHasIssues(group: OverviewGroup): boolean {
    const issues = this.legality()?.cardIssues;
    return !!issues && group.cards.some((card) => issues.has(card.key));
  }

  protected hasCardIssue(key: string): boolean {
    return !!this.legality()?.cardIssues.get(key)?.some((issue) => !isCopyIssue(issue));
  }

  protected cardWarning(key: string): string | undefined {
    const issues = this.legality()?.cardIssues.get(key);
    return issues && this.issueTitle(issues);
  }

  protected issueTitle(issues: readonly LegalityIssue[]): string {
    return issues.map((issue) => this.i18n.translate(legalityIssueKey(issue), legalityIssueParams(issue, this.legalityFormat() ?? ''))).join('\n');
  }

  protected readonly notFound = computed(() => {
    if (this.state().status !== 'done') {
      return [];
    }
    const resolved = this.resolved();
    return [...new Set(this.entries().filter((e) => resolved.get(cardKey(e)) === null).map((e) => e.name))];
  });

  protected readonly fallbackCount = computed(
    () => [...this.resolved().values()].filter((r) => r && !r.localized).length,
  );

  protected readonly languageName = computed(() =>
    cardLanguageName(this.language(), this.i18n.language()),
  );
}

function defaultGroup(card: OverviewCard): DeckGroupId {
  const resolved = card.resolved?.card;
  return (resolved && autoCategory(resolved)) ?? cardType(resolved);
}

function matchingFixedGroup(category: string | undefined, language: string): DeckGroupId | undefined {
  const lower = category?.toLowerCase();
  return lower ? [...AUTO_CATEGORIES, ...TYPE_ORDER].find((id) => deckGroupName(id, language).toLowerCase() === lower) : undefined;
}

function customCategories(entries: readonly DeckEntry[]): string[] {
  return [...new Set(entries.map((e) => e.category).filter((c): c is string => !!c))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function manaGroup(card: ScryfallCard): number {
  return Math.min(Math.floor(card.cmc ?? 0), MAX_MANA_GROUP);
}

function cardType(card: ScryfallCard | undefined): CardType {
  const typeLine = (card?.card_faces?.[0]?.type_line ?? card?.type_line ?? '').toLowerCase();
  return TYPE_PRIORITY.find((type) => typeLine.includes(type)) ?? 'other';
}
