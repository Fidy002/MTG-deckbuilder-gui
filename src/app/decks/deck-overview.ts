import { Component, computed, effect, inject, input, linkedSignal, output, signal } from '@angular/core';
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
import { DeckCardsService, ResolvedCard, cardKey } from './deck-cards.service';
import { DeckGroupId, deckGroupName, manaValueGroupName } from './deck-group-names';
import { DeckService, EntryChanges } from './deck.service';
import { DeckEntry, DeckSection, cleanCategory } from './decklist';

type CardType = 'creature' | 'planeswalker' | 'battle' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'land' | 'other';

const TYPE_ORDER: readonly CardType[] = [
  'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other',
];
const MAX_MANA_GROUP = 7;

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
  imports: [TranslatePipe, CardPreview, CardHover],
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
  readonly colorsChange = output<string[]>();

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

  protected readonly groups = computed(() => {
    const resolved = this.resolved();
    const cards = this.entries().map((entry): OverviewCard => {
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
    effect(() => {
      const colors = this.colors();
      if (colors) {
        this.colorsChange.emit(colors);
      }
    });
  }

  protected open(card: OverviewCard): void {
    this.hoverOverlay.hide();
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
