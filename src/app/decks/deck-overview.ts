import { Component, DestroyRef, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounce, map, of, startWith, switchMap, timer } from 'rxjs';
import { CardPreview } from '../cards/card-preview';
import { I18nService } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { cardLanguageName } from '../scryfall/card-languages';
import { ScryfallCard, cardDisplayName, cardFaces } from '../scryfall/scryfall.models';
import { DeckSort } from '../settings/settings.service';
import { AUTO_CATEGORIES, autoCategory } from './auto-categories';
import { DeckCardsService, ResolvedCard, cardKey } from './deck-cards.service';
import { DeckGroupId, deckGroupName, manaValueGroupName } from './deck-group-names';
import { DeckService, EntryChanges } from './deck.service';
import { DeckEntry, DeckSection, cleanCategory } from './decklist';

type CardType = 'creature' | 'planeswalker' | 'battle' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'land' | 'other';

const TYPE_ORDER: readonly CardType[] = [
  'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other',
];
const MAX_MANA_GROUP = 7;
const CARD_ASPECT = 488 / 680;

const TYPE_PRIORITY: readonly CardType[] = [
  'land', 'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment',
];

interface OverviewCard {
  entry: DeckEntry;
  name: string;
  image?: string;
  largeImage?: string;
  resolved?: ResolvedCard | null;
}

interface HoverPreview {
  image: string;
  name: string;
  left: number;
  top: number;
}

const HOVER_DELAY_MS = 500;
const PREVIEW_WIDTH = 320;
const PREVIEW_GAP = 16;
const VIEWPORT_MARGIN = 8;

interface Ember {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  delay: number;
}

const EMBER_COUNT = 12;
const EMBER_LIFETIME_MS = 300;
const EMBER_MAX_DELAY_MS = 60;

interface OverviewGroup {
  id: string;
  title: string;
  count: number;
  cards: OverviewCard[];
}

type ResolveState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; cards: Map<string, ResolvedCard | null>; language: string };

@Component({
  selector: 'app-deck-overview',
  imports: [TranslatePipe, CardPreview],
  host: { '(window:scroll)': 'hidePreview()' },
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
      switchMap(({ entries, language }) =>
        this.deckCards.resolve(entries, language).pipe(
          map((cards): ResolveState => ({ status: 'done', cards, language })),
          startWith<ResolveState>({ status: 'loading' }),
          catchError(() => of<ResolveState>({ status: 'error' })),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ResolveState },
  );

  private readonly lastResult = linkedSignal<ResolveState, { cards: Map<string, ResolvedCard | null>; language?: string }>({
    source: this.state,
    computation: (state, previous) =>
      state.status === 'done' ? state : (previous?.value ?? { cards: new Map() }),
  });

  private readonly resolved = computed(() => this.lastResult().cards);

  protected readonly pending = computed(() => {
    if (this.state().status === 'error') {
      return false;
    }
    const { cards, language } = this.lastResult();
    return language !== this.language() || this.entries().some((e) => !cards.has(cardKey(e)));
  });

  protected readonly groups = computed(() => {
    const resolved = this.resolved();
    const cards = this.entries().map((entry): OverviewCard => {
      const result = resolved.get(cardKey(entry));
      return {
        entry,
        resolved: result,
        name: result ? cardDisplayName(result.card) : entry.name,
        image: result ? cardFaces(result.card)[0]?.image?.normal : undefined,
        largeImage: result ? cardFaces(result.card)[0]?.image?.large : undefined,
      };
    });

    const language = this.language();
    const groups: OverviewGroup[] = [];
    const add = (id: string, title: string, groupCards: OverviewCard[]) => {
      if (groupCards.length) {
        groups.push({ id, title, cards: groupCards, count: groupCards.reduce((sum, c) => sum + c.entry.count, 0) });
      }
    };
    const addFixed = (id: DeckGroupId, groupCards: OverviewCard[]) => add(id, deckGroupName(id, language), groupCards);
    const addByType = (groupCards: OverviewCard[]) => {
      for (const type of TYPE_ORDER) {
        addFixed(type, groupCards.filter((c) => cardType(c.resolved?.card) === type));
      }
    };
    const inSection = (section: DeckSection) => cards.filter((c) => c.entry.section === section);

    addFixed('commander', inSection('commander'));
    addFixed('companion', inSection('companion'));
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
          add(`mana:${value}`, manaValueGroupName(label, language), spells.filter((c) => manaGroup(c.resolved!.card) === value));
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

  protected setCategory(card: OverviewCard, event: Event): void {
    this.updateSelected(card, { category: cleanCategory((event.target as HTMLInputElement).value) });
  }

  protected readonly previewWidth = PREVIEW_WIDTH;
  protected readonly hoverPreview = signal<HoverPreview | undefined>(undefined);
  private hoverTimer?: ReturnType<typeof setTimeout>;
  protected readonly embers = signal<Ember[]>([]);
  private nextEmberId = 0;
  private pointerY = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.hoverTimer));
  }

  protected trackPointer(event: MouseEvent): void {
    this.pointerY = event.clientY;
  }

  protected startHover(card: OverviewCard, event: MouseEvent): void {
    this.hidePreview();
    this.trackPointer(event);
    if (card.resolved) {
      this.spawnEmbers((event.target as HTMLElement).getBoundingClientRect());
    }
    const image = card.largeImage;
    const element = (event.target as HTMLElement).closest('.card');
    if (!image || !element) {
      return;
    }
    this.hoverTimer = setTimeout(() => {
      const rect = element.getBoundingClientRect();
      const height = PREVIEW_WIDTH / CARD_ASPECT;
      const left =
        rect.left + rect.width / 2 > window.innerWidth / 2
          ? rect.left - PREVIEW_GAP - PREVIEW_WIDTH
          : rect.right + PREVIEW_GAP;
      const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
      const top = Math.max(VIEWPORT_MARGIN, Math.min(this.pointerY - height / 2, maxTop));
      this.hoverPreview.set({ image, name: card.name, left, top });
    }, HOVER_DELAY_MS);
  }

  private spawnEmbers(area: DOMRect): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const includeBottom = area.height > area.width;
    const random = (min: number, max: number) => min + Math.random() * (max - min);
    const created = Array.from({ length: EMBER_COUNT }, (): Ember => {
      const sides = includeBottom ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right'];
      const side = sides[Math.floor(Math.random() * sides.length)];
      const base = { id: this.nextEmberId++, size: random(2, 4), delay: random(0, EMBER_MAX_DELAY_MS) };
      switch (side) {
        case 'top':
          return { ...base, x: random(area.left, area.right), y: area.top, dx: random(-8, 8), dy: random(-26, -12) };
        case 'bottom':
          return { ...base, x: random(area.left, area.right), y: area.bottom, dx: random(-8, 8), dy: random(-10, -2) };
        case 'left':
          return { ...base, x: area.left, y: random(area.top, area.bottom), dx: random(-24, -10), dy: random(-14, 0) };
        default:
          return { ...base, x: area.right, y: random(area.top, area.bottom), dx: random(10, 24), dy: random(-14, 0) };
      }
    });
    this.embers.update((embers) => [...embers, ...created]);
    const ids = new Set(created.map((e) => e.id));
    setTimeout(
      () => this.embers.update((embers) => embers.filter((e) => !ids.has(e.id))),
      EMBER_LIFETIME_MS + EMBER_MAX_DELAY_MS + 50,
    );
  }

  protected hidePreview(): void {
    clearTimeout(this.hoverTimer);
    this.hoverPreview.set(undefined);
  }

  protected open(card: OverviewCard): void {
    this.hidePreview();
    this.selected.set(card);
  }

  private updateSelected(card: OverviewCard, changes: EntryChanges): void {
    this.deckService.updateEntry(this.deckId(), card.entry, changes);
    this.selected.set({ ...card, entry: { ...card.entry, ...changes } });
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
