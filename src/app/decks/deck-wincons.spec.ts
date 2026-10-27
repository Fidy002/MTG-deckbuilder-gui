import { ScryfallCard } from '../scryfall/scryfall.models';
import { commanderSynergies } from './deck-synergies';
import { cardWincons, deckWincons, planFinishers, recommendPlan, winconQueries } from './deck-wincons';

const card = (name: string, oracle_text: string, extra: Partial<ScryfallCard> = {}) => ({ name, oracle_text, ...extra }) as ScryfallCard;

describe('win conditions', () => {
  it('finds what a card wins with', () => {
    expect(cardWincons(card('Craterhoof', 'Creatures you control get +X/+X and gain trample until end of turn.', { type_line: 'Creature — Beast' }))).toEqual(['overrun']);
    expect(cardWincons(card('Blood Artist', 'Whenever Blood Artist or another creature dies, target player loses 1 life and you gain 1 life.'))).toEqual([]);
    expect(cardWincons(card('Triumph', 'Until end of turn, creatures you control get +1/+1 and gain trample and infect.'))).toEqual(['overrun']);
    expect(cardWincons(card('Zulaport', 'Whenever a creature you control dies, each opponent loses 1 life and you gain 1 life.'))).toEqual(['aristocrats', 'drain']);
    expect(cardWincons(card('Propaganda', "Creatures can't attack you unless their controller pays {2} for each creature they control that's attacking you."))).toEqual(['pillowfort']);
    expect(cardWincons(card('Impact Tremors', 'Whenever a creature you control enters, Impact Tremors deals 1 damage to each opponent.'))).toEqual(['enterDamage', 'burn']);
    expect(cardWincons(card('Mesa Enchantress', 'Whenever you cast an enchantment spell, you may draw a card.'))).toEqual(['enchantress']);
    expect(cardWincons(card('Time Warp', 'Target player takes an extra turn after this one.'))).toEqual(['extraTurns']);
    expect(cardWincons(card('Thassa', 'If you would draw a card while your library has no cards in it, you win the game instead.'))).toEqual(['alternate']);
    expect(cardWincons(card('Teferi', '+1: Draw a card.', { type_line: 'Legendary Planeswalker — Teferi' }))).toEqual(['planeswalkers']);
    expect(cardWincons(card('Wurm', 'Trample', { type_line: 'Creature — Wurm', power: '7', keywords: ['Trample'] }))).toEqual(['combat']);
    expect(cardWincons(card('Bear', '', { type_line: 'Creature — Bear', power: '2' }))).toEqual([]);
    expect(cardWincons(card('Reanimate', 'Put target creature card from a graveyard onto the battlefield under your control.'))).toEqual(['reanimator']);
    expect(cardWincons(card('Grapeshot', 'Grapeshot deals 1 damage to any target.\nStorm', { keywords: ['Storm'] }))).toEqual(['storm']);
    expect(cardWincons(card('Doubling Season', 'If an effect would put one or more counters on a permanent you control, it puts twice that many.\nProliferate'))).toEqual(['counters']);
    expect(cardWincons(card('Lotus Cobra', 'Landfall — Whenever a land you control enters, add one mana of any color.'))).toEqual([]);
    expect(cardWincons(card('Akoum Hellhound', 'Landfall — Whenever a land you control enters, Akoum Hellhound deals 1 damage to each opponent.'))).toEqual(['landfall', 'burn']);
    expect(cardWincons(card('Treachery', 'When Treachery enters, untap up to five lands.\nYou control enchanted creature.'))).toEqual([]);
    expect(cardWincons(card('Mind Control', 'Gain control of target creature.'))).toEqual(['theft']);
  });

  it('recommends a main plan from the commander first, then from the play style, and the next best as backup', () => {
    expect(recommendPlan('voltron', [])).toEqual({ main: 'commanderDamage', backup: 'extraCombat' });
    expect(recommendPlan('midrange', ['tokens', 'lifegain'])).toEqual({ main: 'tokens', backup: 'lifegain' });
    expect(recommendPlan('control', [])).toEqual({ main: 'planeswalkers', backup: 'pillowfort' });
    expect(recommendPlan('control', ['planeswalkers'])).toEqual({ main: 'planeswalkers', backup: 'pillowfort' });
    const lathril = card('Lathril', '{T}, Tap ten untapped Elves you control: Each opponent loses 10 life and you gain 10 life.');
    expect(recommendPlan('midrange', ['tribal', 'tokens'], lathril)).toEqual({ main: 'drain', backup: 'typal' });
    expect(recommendPlan('spellslinger', ['spells'])).toEqual({ main: 'storm', backup: 'burn' });
    expect(planFinishers('overrun', true)).toBe(3);
    expect(planFinishers('overrun', false)).toBe(2);
  });

  it('searches the finishers of each win condition and lists those of the deck', () => {
    expect(winconQueries(['drain', 'alternate'])).toEqual(['(otag:life-drain or o:"each opponent loses")', 'otag:alternate-win-condition']);
    expect(winconQueries([])).toEqual([]);
    const zulaport = card('Zulaport', 'Each opponent loses 1 life.');
    const deck = deckWincons([zulaport, zulaport, card('Kokusho', 'When Kokusho dies, each opponent loses 5 life.')]);
    expect([...deck].map(([id, cards]) => [id, cards.length])).toEqual([['drain', 2]]);
  });
});

describe('big commander', () => {
  it('builds around a big, sturdy commander instead of treasure tokens as a token army', () => {
    const smaug = card('Smaug the Impenetrable', 'Flying, indestructible, haste\nWhenever Smaug is dealt noncombat damage, create that many Treasure tokens.', {
      type_line: 'Legendary Creature — Dragon',
      power: '8',
      keywords: ['Flying', 'Indestructible', 'Treasure', 'Haste'],
    });
    const synergies = commanderSynergies(smaug, ['Dragon']);
    expect(synergies).toContain('bigCommander');
    expect(synergies).not.toContain('tokens');
    expect(recommendPlan('midrange', synergies, smaug)).toEqual({ main: 'commanderDamage', backup: 'treasure' });
  });
});
