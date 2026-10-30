import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of } from 'rxjs';
import { ScryfallCard } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { DeckSuggestions, roleStaples, MANA_ENCHANTMENT_QUERY, MANA_ROCK_QUERY, basicLands, cheapestFirst, bestCommander, interleave, manaPips, recommendColors, splitBasics, commanderQuery, deckCreatureTypes, commanderFit, newerFirst, pickCommanders, pickSuggestions, preferredSets, creatureRecommendation, hasCreatureType, isTypal, recommendedCreatures, styleCreatureQuery, roleCounts, roleQuery, setQuery, tribalQuery, typeQuery } from './deck-suggestions';

const card = (name: string, oracle_text = '', game_changer = false) => ({ name, oracle_text, game_changer }) as unknown as ScryfallCard;

describe('deck suggestions', () => {
  it('suggests the mana first, mana enchantments and rocks cheapest first', async () => {
    expect(roleCounts({ format: 'commander', colors: ['G'], exclude: [] })[0].role).toBe('ramp');
    const cheap = [{ name: 'Big', cmc: 4 }, { name: 'One', cmc: 1 }, { name: 'Two', cmc: 2 }, { name: 'Other One', cmc: 1 }] as ScryfallCard[];
    expect(cheapestFirst(cheap).map((c) => c.name)).toEqual(['One', 'Other One', 'Two', 'Big']);
    const findPopularCards = vi.fn((_query: string) => of([] as ScryfallCard[]));
    TestBed.configureTestingModule({ providers: [{ provide: ScryfallService, useValue: { findPopularCards } }] });
    const service = TestBed.inject(DeckSuggestions);
    const options = { format: 'commander', colors: ['G'], exclude: [] };
    await firstValueFrom(service.group(service.roles(options)[0], options));
    const queries = findPopularCards.mock.calls.map(([query]) => query);
    expect(queries[0]).toContain('!"Sol Ring"');
    expect(queries[1]).toContain(MANA_ENCHANTMENT_QUERY);
    expect(queries[2]).toContain(MANA_ROCK_QUERY);
    expect(queries).toHaveLength(3);
    expect(roleStaples('lands', { format: 'commander', colors: ['R'] })).toEqual([]);
    expect(roleStaples('lands', { format: 'commander', colors: ['B', 'R'] })).toEqual(['Command Tower']);
    expect(roleStaples('ramp', { format: 'standard', colors: ['B', 'R'] })).toEqual([]);
    expect(queries.every((query) => !query.includes('otag:ramp'))).toBe(true);
  });

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

  it('recommends creatures by play style, commander and the own creatures', () => {
    const base = { format: 'commander', colors: [], exclude: [] };
    const creatures = (options: Parameters<typeof roleCounts>[0]) => roleCounts(options).find((r) => r.role === 'creatures')?.count;
    expect(recommendedCreatures({ ...base, style: 'aggro' })).toBeGreaterThan(recommendedCreatures({ ...base, style: 'midrange' }));
    expect(recommendedCreatures({ ...base, style: 'midrange' })).toBeGreaterThan(recommendedCreatures({ ...base, style: 'control' }));
    const tribal = card('Lord', 'Other Elves you control get +1/+1.');
    const spells = card('Wizard', 'Whenever you cast an instant or sorcery spell, draw a card.');
    expect(recommendedCreatures({ ...base, commander: tribal })).toBeGreaterThan(recommendedCreatures(base));
    expect(recommendedCreatures({ ...base, commander: spells })).toBeLessThan(recommendedCreatures(base));
    const lathril = card('Lathril', '{T}, Tap ten untapped Elves you control: Each opponent loses 10 life.');
    const factors = creatureRecommendation({ ...base, commander: lathril, creatureTypes: ['Elf'] }).factors;
    expect(factors.find((f) => f.kind === 'creatureSynergy')?.match).toBe('{T}, Tap ten untapped Elves you control: Each opponent loses 10 life');
    expect(creatures({ ...base, ownedCreatures: 5 })).toBe(recommendedCreatures(base) - 5);
    expect(creatures({ ...base, ownedCreatures: 80 })).toBe(0);
    expect(creatures({ format: 'standard', colors: [], exclude: [], style: 'midrange' })).toBe(4);
    expect(roleCounts({ ...base, style: 'control' }).find((r) => r.role === 'wipes')?.count).toBeGreaterThan(
      roleCounts({ ...base, style: 'aggro' }).find((r) => r.role === 'wipes')!.count,
    );
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

  it('picks varying commanders, sorted by color count', () => {
    const commander = (name: string, color_identity: string[]) => ({ name, color_identity }) as unknown as ScryfallCard;
    const pool = [commander('A', ['R', 'G', 'B']), commander('B', ['R', 'G']), commander('C', ['R', 'G']), commander('D', ['R', 'G', 'U'])];
    let seed = 0;
    const random = () => [0.9, 0.1, 0.5, 0.7][seed++ % 4];
    const picked = pickCommanders(pool, 3, { colors: ['R', 'G'] }, random);
    expect(picked.length).toBe(3);
    expect(picked.map((c) => c.color_identity!.length)).toEqual([...picked.map((c) => c.color_identity!.length)].sort());
    expect(new Set(pickCommanders(pool, 4, { colors: ['R', 'G'] }).map((c) => c.name))).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('suggests the best commander and prefers an own one when equally good', () => {
    const commander = (name: string, color_identity: string[], oracle_text = '') =>
      ({ name, type_line: 'Legendary Creature — Bear', oracle_text, set: 'xyz', color_identity }) as unknown as ScryfallCard;
    const popular = commander('Popular', ['G']);
    const lord = commander('Lord', ['G'], 'Other Elves you control get +1/+1.');
    const mine = commander('Mine', ['G']);
    const red = commander('Red', ['R'], 'Other Elves you control get +1/+1.');
    const fit = { colors: ['G'], creatureTypes: ['Elf'] };
    expect(bestCommander([mine], [popular], fit)?.name).toBe('Mine');
    expect(bestCommander([mine], [popular, lord], fit)?.name).toBe('Lord');
    expect(bestCommander([red], [popular], fit)?.name).toBe('Popular');
    expect(bestCommander([], [popular, mine], { colors: [] }, () => 0.5)?.name).toBe('Popular');
    expect(bestCommander([], [], { colors: [] })).toBeUndefined();
    // Without a chosen theme, an own commander is the suggestion – not one that names the type of the own cards, not even a lord.
    const rivaz = { ...lord, name: 'Rivaz', oracle_text: 'Spend this mana only to cast Elf creature spells.' } as ScryfallCard;
    expect(bestCommander([mine], [rivaz], { ...fit, typal: false })?.name).toBe('Mine');
    expect(bestCommander([mine], [lord], { ...fit, typal: false })?.name).toBe('Mine');
    // An older own commander is not pushed aside by a newer one that fits just as well.
    const legend = (name: string, released_at: string) =>
      ({ name, type_line: 'Legendary Creature — Dragon', oracle_text: '', released_at, color_identity: ['U', 'B', 'R'] }) as unknown as ScryfallCard;
    const bolas = legend('Nicol Bolas, the Ravager', '2018-07-13');
    expect(bestCommander([bolas], [legend('Newer', new Date().toISOString().slice(0, 10))], { colors: ['U', 'B', 'R'] })?.name).toBe(bolas.name);
  });

  it('varies the suggested commander among equally good ones and prefers the play style', () => {
    const commander = (name: string, oracle_text = '') =>
      ({ name, type_line: 'Legendary Creature — Bear', oracle_text, set: 'xyz', color_identity: ['G'] }) as unknown as ScryfallCard;
    const pool = ['A', 'B', 'C', 'D', 'E', 'F'].map((name) => commander(name));
    const draws = [0.9, 0.1, 0.1, 0.1, 0.1];
    let i = 0;
    expect(bestCommander([], pool, { colors: [] }, () => draws[i++ % draws.length])?.name).toBe('A');
    const shown = new Set(Array.from({ length: 40 }, () => bestCommander([], pool, { colors: [] })?.name));
    expect(shown.size).toBeGreaterThan(1);
    expect(shown.has('F')).toBe(false);
    const flier = commander('Flier', 'Flying');
    const style = (card: ScryfallCard) => card.name === 'Flier';
    const flierFirst = Array.from({ length: 200 }, () => bestCommander([], [...pool, flier], { colors: [], style })?.name);
    const counts = new Map<string | undefined, number>();
    flierFirst.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1));
    expect([...counts].sort((a, b) => b[1] - a[1])[0][0]).toBe('Flier');
    expect(new Set(flierFirst).size).toBeGreaterThan(1);
  });

  it('prefers commanders that fit the own creature types and sets', () => {
    const commander = (name: string, type_line: string, oracle_text = '', set = 'xyz') =>
      ({ name, type_line, oracle_text, set, color_identity: ['G'] }) as unknown as ScryfallCard;
    const fit = { colors: ['G'], creatureTypes: ['Elf'], preferredSets: ['blb'] };
    const lord = commander('Lord', 'Legendary Creature — Human', 'Other Elves you control get +1/+1.');
    const elf = commander('Elf', 'Legendary Creature — Elf Druid');
    const bear = commander('Bear', 'Legendary Creature — Bear', '', 'blb');
    const other = commander('Other', 'Legendary Creature — Bear');
    expect(commanderFit(lord, fit)).toBeGreaterThan(commanderFit(bear, fit));
    expect(commanderFit(bear, fit)).toBeGreaterThan(commanderFit(elf, fit));
    expect(commanderFit(elf, fit)).toBeGreaterThan(commanderFit(other, fit));
    expect(pickCommanders([other, bear, elf, lord], 4, fit).map((c) => c.name)).toEqual(['Lord', 'Bear', 'Elf', 'Other']);
    const now = new Date('2026-10-24');
    const modern = { ...other, released_at: '2025-08-01' } as ScryfallCard;
    expect(commanderFit(modern, fit, now)).toBeGreaterThan(commanderFit(other, fit, now));
    expect(typeQuery(['Elf'])).toBe('(t:"elf" or o:/\\b(elf|elves)\\b/)');
  });
});

describe('basic lands', () => {
  it('counts mana symbols, hybrid ones half', () => {
    expect(manaPips(['{2}{G}{G}', '{R/G}', '{1}{R}', undefined])).toEqual({ G: 2.5, R: 1.5 });
  });

  it('splits the basics by mana symbols with at least one per color', () => {
    expect(splitBasics(['R', 'G'], { G: 6, R: 2 }, 24)).toEqual({ R: 6, G: 18 });
    expect(splitBasics(['W', 'G'], { G: 10 }, 10)).toEqual({ W: 1, G: 9 });
    expect(splitBasics(['U', 'B'], {}, 7)).toEqual({ U: 4, B: 3 });
    expect(splitBasics([], {}, 5)).toEqual({ C: 5 });
  });
});

describe('play styles', () => {
  const base = { format: 'commander', colors: ['W'], exclude: [] };
  const role = (style: Parameters<typeof roleCounts>[0]['style'], name: string) =>
    roleCounts({ ...base, style }).find((r) => r.role === name);

  it('fills the free slots with style cards where the style has them', () => {
    expect(role('voltron', 'theme')?.query).toContain('t:equipment');
    expect(role('voltron', 'theme')!.count).toBeGreaterThan(5);
    expect(role('midrange', 'theme')?.count).toBe(0);
    expect(role('bigMana', 'ramp')?.count).toBeGreaterThan(role('midrange', 'ramp')!.count);
    expect(recommendedCreatures({ ...base, style: 'spellslinger' })).toBeLessThan(recommendedCreatures({ ...base, style: 'goWide' }));
  });

  it('keeps control decks low on creatures even with a creature commander', () => {
    const control = { format: 'commander', colors: ['U'], exclude: [], style: 'control' as const };
    expect(recommendedCreatures(control)).toBe(10);
    const tribal = card('Lord', 'Other Elves you control get +1/+1.');
    const { count, factors } = creatureRecommendation({ ...control, commander: tribal, creatureTypes: ['Elf'] });
    expect(count).toBe(14);
    expect(factors.find((f) => f.kind === 'styleMax')?.delta).toBe(-4);
  });

  it('only counts as a typal deck with a chosen theme or a commander that names the type', () => {
    const base = { format: 'commander', colors: ['W'], exclude: [], style: 'midrange' as const, creatureTypes: ['Dog'] };
    const dog = card('Phelia', 'Flying\nWhenever Phelia attacks, exile up to one other target nonland permanent.');
    const kinds = (options: Parameters<typeof creatureRecommendation>[0]) => creatureRecommendation(options).factors.map((f) => f.kind);
    expect(kinds({ ...base, commander: dog })).not.toContain('types');
    expect(kinds({ ...base, commander: dog, themeTypes: ['Dog'] })).toContain('types');
    expect(kinds({ ...base, commander: card('Lord', 'Other Dogs you control get +1/+1.') })).toContain('types');
  });
});

describe('color advice', () => {
  it('follows the play style without own cards', () => {
    expect(recommendColors({}, {}, 'spellslinger').colors).toEqual(['U', 'R']);
    expect(recommendColors({}, {}, 'bigMana').colors).toEqual(['G']);
  });

  it('lets own cards and the theme outweigh the play style', () => {
    expect(recommendColors({ G: 6, B: 4 }, {}, 'aggro').colors).toEqual(['B', 'G']);
    expect(recommendColors({}, { G: 30, B: 5 }, 'control').colors).toContain('G');
    expect(recommendColors({ W: 3, U: 3, B: 3 }, {}, 'midrange').colors).toEqual(['W', 'U', 'B']);
  });
});

describe('color advice with a splash of own cards', () => {
  it('keeps every color the own cards need', () => {
    expect(recommendColors({ G: 6, R: 2 }, { G: 30, B: 6 }, 'aggro').colors).toEqual(['R', 'G']);
  });
});

describe('mixed suggestions', () => {
  it('takes the lists in turns', () => {
    expect(interleave([['a1', 'a2', 'a3'], ['b1'], ['c1', 'c2']])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3']);
  });
});

describe('win plan', () => {
  it('keeps slots for the finishers of the plan in the style role', () => {
    const base = { format: 'commander', colors: ['G'], exclude: [], style: 'midrange' as const };
    const theme = (planQueries?: string[]) => roleCounts({ ...base, planQueries }).find((r) => r.role === 'theme');
    expect(theme()?.count).toBe(0);
    expect(theme(['o:"each opponent loses"'])?.count).toBeGreaterThanOrEqual(4);
    expect(theme(['o:"each opponent loses"'])?.query).toBe('o:"each opponent loses"');
    expect(recommendedCreatures({ ...base, planQueries: ['x'] })).toBeLessThanOrEqual(recommendedCreatures(base));
  });

  it('plays the creature types only in a typal deck, and searches the creatures of the play style', () => {
    const kavu = { name: 'Tannuk', type_line: 'Legendary Creature — Kavu Pilot', oracle_text: 'Crew 2. Landfall — Whenever a land you control enters, draw a card.' } as ScryfallCard;
    const base = { format: 'commander', colors: ['R', 'G'], exclude: [], creatureTypes: ['Kavu', 'Pilot'], commander: kavu };
    expect(isTypal(base)).toBe(false);
    expect(isTypal({ ...base, themeTypes: ['Kavu'] })).toBe(true);
    expect(isTypal({ ...base, commander: { ...kavu, oracle_text: 'Other Kavu you control get +1/+1.' } })).toBe(true);
    const smaug = { name: 'Smaug the Magnificent', type_line: 'Legendary Creature — Dragon', oracle_text: 'Flying, haste' } as ScryfallCard;
    expect(isTypal({ ...base, commander: smaug, creatureTypes: ['Dragon'] })).toBe(false);
    expect(isTypal({ ...base, commander: { ...kavu, oracle_text: 'Search your library for a Kavu card.' } })).toBe(false);
    expect(hasCreatureType({ name: 'Goldspan Dragon', type_line: 'Creature — Dragon' } as ScryfallCard, ['Dragon'])).toBe(true);
    expect(hasCreatureType({ name: 'Changeling Outcast', type_line: 'Creature — Shapeshifter', keywords: ['Changeling'] } as ScryfallCard, ['Dragon'])).toBe(true);
    expect(hasCreatureType({ name: 'Ragavan', type_line: 'Legendary Creature — Monkey Pirate' } as ScryfallCard, ['Dragon'])).toBe(false);
    expect(styleCreatureQuery('landfall')).toMatch(/^t:creature .*otag:landfall/);
    expect(styleCreatureQuery('landfall')).not.toContain('-t:creature');
    expect(styleCreatureQuery('spellslinger')).toBeUndefined();
  });

  it('fills every non-land slot of a commander deck, plan slots included', () => {
    for (const style of ['combo', 'midrange', 'lifegain', 'control'] as const) {
      const options = { format: 'commander', colors: ['U', 'B'], exclude: [], style, planQueries: ['o:"you win the game"'] };
      const nonLands = roleCounts(options)
        .filter((r) => r.role !== 'creatures' && r.role !== 'lands')
        .reduce((sum, r) => sum + r.count, recommendedCreatures(options));
      expect(nonLands, style).toBe(62);
    }
  });
});

describe('brackets', () => {
  it('adds tutors for the higher brackets and leaves room for them', () => {
    const base = { format: 'commander', colors: ['B'], exclude: [], style: 'midrange' as const };
    const tutors = (bracket?: 2 | 3 | 4 | 5) => roleCounts({ ...base, bracket }).find((r) => r.role === 'tutors')?.count;
    expect(tutors(2)).toBe(0);
    expect(tutors(4)).toBe(4);
    expect(tutors(5)).toBe(6);
    expect(recommendedCreatures({ ...base, bracket: 5 })).toBeLessThanOrEqual(recommendedCreatures({ ...base, bracket: 2 }));
  });
});

describe('suggestions for a finished deck', () => {
  it('fetches the candidates of one role with a single search', async () => {
    const found = [
      { name: 'Swords to Plowshares', type_line: 'Instant' },
      { name: 'Sol Ring', type_line: 'Artifact' },
      { name: 'Path to Exile', type_line: 'Instant' },
    ] as ScryfallCard[];
    const findPopularCards = vi.fn((_query: string) => of(found));
    TestBed.configureTestingModule({ providers: [{ provide: ScryfallService, useValue: { findPopularCards } }] });
    const options = { format: 'commander', colors: ['W'], bracket: 2 as const, exclude: ['Sol Ring'], style: 'lifegain' as const, planQueries: ['t:angel'] };
    const service = TestBed.inject(DeckSuggestions);
    const removal = await firstValueFrom(service.roleCards({ role: 'removal', query: 'otag:removal', count: 8 }, options));
    expect(removal.cards.map((c) => c.name)).toEqual(['Swords to Plowshares', 'Path to Exile']);
    await firstValueFrom(service.roleCards({ role: 'theme', query: '', count: 0 }, options));
    expect(findPopularCards).toHaveBeenCalledTimes(2);
    expect(findPopularCards.mock.calls[1][0]).toContain('((t:angel) or (');
  });
});
