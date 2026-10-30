import { ScryfallCard } from '../scryfall/scryfall.models';
import { CardRating, cardEffects, cardScore, commanderStyle, fitsStyle, recommendStyle, cardSynergies, commanderSynergies, roleSynergies } from './deck-synergies';

const card = (oracle_text: string, extra: Partial<ScryfallCard> = {}) => ({ name: 'Card', oracle_text, ...extra }) as ScryfallCard;

describe('deck synergies', () => {
  const lathril = card(
    'Menace\nWhenever Lathril deals combat damage to a player, create that many 1/1 green Elf Warrior creature tokens.\n{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.',
  );

  it('finds what the commander builds on', () => {
    expect(commanderSynergies(lathril, ['Elf'])).toEqual(['tribal', 'tokens', 'combatDamage']);
    expect(commanderSynergies(card('Whenever you gain life, put a +1/+1 counter on target creature.'))).toEqual(['counters', 'lifegain']);
    expect(commanderSynergies(card('Whenever you cast an instant or sorcery spell, draw a card.'))).toEqual(['spells']);
    expect(commanderSynergies(undefined)).toEqual([]);
  });

  it('keeps the synergies that matter for a role', () => {
    expect(roleSynergies(['tribal', 'tokens', 'combatDamage'], 'draw')).toEqual(['tribal', 'tokens']);
    expect(roleSynergies(['tribal', 'tokens', 'combatDamage'], 'removal')).toEqual([]);
  });

  it('prefers direct removal: destroy or exile without a condition, then targeted damage, fight or bite', () => {
    const empty: CardRating = { synergies: [], effects: [] };
    const score = (text: string, type_line = 'Instant') => cardScore(card(text, { type_line, cmc: 1 }), empty, 'removal', 'midrange', 0, 10);
    const swords = score('Exile target creature. Its controller gains life equal to its power.');
    const bolt = score('Lightning Bolt deals 3 damage to any target.');
    const doomBlade = score('Destroy target nonblack creature.');
    const edict = score('Each opponent sacrifices a creature.');
    expect(swords).toBeGreaterThan(bolt);
    expect(bolt).toBeGreaterThanOrEqual(doomBlade);
    expect(doomBlade).toBeGreaterThan(edict);
    expect(score('Destroy target permanent. Its controller creates a 3/3 green Beast creature token.')).toBe(swords);
    // A cheap direct answer beats an expensive one with extra effects, whatever the synergies.
    const murder = cardScore(card('Destroy target creature.', { type_line: 'Instant', cmc: 2 }), empty, 'removal', 'midrange', 9, 10);
    const rider = cardScore(
      card('Lifelink\nWhen this creature enters, destroy target creature. You draw a card.', { type_line: 'Creature', cmc: 5 }),
      { synergies: ['graveyard'], effects: ['draw', 'etb'] },
      'removal',
      'voltron',
      0,
      10,
    );
    expect(murder).toBeGreaterThan(rider);
  });

  it('prefers real mana sources for ramp, cheap ones first, whatever the style', () => {
    const empty: CardRating = { synergies: [], effects: [] };
    const score = (text: string, extra: Partial<ScryfallCard>, rating = empty, style = 'midrange') =>
      cardScore(card(text, extra), rating, 'ramp', style, 0, 10);
    const growth = score('Enchant land\nWhenever enchanted land is tapped for mana, its controller adds an additional {G}.', { type_line: 'Enchantment — Aura', cmc: 1 });
    const solRing = score('{T}: Add {C}{C}.', { type_line: 'Artifact', cmc: 1 });
    const mindStone = score('{T}: Add {C}.\n{1}, {T}, Sacrifice Mind Stone: Draw a card.', { type_line: 'Artifact', cmc: 2 });
    const pickaxe = score(
      'Equipped creature gets +1/+1.\nWhenever equipped creature deals combat damage to a player, create a Treasure token.\nEquip {2}',
      { type_line: 'Artifact — Equipment', cmc: 1 },
      { synergies: ['combatDamage'], effects: ['mana'] },
      'voltron',
    );
    const altar = score('Sacrifice a creature: Add {C}{C}.', { type_line: 'Artifact', cmc: 3 });
    expect(growth).toBeGreaterThan(solRing);
    expect(solRing).toBeGreaterThan(mindStone);
    expect(score('{1}, {T}: Add {B}{R}.', { type_line: 'Artifact', cmc: 2 })).toBeGreaterThan(pickaxe);
    expect(mindStone).toBeGreaterThan(pickaxe);
    expect(mindStone).toBeGreaterThan(altar);
    expect(mindStone).toBeGreaterThan(score('{T}: Add {C}{C}{C}.', { type_line: 'Artifact', cmc: 4 }));
  });

  it('finds the cards that play into the commander', () => {
    const ids = commanderSynergies(lathril, ['Elf']);
    expect(cardSynergies(card('Other Elves you control get +1/+1.', { type_line: 'Creature — Elf Warrior' }), ids, ['Elf'])).toEqual(['tribal']);
    expect(cardSynergies(card('', { type_line: 'Creature — Elf Druid' }), ids, ['Elf'])).toEqual([]);
    expect(cardSynergies(card('Flying', { type_line: 'Creature — Bird', keywords: ['Flying'] }), ids, ['Elf'])).toEqual(['combatDamage']);
    expect(cardSynergies(card('Creatures you control get +1/+1.', { type_line: 'Enchantment' }), ids, ['Elf'])).toEqual(['tokens']);
    expect(cardSynergies(card('Draw a card.', { type_line: 'Sorcery' }), ids, ['Elf'])).toEqual([]);
  });
});

describe('card effects', () => {
  it('finds good effects for the role', () => {
    expect(cardEffects(card('When this creature enters, draw a card.', { type_line: 'Creature — Elf' }), 'creatures')).toEqual(['draw', 'etb']);
    expect(cardEffects(card('Destroy all creatures your opponents control.', { cmc: 5 }), 'wipes')).toEqual(['oneSided']);
    expect(cardEffects(card('{T}: Add {G} or {R}.', { type_line: 'Land', cmc: 0 }), 'lands', ['R', 'G'])).toEqual(['untapped', 'fixing']);
    expect(cardEffects(card('This land enters tapped.\n{T}: Add {G}.', { type_line: 'Land' }), 'lands', ['R', 'G'])).toEqual([]);
  });

  it('rates synergies above effects and popularity', () => {
    const plain = card('', { cmc: 3 });
    const synergy = cardScore(plain, { synergies: ['tokens'], effects: [] }, 'creatures', 'midrange', 9, 10);
    const effect = cardScore(plain, { synergies: [], effects: ['draw'] }, 'creatures', 'midrange', 0, 10);
    const popular = cardScore(plain, { synergies: [], effects: [] }, 'creatures', 'midrange', 0, 10);
    expect(synergy).toBeGreaterThan(effect);
    expect(effect).toBeGreaterThan(popular);
    expect(cardScore(card('', { cmc: 6 }), { synergies: [], effects: [] }, 'creatures', 'aggro', 0, 10)).toBeLessThan(
      cardScore(card('', { cmc: 2 }), { synergies: [], effects: [] }, 'creatures', 'aggro', 5, 10),
    );
  });
});

describe('play style fit', () => {
  it('recognises cards that carry a style', () => {
    expect(fitsStyle(card('Equipped creature gets +2/+2.\nEquip {2}', { type_line: 'Artifact — Equipment' }), 'voltron')).toBe(true);
    expect(fitsStyle(card('Create two 1/1 white Soldier creature tokens.'), 'goWide')).toBe(true);
    expect(fitsStyle(card('At the beginning of your upkeep, create a Treasure token.'), 'goWide')).toBe(false);
    expect(fitsStyle(card('Draw two cards.', { type_line: 'Instant' }), 'spellslinger')).toBe(true);
    expect(fitsStyle(card('Draw two cards.', { type_line: 'Instant' }), 'voltron')).toBe(false);
    expect(fitsStyle(card('Landfall — Whenever a land you control enters, create a 0/1 Plant creature token.'), 'landfall')).toBe(true);
    expect(fitsStyle(card('You may play an additional land on each of your turns.'), 'landfall')).toBe(true);
    expect(fitsStyle(card('Return target creature card from your graveyard to the battlefield.'), 'reanimator')).toBe(true);
    expect(fitsStyle(card('Mill three cards, then return a creature card from your graveyard to your hand.'), 'reanimator')).toBe(true);
    expect(fitsStyle(card('Target player mills eight cards.'), 'mill')).toBe(true);
    expect(fitsStyle(card('Mill three cards.'), 'mill')).toBe(false);
    expect(fitsStyle(card('Whenever you gain life, put a +1/+1 counter on target creature.'), 'lifegain')).toBe(true);
    expect(fitsStyle(card('', { keywords: ['Lifelink'] }), 'lifegain')).toBe(true);
    expect(fitsStyle(card('Draw two cards.'), 'lifegain')).toBe(false);
  });

  it('recommends the new play styles from the own cards', () => {
    const payoff = card('Whenever you gain life, each opponent loses 1 life.', { type_line: 'Enchantment', cmc: 3 });
    const landfall = card('Landfall — Whenever a land you control enters, you may draw a card.', { type_line: 'Creature — Elemental', cmc: 4 });
    expect(recommendStyle([payoff, payoff, card('Draw a card.', { type_line: 'Sorcery' })])?.style).toBe('lifegain');
    expect(recommendStyle([landfall, landfall, card('Draw a card.', { type_line: 'Sorcery' })])?.style).toBe('landfall');
  });

  it('does not count every flier as voltron', () => {
    const lyra = card('Flying\nFirst strike\nLifelink\nOther Angels you control get +1/+1 and have lifelink.', {
      type_line: 'Legendary Creature — Angel',
      cmc: 5,
      keywords: ['Flying', 'Lifelink', 'First strike'],
    });
    const dazzling = card('Flying\nWhenever another creature you control enters, you gain 1 life.', {
      type_line: 'Creature — Angel',
      cmc: 3,
      keywords: ['Flying'],
    });
    expect(recommendStyle([lyra, dazzling])?.style).toBe('lifegain');
    const sword = card('Equipped creature gets +2/+2.\nEquip {2}', { type_line: 'Artifact — Equipment' });
    expect(recommendStyle([sword, sword, dazzling])?.style).toBe('voltron');
  });

  it('does not call expensive hasty dragons aggro', () => {
    const smaug = card('Flying, indestructible, haste\nWhenever Smaug is dealt noncombat damage, create that many Treasure tokens.', {
      type_line: 'Legendary Creature — Dragon',
      cmc: 7,
      power: '8',
      keywords: ['Flying', 'Indestructible', 'Haste'],
    });
    const hoard = card('Flying, trample, haste', { type_line: 'Creature — Dragon', cmc: 9, keywords: ['Flying', 'Haste', 'Trample'] });
    const desire = card('Add {R} for each artifact your opponents control.', { type_line: 'Sorcery', cmc: 4 });
    expect(recommendStyle([smaug, hoard, desire])).toEqual({ style: 'bigMana', count: 3, total: 3 });
    const sword = card('Equipped creature gets +2/+2.\nEquip {2}', { type_line: 'Artifact — Equipment', cmc: 2 });
    expect(recommendStyle([sword, sword, card('Draw a card.', { type_line: 'Sorcery', cmc: 2 })])?.style).toBe('voltron');
    const goblin = card('Haste', { type_line: 'Creature — Goblin', cmc: 1, keywords: ['Haste'] });
    expect(recommendStyle([goblin, goblin, desire])?.style).toBe('aggro');
    // Its Treasures are no token army, and it is no voltron commander either: its ability wants it to be damaged.
    const tokens = card('Create two 1/1 white Soldier creature tokens.', { type_line: 'Sorcery', cmc: 3 });
    expect(commanderStyle(smaug, [smaug, tokens, desire])).not.toBe('voltron');
    expect(commanderStyle(smaug, [smaug, tokens, desire])).not.toBe('goWide');
  });
});

describe('power score', () => {
  it('prefers Game Changers and rare cards only in the high brackets', () => {
    const empty = { synergies: [], effects: [] };
    const gc = card('', { game_changer: true, rarity: 'rare', cmc: 2 });
    const common = card('', { rarity: 'common', cmc: 2 });
    expect(cardScore(gc, empty, 'draw', 'midrange', 9, 10, 2)).toBeLessThan(cardScore(common, empty, 'draw', 'midrange', 0, 10, 2));
    expect(cardScore(gc, empty, 'draw', 'midrange', 9, 10, 5)).toBeGreaterThan(cardScore(common, empty, 'draw', 'midrange', 0, 10, 5));
  });
});

describe('style advice', () => {
  it('recommends the style most own cards fit', () => {
    const spell = (text: string) => card(text, { type_line: 'Instant', cmc: 2 });
    expect(recommendStyle([spell('Draw two cards.'), spell('Counter target spell.'), spell('Deal 3 damage.'), card('', { type_line: 'Land' })])).toEqual({
      style: 'spellslinger',
      count: 3,
      total: 3,
    });
    const bear = card('', { type_line: 'Creature — Bear', cmc: 2 });
    expect(recommendStyle([bear, bear, bear, spell('Draw a card.')])?.style).toBe('aggro');
    expect(recommendStyle([card('', { type_line: 'Creature — Giant', cmc: 5 }), card('Gain 3 life.', { type_line: 'Sorcery', cmc: 3 })])).toBeUndefined();
    expect(recommendStyle([])).toBeUndefined();
  });
});

describe('commander style', () => {
  it('follows the commander, and among its styles the one most cards share', () => {
    const lyra = card('Flying, first strike, lifelink\nOther Angels you control get +1/+1 and have lifelink.', {
      type_line: 'Legendary Creature — Angel',
      cmc: 5,
      keywords: ['Flying', 'First strike', 'Lifelink'],
    });
    const spell = card('Draw two cards.', { type_line: 'Instant', cmc: 2 });
    expect(commanderStyle(lyra, [lyra, spell, spell, spell])).toBe('lifegain');
    expect(commanderStyle(undefined, [spell, spell, spell])).toBe('spellslinger');
    expect(commanderStyle(card('', { type_line: 'Legendary Creature — Bear', cmc: 4 }), [spell, spell])).toBe('spellslinger');
  });
});
