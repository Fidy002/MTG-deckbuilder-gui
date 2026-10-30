import { ScryfallCard } from '../scryfall/scryfall.models';
import type { PlayStyle, SuggestionRole } from './deck-suggestions';

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

/**
 * The curve the picks of each role should follow on their own: mana as cheap as possible, answers cheap, wipes in the
 * middle. Creatures follow the play style; the finishers and lands have none.
 */
const ROLE_CURVES: Partial<Record<SuggestionRole, readonly number[]>> = {
  ramp: [0.45, 0.45, 0.1, 0, 0, 0, 0],
  draw: [0.1, 0.3, 0.3, 0.17, 0.08, 0.05, 0],
  removal: [0.3, 0.35, 0.2, 0.1, 0.05, 0, 0],
  wipes: [0, 0.1, 0.3, 0.25, 0.2, 0.1, 0.05],
  tutors: [0.3, 0.45, 0.2, 0.05, 0, 0, 0],
};

export function roleCurve(role: SuggestionRole, style: PlayStyle): readonly number[] | undefined {
  return role === 'creatures' ? STYLE_CURVES[style] : ROLE_CURVES[role];
}

// The highest share of any style, so mini curves of different styles share one scale.
export const STYLE_CURVE_MAX = Math.max(...Object.values(STYLE_CURVES).flat());

// How much a card in a bucket the curve still misses (or already has too much of) changes its rank.
const CURVE_WEIGHT = 3;
const MAX_CURVE_SCORE = 1.5;
// A bucket that is already full pushes harder, so strong cards alone cannot pile up at the top end.
const MAX_CURVE_MALUS = 6;
// A role's own curve counts more than the deck's: it keeps e.g. the creatures spread even when the deck is still empty.
const ROLE_CURVE_WEIGHT = 2;

/** A curve the picks should follow: the cards per bucket so far, the share wanted per bucket and the cards in the end. */
export interface CurveGoal {
  counts: readonly number[];
  target: readonly number[];
  total: number;
}

// Spells that get cheaper with the board ("costs {1} less to cast for each creature", Blasphemous Act) are usually cast
// for a few mana; their printed mana value would put them at the top of the curve.
const SELF_REDUCING = /costs \{1\} less to cast for each/i;
const SELF_REDUCED_MV = 3;

/** The mana a card usually costs to cast: its mana value, or less for spells that get cheaper with the board. */
export function effectiveManaValue(card: ScryfallCard): number {
  const cmc = card.cmc ?? 0;
  const text = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].join('\n');
  return SELF_REDUCING.test(text) ? Math.min(cmc, SELF_REDUCED_MV) : cmc;
}

export function curveBucket(card: ScryfallCard): number {
  return Math.min(CURVE_LABELS.length - 1, Math.max(0, Math.floor(effectiveManaValue(card)) - 1));
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
 * measured against the non-land cards the deck should end up with. A bucket the curve wants nothing in gets the full malus.
 */
export function curveScore(card: ScryfallCard, counts: readonly number[], target: readonly number[], nonLands: number, weight = 1): number {
  if (isLand(card) || !nonLands) {
    return 0;
  }
  const bucket = curveBucket(card);
  if (!target[bucket]) {
    return -MAX_CURVE_MALUS * weight;
  }
  const gap = (target[bucket] * nonLands - counts[bucket]) / nonLands;
  const score = gap * CURVE_WEIGHT * CURVE_LABELS.length;
  return (gap < 0 ? Math.max(-MAX_CURVE_MALUS, score * 2) : Math.min(MAX_CURVE_SCORE, score)) * weight;
}

/**
 * Picks `count` cards from the ranked candidates one by one, each time adding the curve score for the curve as it is
 * after the picks so far – so the picks fill the gaps of the curve instead of piling up in one mana value. With a role
 * goal, the picks also follow the role's own curve (which weighs more).
 */
export function pickAlongCurve<T extends { card: ScryfallCard; score: number }>(
  candidates: readonly T[],
  count: number,
  counts: readonly number[],
  target: readonly number[],
  nonLands: number,
  copies = 1,
  role?: CurveGoal,
): T[] {
  const curve = [...counts];
  const roleCounts = [...(role?.counts ?? CURVE_LABELS.map(() => 0))];
  const value = (c: T) =>
    c.score +
    curveScore(c.card, curve, target, nonLands) +
    (role ? curveScore(c.card, roleCounts, role.target, role.total, ROLE_CURVE_WEIGHT) : 0);
  const left = [...candidates];
  const picked: T[] = [];
  while (picked.length < count && left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (value(left[i]) > value(left[best])) {
        best = i;
      }
    }
    const [next] = left.splice(best, 1);
    picked.push(next);
    if (!isLand(next.card)) {
      curve[curveBucket(next.card)] += copies;
      roleCounts[curveBucket(next.card)] += copies;
    }
  }
  return picked;
}
