import { ScryfallCard } from '../scryfall/scryfall.models';
import { checkCommanderLegality } from './commander-legality';
import { DeckSection } from './decklist';

const card = (
  name: string,
  { type = 'Instant', colors = [] as string[], keywords = [] as string[], text = '', legality = 'legal' } = {},
) =>
  ({ name, type_line: type, color_identity: colors, keywords, oracle_text: text, legalities: { commander: legality } }) as unknown as ScryfallCard;

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
  });

  it('allows any number of basic lands and cards that say so', () => {
    const rats = card('Relentless Rats', { type: 'Creature — Rat', text: 'A deck can have any number of cards named Relentless Rats.' });
    const kinds = checkCommanderLegality([krenko, line('Relentless Rats', 'main', rats, 30), line('Mountain', 'main', card('Mountain'), 69)])
      .issues.map((i) => i.kind);
    expect(kinds).not.toContain('notSingleton');
  });
});
