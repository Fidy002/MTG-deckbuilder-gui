import { ScryfallCard } from '../scryfall/scryfall.models';
import type { PlayStyle } from './deck-suggestions';

// Mana value buckets of the curve: 0–1, 2, 3, 4, 5, 6, 7+.
export const CURVE_LABELS = ['0–1', '2', '3', '4', '5', '6', '7+'] as const;

/**
 * The share of the non-land cards each play style wants per mana value bucket: aggressive decks lean on cheap cards,
 * big mana spreads up to the top end.
 */
export const STYLE_CURVES: Record<PlayStyle, readonly number[]> = {
  // Low and fast: the peak at 2, little above 4.
  aggro: [0.2, 0.36, 0.24, 0.12, 0.05, 0.02, 0.01],
  // The bulk at 3–4.
  midrange: [0.06, 0.15, 0.25, 0.26, 0.16, 0.08, 0.04],
  // Cheap answers, then a long tail of expensive card advantage and finishers.
  control: [0.06, 0.22, 0.14, 0.14, 0.14, 0.14, 0.16],
  // Token makers at 2–3, a few anthems and overruns above.
  goWide: [0.1, 0.3, 0.32, 0.16, 0.07, 0.03, 0.02],
  // Cheap equipment, auras and protection at 1–2; the commander does the rest.
  voltron: [0.18, 0.32, 0.22, 0.13, 0.08, 0.05, 0.02],
  // Many cheap spells at 1–3, the peak at 2–3.
  spellslinger: [0.16, 0.3, 0.28, 0.14, 0.07, 0.03, 0.02],
  // Ramp at 2–3, then the big spells.
  bigMana: [0.04, 0.2, 0.14, 0.08, 0.1, 0.18, 0.26],
  // Cheap tutors, rituals and interaction to find the pieces early; a few pricier combo pieces.
  combo: [0.22, 0.3, 0.2, 0.12, 0.08, 0.05, 0.03],
  // Ramp and landfall payoffs at 2–4; few expensive cards, the lands do the work.
  landfall: [0.1, 0.3, 0.26, 0.16, 0.1, 0.05, 0.03],
  // Cheap enablers that fill the graveyard and bring creatures back, plus a few huge targets at the top.
  reanimator: [0.16, 0.24, 0.2, 0.12, 0.08, 0.08, 0.12],
  // Like control: cheap answers and mill spells, a few large mill effects later.
  mill: [0.12, 0.26, 0.22, 0.16, 0.12, 0.07, 0.05],
  // Lifegain creatures at 2–3, payoffs at 3–4.
  lifegain: [0.12, 0.28, 0.24, 0.18, 0.1, 0.05, 0.03],
};

// The highest share of any style, so mini curves of different styles share one scale.
export const STYLE_CURVE_MAX = Math.max(...Object.values(STYLE_CURVES).flat());

// How much a card in a bucket the curve still misses (or already has too much of) changes its rank.
const CURVE_WEIGHT = 3;
const MAX_CURVE_SCORE = 1.5;
// A bucket that is already full pushes harder, so strong cards alone cannot pile up at the top end.
const MAX_CURVE_MALUS = 6;

export function curveBucket(card: ScryfallCard): number {
  return Math.min(CURVE_LABELS.length - 1, Math.max(0, Math.floor(card.cmc ?? 0) - 1));
}

function isLand(card: ScryfallCard): boolean {
  return (card.type_line ?? '').split('//')[0].includes('Land');
}

/** Non-land cards per mana value bucket (copies included). */
export function manaCurve(cards: readonly { card: ScryfallCard; count: number }[]): number[] {
  const counts = CURVE_LABELS.map(() => 0);
  for (const { card, count } of cards) {
    if (!isLand(card)) {
      counts[curveBucket(card)] += count;
    }
  }
  return counts;
}

/**
 * Bonus for a card whose bucket the curve still misses, malus for one that is already over the style's share –
 * measured against the non-land cards the deck should end up with.
 */
export function curveScore(card: ScryfallCard, counts: readonly number[], target: readonly number[], nonLands: number): number {
  if (isLand(card) || !nonLands) {
    return 0;
  }
  const bucket = curveBucket(card);
  const gap = (target[bucket] * nonLands - counts[bucket]) / nonLands;
  const score = gap * CURVE_WEIGHT * CURVE_LABELS.length;
  return gap < 0 ? Math.max(-MAX_CURVE_MALUS, score * 2) : Math.min(MAX_CURVE_SCORE, score);
}

/**
 * Picks `count` cards from the ranked candidates one by one, each time adding the curve score for the curve as it is
 * after the picks so far – so the picks fill the gaps of the curve instead of piling up in one mana value.
 */
export function pickAlongCurve<T extends { card: ScryfallCard; score: number }>(
  candidates: readonly T[],
  count: number,
  counts: readonly number[],
  target: readonly number[],
  nonLands: number,
  copies = 1,
): T[] {
  const curve = [...counts];
  const left = [...candidates];
  const picked: T[] = [];
  while (picked.length < count && left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      const value = (c: T) => c.score + curveScore(c.card, curve, target, nonLands);
      if (value(left[i]) > value(left[best])) {
        best = i;
      }
    }
    const [next] = left.splice(best, 1);
    picked.push(next);
    if (!isLand(next.card)) {
      curve[curveBucket(next.card)] += copies;
    }
  }
  return picked;
}
