import { ScryfallCard } from '../scryfall/scryfall.models';
import { basicLands, commanderQuery, deckCreatureTypes, newerFirst, pickSuggestions, preferredSets, roleCounts, roleQuery, setQuery, tribalQuery } from './deck-suggestions';

const card = (name: string, oracle_text = '', game_changer = false) => ({ name, oracle_text, game_changer }) as unknown as ScryfallCard;

describe('deck suggestions', () => {
  it('builds Scryfall queries for color identity, format and bracket', () => {
    expect(commanderQuery(['R', 'G'], 2)).toBe('is:commander legal:commander id>=rg -is:gamechanger');
    expect(commanderQuery([], 4)).toBe('is:commander legal:commander');
    expect(roleQuery({ role: 'ramp', query: 'otag:ramp', count: 10 }, { format: 'commander', colors: ['G'], exclude: [] })).toBe(
      'otag:ramp id<=g legal:commander',
    );
    expect(roleQuery({ role: 'creatures', query: 't:creature', count: 5 }, { format: 'kitchentable', colors: [], exclude: [] })).toBe(
      't:creature c<=c',
    );
  });

  it('skips owned and duplicate cards and respects the bracket', () => {
    const results = [
      {
        role: 'ramp' as const,
        count: 2,
        cards: [card('Sol Ring'), card('Arcane Signet'), card('Cultivate')],
      },
      {
        role: 'draw' as const,
        count: 3,
        cards: [card('Arcane Signet'), card('Rhystic Study', '', true), card('Time Warp', 'Target player takes an extra turn.'), card('Harmonize')],
      },
      { role: 'wipes' as const, count: 2, cards: [card('Armageddon', 'Destroy all lands.'), card('Blasphemous Act')] },
    ];
    const picked = pickSuggestions(results, { format: 'commander', colors: ['G'], bracket: 2, exclude: ['Sol Ring'] });
    expect(picked.map((g) => g.cards.map((c) => c.name))).toEqual([
      ['Arcane Signet', 'Cultivate'],
      ['Harmonize'],
      ['Blasphemous Act'],
    ]);

    const upgraded = pickSuggestions([{ role: 'draw', count: 3, cards: [card('A', '', true), card('B', '', true)] }], {
      format: 'commander',
      colors: [],
      bracket: 3,
      exclude: [],
    }, 2);
    expect(upgraded[0].cards.map((c) => c.name)).toEqual(['A']);
  });

  it('fills the free non-land slots with creatures', () => {
    const creatures = (options: Parameters<typeof roleCounts>[0]) => roleCounts(options).find((r) => r.role === 'creatures')?.count;
    expect(creatures({ format: 'commander', colors: [], exclude: [], ownedNonLands: 5 })).toBe(27);
    expect(creatures({ format: 'commander', colors: [], exclude: [], ownedNonLands: 80 })).toBe(0);
    expect(creatures({ format: 'standard', colors: [], exclude: [], ownedNonLands: 0 })).toBe(5);
  });

  it('splits basic lands over the colors', () => {
    expect(basicLands(['W', 'U', 'G'], 10)).toEqual([
      { count: 4, name: 'Plains', section: 'main' },
      { count: 3, name: 'Island', section: 'main' },
      { count: 3, name: 'Forest', section: 'main' },
    ]);
    expect(basicLands([], 2)).toEqual([{ count: 2, name: 'Wastes', section: 'main' }]);
  });

  it('finds the creature types of a deck from the commander and the own cards', () => {
    const beorn = {
      name: 'Beorn the Fierce',
      type_line: 'Legendary Creature — Bear Shapeshifter Warrior',
      oracle_text: 'Trample\nOther Bears you control get +2/+2.',
    } as unknown as ScryfallCard;
    const human = { name: 'Elder', type_line: 'Creature — Human Druid' } as unknown as ScryfallCard;
    const catalog = ['Bear', 'Shapeshifter', 'Warrior', 'Human', 'Druid', 'Elf'];
    expect(deckCreatureTypes(beorn, [human, human], catalog)).toEqual(['Bear', 'Druid']);
    expect(deckCreatureTypes({ ...beorn, oracle_text: 'Trample' }, [], catalog)).toEqual(['Bear', 'Shapeshifter', 'Warrior']);
    expect(deckCreatureTypes(undefined, [human, human], catalog)).toEqual(['Druid']);
    expect(tribalQuery(['Bear'])).toBe('t:creature (t:"bear" or kw:changeling)');
  });

  it('lists cards of recent sets first', () => {
    const cards = [
      { name: 'Old', released_at: '2010-01-01' },
      { name: 'New', released_at: '2025-06-01' },
    ] as unknown as ScryfallCard[];
    expect(newerFirst(cards, new Date('2026-10-24')).map((c) => c.name)).toEqual(['New', 'Old']);
  });

  it('prefers the most frequent sets of the own cards, ignoring basic lands', () => {
    const owned = [{ set: 'blb' }, { set: 'blb' }, { set: 'fdn' }, { set: 'm21', basic: true }, { set: 'm21', basic: true }, {}];
    expect(preferredSets(owned)).toEqual(['blb', 'fdn']);
    expect(setQuery(['blb', 'fdn'])).toBe('(set:blb or set:fdn)');
  });
});
