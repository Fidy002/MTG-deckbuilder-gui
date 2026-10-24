import { ScryfallCard } from '../scryfall/scryfall.models';
import { allowsSecondCommander, applyLegalityFix, canFix, checkCommanderLegality, checkConstructedLegality } from './deck-legality';
import { DeckSection } from './decklist';

const card = (
  name: string,
  { type = 'Instant', colors = [] as string[], keywords = [] as string[], text = '', legality = 'legal', legalities = {} as Record<string, string> } = {},
) =>
  ({ name, type_line: type, color_identity: colors, keywords, oracle_text: text, legalities: { commander: legality, ...legalities } }) as unknown as ScryfallCard;

const line = (name: string, section: DeckSection, scryfall?: ScryfallCard, count = 1) => ({
  key: name.toLowerCase(),
  entry: { count, name, section },
  card: scryfall,
});

const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => line(`Card ${i}`, 'main', card(`Card ${i}`, { colors: ['R'] })));

const krenko = line('Krenko, Mob Boss', 'commander', card('Krenko, Mob Boss', { type: 'Legendary Creature — Goblin', colors: ['R'] }));

describe('checkCommanderLegality', () => {
  it('accepts a legal 100 card deck', () => {
    expect(checkCommanderLegality([krenko, ...filler(70), line('Mountain', 'main', card('Mountain', { type: 'Basic Land' }), 29)]).issues).toEqual([]);
  });

  it('reports deck size, missing commander and duplicates', () => {
    const kinds = checkCommanderLegality([line('Shock', 'main', card('Shock', { colors: ['R'] }), 2), ...filler(50)]).issues.map((i) => i.kind);
    expect(kinds).toEqual(['deckSize', 'noCommander', 'notSingleton']);
  });

  it('reports cards outside the color identity and banned cards, and marks those cards', () => {
    const result = checkCommanderLegality([
      krenko,
      ...filler(97),
      line('Counterspell', 'main', card('Counterspell', { colors: ['U'] })),
      line('Mana Crypt', 'main', card('Mana Crypt', { legality: 'banned' })),
    ]);
    expect(result.issues.map((i) => i.kind)).toEqual(['colorIdentity', 'banned']);
    expect(result.cardIssues.get('counterspell')?.[0].kind).toBe('colorIdentity');
  });

  it('checks commander validity and partner pairs', () => {
    const thrasios = card('Thrasios', { type: 'Legendary Creature — Merfolk', colors: ['G', 'U'], keywords: ['Partner'] });
    const tymna = card('Tymna', { type: 'Legendary Creature — Human', colors: ['W', 'B'], keywords: ['Partner'] });
    const bolt = card('Lightning Bolt', { colors: ['R'] });
    const wilson = card('Wilson', { type: 'Legendary Creature — Bear', keywords: ['Choose a background'] });
    const background = card('Raised by Giants', { type: 'Legendary Enchantment — Background' });

    const kinds = (...commanders: ScryfallCard[]) =>
      checkCommanderLegality([...commanders.map((c) => line(c.name, 'commander', c)), ...filler(100 - commanders.length)])
        .issues.map((i) => i.kind)
        .filter((k) => k !== 'colorIdentity');

    expect(kinds(thrasios, tymna)).toEqual([]);
    expect(kinds(wilson, background)).toEqual([]);
    expect(kinds(bolt)).toEqual(['invalidCommander']);
    expect(kinds(thrasios, krenko.card!)).toEqual(['invalidPartners']);
    expect([thrasios, wilson, background, krenko.card!].map(allowsSecondCommander)).toEqual([true, true, true, false]);
  });

  it('marks every line of a card that is in the deck too often', () => {
    const bears = (n: string) => ({ key: n, entry: { count: 1, name: 'Grizzly Bears', section: 'main' as const }, card: card('Grizzly Bears') });
    const result = checkCommanderLegality([krenko, bears('a'), bears('b')]);
    expect(result.issues.filter((i) => i.kind === 'notSingleton').length).toBe(1);
    expect([result.cardIssues.has('a'), result.cardIssues.has('b')]).toEqual([true, true]);
  });

  it('allows any number of basic lands and cards that say so', () => {
    const rats = card('Relentless Rats', { type: 'Creature — Rat', text: 'A deck can have any number of cards named Relentless Rats.' });
    const kinds = checkCommanderLegality([krenko, line('Relentless Rats', 'main', rats, 30), line('Mountain', 'main', card('Mountain'), 69)])
      .issues.map((i) => i.kind);
    expect(kinds).not.toContain('notSingleton');
  });
});

describe('checkConstructedLegality', () => {
  const playset = (name: string, legalities: Record<string, string> = { standard: 'legal', vintage: 'legal' }, count = 4) =>
    line(name, 'main', card(name, { legalities }), count);
  const legalMain = () => Array.from({ length: 15 }, (_, i) => playset(`Card ${i}`));

  it('accepts a legal 60 card deck with sideboard', () => {
    const side = line('Duress', 'sideboard', card('Duress', { legalities: { standard: 'legal' } }), 3);
    expect(checkConstructedLegality('standard', [...legalMain(), side]).issues).toEqual([]);
  });

  it('reports deck and sideboard size and too many copies', () => {
    const kinds = checkConstructedLegality('standard', [
      playset('Shock', undefined, 5),
      ...['A', 'B', 'C', 'D'].map((name) => line(name, 'sideboard', card(name, { legalities: { standard: 'legal' } }), 4)),
    ]).issues.map((i) => i.kind);
    expect(kinds).toEqual(['mainDeckSize', 'sideboardSize', 'tooManyCopies']);
  });

  it('checks the chosen format, including restricted cards', () => {
    const ring = playset('Sol Ring', { standard: 'not_legal', vintage: 'restricted' }, 2);
    expect(checkConstructedLegality('standard', [...legalMain(), ring]).issues.map((i) => i.kind)).toEqual(['notLegal']);
    expect(checkConstructedLegality('vintage', [...legalMain(), ring]).issues.map((i) => i.kind)).toEqual(['restricted']);
  });

  it('only checks deck size and copies at the kitchen table', () => {
    const ring = playset('Sol Ring', { standard: 'not_legal', vintage: 'restricted' }, 2);
    const side = Array.from({ length: 5 }, (_, i) => line(`Side ${i}`, 'sideboard', card(`Side ${i}`), 4));
    expect(checkConstructedLegality('kitchentable', [...legalMain(), ring, ...side]).issues).toEqual([]);
    expect(checkConstructedLegality('kitchentable', [playset('Shock', undefined, 5)]).issues.map((i) => i.kind)).toEqual([
      'mainDeckSize',
      'tooManyCopies',
    ]);
  });

  it('allows any number of basic lands', () => {
    const mountains = line('Mountain', 'main', card('Mountain', { legalities: { standard: 'legal' } }), 60);
    expect(checkConstructedLegality('standard', [mountains]).issues).toEqual([]);
  });
});

describe('applyLegalityFix', () => {
  const entry = (name: string, count: number, section: DeckSection = 'main') => ({ name, count, section });
  const entries = [entry('Shock', 3), entry('Shock', 3, 'sideboard'), entry('Mana Crypt', 1), entry('Shock', 2, 'maybeboard'), entry('Bolt', 2)];
  const issues = [
    { kind: 'tooManyCopies' as const, name: 'Shock', count: 6 },
    { kind: 'banned' as const, name: 'Mana Crypt' },
  ];

  it('reduces surplus copies across sections, keeping the maybeboard', () => {
    const { entries: fixed, removed } = applyLegalityFix(entries, issues, 'copies');
    expect(fixed).toEqual([entry('Shock', 3), entry('Shock', 1, 'sideboard'), entry('Mana Crypt', 1), entry('Shock', 2, 'maybeboard'), entry('Bolt', 2)]);
    expect(removed).toBe(2);
  });

  it('removes cards that are not allowed', () => {
    const { entries: fixed, removed } = applyLegalityFix(entries, issues, 'illegal');
    expect(fixed.map((e) => e.name)).not.toContain('Mana Crypt');
    expect(removed).toBe(1);
  });

  it('fixes everything at once and reports what can be fixed', () => {
    expect(applyLegalityFix(entries, issues, 'all').removed).toBe(3);
    expect(canFix([issues[0]], 'illegal')).toBe(false);
    expect(canFix([issues[0]], 'copies')).toBe(true);
  });
});
