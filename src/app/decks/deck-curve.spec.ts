import { ScryfallCard } from '../scryfall/scryfall.models';
import { STYLE_CURVES, curveBucket, curveScore, manaCurve, pickAlongCurve } from './deck-curve';

const card = (name: string, cmc: number, type_line = 'Creature') => ({ name, cmc, type_line }) as ScryfallCard;

describe('mana curve', () => {
  it('counts non-land cards per mana value bucket', () => {
    expect([0, 1, 2, 3, 7, 12].map((cmc) => curveBucket(card('x', cmc)))).toEqual([0, 0, 1, 2, 6, 6]);
    expect(manaCurve([{ card: card('a', 2), count: 4 }, { card: card('b', 5), count: 1 }, { card: card('Forest', 0, 'Basic Land — Forest'), count: 10 }])).toEqual([
      0, 4, 0, 0, 1, 0, 0,
    ]);
  });

  it('rewards cards that fill a gap of the curve', () => {
    const counts = [0, 0, 0, 0, 0, 10, 0];
    expect(curveScore(card('cheap', 2), counts, STYLE_CURVES.aggro, 40)).toBeGreaterThan(0);
    expect(curveScore(card('six', 6), counts, STYLE_CURVES.aggro, 40)).toBeLessThan(0);
    expect(curveScore(card('land', 0, 'Land'), counts, STYLE_CURVES.aggro, 40)).toBe(0);
  });

  it('spreads the picks over the curve instead of piling them up', () => {
    const candidates = [card('a', 2), card('b', 2), card('c', 2), card('d', 2), card('e', 3), card('f', 4)].map((c, i) => ({ card: c, score: 6 - i * 0.1 }));
    const picked = pickAlongCurve(candidates, 3, [0, 0, 0, 0, 0, 0, 0], STYLE_CURVES.midrange, 6).map((p) => p.card.name);
    expect(picked).toContain('e');
    expect(picked).toContain('f');
  });
});
