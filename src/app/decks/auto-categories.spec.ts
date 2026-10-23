import { ScryfallCard } from '../scryfall/scryfall.models';
import { autoCategory } from './auto-categories';

const card = (type_line: string, oracle_text: string) => ({ type_line, oracle_text }) as ScryfallCard;

describe('autoCategory', () => {
  it.each([
    ['Sorcery', 'Destroy all creatures. They can\'t be regenerated.', 'wipe'],
    ['Instant', 'Counter target spell.', 'counter'],
    ['Instant', 'Lightning Bolt deals 3 damage to any target.', 'removal'],
    ['Instant', 'Exile target creature. Its controller gains life equal to its power.', 'removal'],
    ['Sorcery', 'Search your library for a card, put that card into your hand, then shuffle.', 'tutor'],
    ['Artifact', '{T}: Add {C}{C}.', 'ramp'],
    ['Creature — Elf Druid', '{T}: Add {G}.', 'ramp'],
    ['Sorcery', 'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.', 'ramp'],
    ['Instant', 'The owner of target permanent shuffles it into their library, then reveals the top card.', 'removal'],
    ['Sorcery', 'Each player discards their hand, then draws seven cards.', 'draw'],
    ['Instant', 'Draw three cards, then put two cards from your hand on top of your library in any order.', 'draw'],
  ])('%s: "%s" → %s', (typeLine, text, expected) => {
    expect(autoCategory(card(typeLine, text))).toBe(expected);
  });

  it('ignores reminder text, lands and cards without a matching rule', () => {
    expect(autoCategory(card('Creature — Human', 'Flying (This creature can\'t be blocked except by creatures with flying or reach. Draw a card.)'))).toBeUndefined();
    expect(autoCategory(card('Land', '{T}: Add {G}.'))).toBeUndefined();
    expect(autoCategory(card('Creature — Bear', ''))).toBeUndefined();
  });
});
