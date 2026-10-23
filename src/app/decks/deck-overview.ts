import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, map, of, startWith, switchMap } from 'rxjs';
import { CardPreview } from '../cards/card-preview';
import { I18nService, TranslationKey } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { SettingsService } from '../settings/settings.service';
import { cardLanguageName } from '../scryfall/card-languages';
import { ScryfallCard, cardDisplayName, cardFaces } from '../scryfall/scryfall.models';
import { DeckCardsService, ResolvedCard, cardKey } from './deck-cards.service';
import { DeckEntry, DeckSection } from './decklist';

type CardType = 'creature' | 'planeswalker' | 'battle' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'land' | 'other';

const TYPE_ORDER: readonly CardType[] = [
  'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment', 'land', 'other',
];
const TYPE_PRIORITY: readonly CardType[] = [
  'land', 'creature', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment',
];

interface OverviewCard {
  entry: DeckEntry;
  name: string;
  image?: string;
  resolved?: ResolvedCard | null;
}

interface OverviewGroup {
  id: string;
  title: TranslationKey;
  count: number;
  cards: OverviewCard[];
}

type ResolveState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; cards: Map<string, ResolvedCard | null> };

@Component({
  selector: 'app-deck-overview',
  imports: [TranslatePipe, CardPreview],
  templateUrl: './deck-overview.html',
  styleUrl: './deck-overview.scss',
})
export class DeckOverview {
  private readonly deckCards = inject(DeckCardsService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  readonly entries = input.required<DeckEntry[]>();

  protected readonly selectedCard = signal<ScryfallCard | undefined>(undefined);

  private readonly request = computed(() => ({ entries: this.entries(), language: this.settings.cardLanguage() }));

  protected readonly state = toSignal(
    toObservable(this.request).pipe(
      debounceTime(400),
      switchMap(({ entries, language }) =>
        this.deckCards.resolve(entries, language).pipe(
          map((cards): ResolveState => ({ status: 'done', cards })),
          startWith<ResolveState>({ status: 'loading' }),
          catchError(() => of<ResolveState>({ status: 'error' })),
        ),
      ),
    ),
    { initialValue: { status: 'loading' } as ResolveState },
  );

  private readonly resolved = linkedSignal<ResolveState, Map<string, ResolvedCard | null>>({
    source: this.state,
    computation: (state, previous) => (state.status === 'done' ? state.cards : (previous?.value ?? new Map())),
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
      };
    });

    const groups: OverviewGroup[] = [];
    const addGroup = (id: string, title: TranslationKey, groupCards: OverviewCard[]) => {
      if (groupCards.length) {
        groups.push({ id, title, cards: groupCards, count: groupCards.reduce((sum, c) => sum + c.entry.count, 0) });
      }
    };
    const inSection = (section: DeckSection) => cards.filter((c) => c.entry.section === section);

    addGroup('commander', 'sections.commander', inSection('commander'));
    addGroup('companion', 'sections.companion', inSection('companion'));
    const main = inSection('main');
    for (const type of TYPE_ORDER) {
      addGroup(type, `cardTypes.${type}`, main.filter((c) => cardType(c.resolved?.card) === type));
    }
    addGroup('sideboard', 'sections.sideboard', inSection('sideboard'));
    addGroup('maybeboard', 'sections.maybeboard', inSection('maybeboard'));
    return groups;
  });

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
    cardLanguageName(this.settings.cardLanguage(), this.i18n.language()),
  );
}

function cardType(card: ScryfallCard | undefined): CardType {
  const typeLine = (card?.card_faces?.[0]?.type_line ?? card?.type_line ?? '').toLowerCase();
  return TYPE_PRIORITY.find((type) => typeLine.includes(type)) ?? 'other';
}
