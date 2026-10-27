import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ScryfallCard } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { DeckAdvice, DeckAdvisor, RankedSuggestion, mixSuggestions, rolesByNeed, suggestionShares } from './deck-advisor';
import { DeckCardsService, cardKey } from './deck-cards.service';
import { SuggestionRole } from './deck-suggestions';
import { Deck } from './deck.service';
import { parseDecklist } from './decklist';

const CARDS: Record<string, Partial<ScryfallCard>> = {
  'Lyra Dawnbringer': {
    type_line: 'Legendary Creature — Angel',
    oracle_text: 'Flying, first strike, lifelink\nOther Angels you control get +1/+1 and have lifelink.',
    keywords: ['Flying', 'First strike', 'Lifelink'],
    color_identity: ['W'],
    cmc: 5,
  },
  'Sol Ring': { type_line: 'Artifact', oracle_text: '{T}: Add {C}{C}.', cmc: 1 },
  'Arcane Signet': { type_line: 'Artifact', oracle_text: "{T}: Add one mana of any color in your commander's color identity.", cmc: 2 },
  'Wrath of God': { type_line: 'Sorcery', oracle_text: "Destroy all creatures. They can't be regenerated.", cmc: 4 },
  Forest: { type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)' },
  Plains: { type_line: 'Basic Land — Plains', oracle_text: '({T}: Add {W}.)' },
};

function setup(findPopularCards = vi.fn((_query: string) => of([] as ScryfallCard[]))) {
  const findCards = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: ScryfallService, useValue: { findCards, findPopularCards, creatureTypes$: of(['Angel']) } },
      {
        provide: DeckCardsService,
        useValue: {
          resolve: (entries: ReturnType<typeof parseDecklist>) =>
            of(new Map(entries.map((e) => [cardKey(e), { card: { name: e.name, ...CARDS[e.name] } as ScryfallCard }]))),
        },
      },
    ],
  });
  return { advisor: TestBed.inject(DeckAdvisor), findCards, findPopularCards };
}

describe('suggestions by need', () => {
  it('takes the biggest gap first, and the play style once nothing is missing', () => {
    const targets = new Map<SuggestionRole, number>([
      ['creatures', 25],
      ['ramp', 10],
      ['draw', 10],
      ['theme', 6],
    ]);
    expect(rolesByNeed(targets, new Map([['creatures', 5], ['ramp', 8], ['draw', 0]]))).toEqual(['ramp', 'creatures', 'theme', 'draw']);
    expect(rolesByNeed(targets, new Map())[0]).toBe('theme');
  });

  it('shares a click among every role that misses cards, by how much each misses', () => {
    const missing = new Map<SuggestionRole, number>([['theme', 6], ['draw', 3], ['creatures', 1]]);
    expect(suggestionShares(['theme', 'draw', 'creatures', 'ramp'], missing, 20)).toEqual([['theme', 12], ['draw', 6], ['creatures', 2]]);
    expect(suggestionShares(['theme', 'draw', 'creatures', 'ramp'], new Map(), 20)).toEqual([['theme', 8], ['draw', 6], ['creatures', 6]]);
  });

  it('puts synergies first, but only a few, and mixes the roles', () => {
    const ranked = (name: string, synergy = false): RankedSuggestion => ({
      card: { name } as ScryfallCard,
      rating: { synergies: synergy ? ['lifegain'] : [], effects: [] },
      plans: [],
      styleFit: false,
    });
    const isSynergy = (s: RankedSuggestion) => s.rating.synergies.length > 0;
    const lists: [SuggestionRole, RankedSuggestion[]][] = [
      ['theme', [ranked('t1', true), ranked('t2', true), ranked('t3', true), ranked('t4')]],
      ['draw', [ranked('d1', true), ranked('t1', true), ranked('d2')]],
    ];
    const shares = new Map<SuggestionRole, number>([['theme', 3], ['draw', 3]]);
    const names = mixSuggestions(lists, shares, 6, isSynergy, 2).map((s) => s.card.name);
    expect(names).toEqual(['t1', 't2', 't4', 'd2']);
  });
});

describe('missing roles', () => {
  it('counts the deck cards of each role from their rules text, without a search', async () => {
    const { advisor, findCards } = setup();
    const targets = new Map((['ramp', 'wipes', 'draw', 'lands'] as const).map((role) => [role, 10]));
    const deck = { text: '1 Sol Ring\n2 Arcane Signet\n1 Wrath of God\n30 Forest' } as Deck;

    const missing = await advisor.missing(deck, { targets } as DeckAdvice, 'en');
    expect(Object.fromEntries(missing)).toEqual({ ramp: 7, wipes: 9, draw: 10, lands: 0 });
    expect(findCards).not.toHaveBeenCalled();
  });
});

describe('deck advice', () => {
  it('reads the style off the commander and searches a role only when it is asked for, once', async () => {
    const angel = { name: 'Serra Angel', type_line: 'Creature — Angel', oracle_text: 'Flying, vigilance', keywords: ['Flying'], cmc: 5 } as ScryfallCard;
    const bear = { name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', cmc: 2 } as ScryfallCard;
    const authority = {
      name: 'Authority of the Consuls',
      type_line: 'Enchantment',
      oracle_text: 'Creatures your opponents control enter tapped.\nWhenever a creature an opponent controls enters, you gain 1 life.',
      cmc: 1,
    } as ScryfallCard;
    const { advisor, findPopularCards } = setup(vi.fn((query: string) => of(query.startsWith('t:creature') ? [bear, angel] : [authority])));
    const deck = { text: 'Commander\n1 Lyra Dawnbringer\n\nDeck\n1 Sol Ring\n30 Plains', format: 'commander', bracket: 2 } as Deck;

    const advice = await advisor.advise(deck, 'en');
    expect(advice.options.style).toBe('lifegain');
    expect(findPopularCards).not.toHaveBeenCalled();

    const creatures = await advisor.candidates(advice, 'creatures');
    await advisor.candidates(advice, 'creatures');
    expect(findPopularCards).toHaveBeenCalledTimes(1);
    expect(creatures[0].card.name).toBe('Serra Angel');

    // The commander's lifegain counts in every role, not only for creatures and card draw.
    const theme = await advisor.candidates(advice, 'theme');
    expect(theme.find((s) => s.card.name === 'Authority of the Consuls')?.rating.synergies).toContain('lifegain');
  });
});
