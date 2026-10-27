import { ScryfallCard } from '../scryfall/scryfall.models';
import { SuggestionRole } from './deck-suggestions';

export type SynergyId =
  | 'bigCommander'
  | 'tokens'
  | 'combatDamage'
  | 'attacks'
  | 'tribal'
  | 'counters'
  | 'spells'
  | 'graveyard'
  | 'lifegain'
  | 'artifacts'
  | 'enchantments'
  | 'planeswalkers'
  | 'landfall';

interface Synergy {
  id: SynergyId;
  roles: readonly SuggestionRole[];
  commander: (text: string, types: readonly string[], card: ScryfallCard) => boolean;
  card: (card: ScryfallCard, text: string, types: readonly string[]) => boolean;
}

const EVASION = ['Flying', 'Trample', 'Menace', 'Shadow', 'Horsemanship', 'Fear', 'Intimidate', 'Skulk'];

const plural = (type: string) => (type.endsWith('f') ? `${type.slice(0, -1)}ves` : `${type}s`);

function namesType(text: string, types: readonly string[]): boolean {
  return types.some((type) => new RegExp(`\\b(?:${type}|${plural(type)})\\b`).test(text));
}

function hasKeyword(card: ScryfallCard, keywords: readonly string[]): boolean {
  return (card.keywords ?? []).some((k) => keywords.includes(k));
}

function isType(card: ScryfallCard, type: string): boolean {
  return (card.type_line ?? '').includes(type);
}

// A commander that is a threat on its own: big, evasive and hard to remove – worth making even bigger.
const STURDY = ['Indestructible', 'Hexproof', 'Ward', 'Shroud', 'Protection'];
const BIG_COMMANDER_POWER = 5;

const SYNERGIES: readonly Synergy[] = [
  {
    id: 'bigCommander',
    roles: ['theme', 'removal'],
    commander: (_text, _types, card) =>
      isType(card, 'Creature') &&
      Number(card.power) >= BIG_COMMANDER_POWER &&
      hasKeyword(card, EVASION) &&
      hasKeyword(card, [...STURDY, 'Haste']),
    card: (card, text) =>
      ((isType(card, 'Equipment') || isType(card, 'Aura')) && /equipped creature|enchanted creature/i.test(text)) ||
      /(?:target|creatures?|permanents?) you control[^.]*(?:gains?|have|has) (?:hexproof|indestructible|protection|shroud|double strike)/i.test(text),
  },
  {
    id: 'tribal',
    roles: ['creatures', 'draw'],
    commander: (text, types) => namesType(text, types),
    card: (_card, text, types) => namesType(text, types),
  },
  {
    id: 'tokens',
    roles: ['creatures', 'draw'],
    commander: (text) => /create[^.]*\bcreature tokens?\b/i.test(text),
    card: (_card, text) => /creatures? you control get|whenever (?:a|another|one or more) (?:nontoken )?creatures?[^.]* enters|tokens? you control|populate/i.test(text),
  },
  {
    id: 'combatDamage',
    roles: ['creatures'],
    commander: (text) => /deals combat damage to (?:a player|an opponent|one or more)/i.test(text),
    card: (card, text) => hasKeyword(card, EVASION) || /can't be blocked/i.test(text),
  },
  {
    id: 'attacks',
    roles: ['creatures'],
    commander: (text) => /whenever [^.]*\battacks?\b/i.test(text),
    card: (card, text) => hasKeyword(card, ['Haste', 'Vigilance', 'Myriad']) || /additional combat|gains? haste/i.test(text),
  },
  {
    id: 'counters',
    roles: ['creatures', 'draw'],
    commander: (text) => /\+1\/\+1 counters?/i.test(text),
    card: (card, text) => /\+1\/\+1 counters?|proliferate/i.test(text) || hasKeyword(card, ['Proliferate', 'Evolve', 'Modular']),
  },
  {
    id: 'spells',
    roles: ['draw', 'removal', 'creatures'],
    commander: (text) => /instant or sorcery|instants? and sorcer|noncreature spells?/i.test(text),
    card: (card, text) => ((isType(card, 'Instant') || isType(card, 'Sorcery')) && (card.cmc ?? 9) <= 2) || /instant or sorcery|noncreature spells?/i.test(text),
  },
  {
    id: 'graveyard',
    roles: ['creatures', 'removal'],
    commander: (text) => /from your graveyard|\bdies\b|sacrifice/i.test(text),
    card: (_card, text) => /from your graveyard|\bdies\b|sacrifice a|mill/i.test(text),
  },
  {
    id: 'lifegain',
    roles: ['creatures', 'draw'],
    commander: (text) => /whenever you gain life|lifelink|life you(?:'ve)? gained/i.test(text),
    card: (card, text) => hasKeyword(card, ['Lifelink']) || /gains? (?:\w+ )?life/i.test(text),
  },
  {
    id: 'artifacts',
    roles: ['creatures', 'ramp', 'draw'],
    commander: (text) => /artifacts? you control|artifact spells?|whenever an artifact/i.test(text),
    card: (card, text) => isType(card, 'Artifact') || /artifacts? you control/i.test(text),
  },
  {
    id: 'enchantments',
    roles: ['creatures', 'draw'],
    commander: (text) => /enchantments? you control|enchantment spells?|whenever an enchantment/i.test(text),
    card: (card, text) => isType(card, 'Enchantment') || /enchantments? you control/i.test(text),
  },
  {
    id: 'planeswalkers',
    roles: ['draw', 'removal', 'theme'],
    commander: (text) => /planeswalkers?|loyalty/i.test(text),
    card: (card, text) => isType(card, 'Planeswalker') || /proliferate|loyalty counters?|planeswalkers? you control/i.test(text),
  },
  {
    id: 'landfall',
    roles: ['ramp', 'lands', 'creatures'],
    commander: (text) => /landfall|whenever a land (?:you control )?enters/i.test(text),
    card: (card, text) => hasKeyword(card, ['Landfall']) || /search your library for [^.]*lands?|play an additional land|landfall/i.test(text),
  },
];

export function cardText(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
}

/** What the commander's abilities build on, e.g. tokens or combat damage. */
export function commanderSynergies(commander: ScryfallCard | undefined, types: readonly string[] = []): SynergyId[] {
  if (!commander) {
    return [];
  }
  const text = cardText(commander);
  return SYNERGIES.filter((s) => s.commander(text, types, commander)).map((s) => s.id);
}

/** The synergies of the commander that matter for cards of this role. */
export function roleSynergies(ids: readonly SynergyId[], role: SuggestionRole): SynergyId[] {
  return SYNERGIES.filter((s) => ids.includes(s.id) && s.roles.includes(role)).map((s) => s.id);
}

/** The synergies of the commander a card plays into. */
export function cardSynergies(card: ScryfallCard, ids: readonly SynergyId[], types: readonly string[] = []): SynergyId[] {
  const text = cardText(card);
  return SYNERGIES.filter((s) => ids.includes(s.id) && s.card(card, text, types)).map((s) => s.id);
}

export type EffectId = 'protection' | 'mana' | 'draw' | 'removal' | 'etb' | 'instant' | 'repeatable' | 'oneSided' | 'cheap' | 'untapped' | 'fixing';

interface Effect {
  id: EffectId;
  roles: readonly SuggestionRole[];
  card: (card: ScryfallCard, text: string, colors: readonly string[]) => boolean;
}

const EFFECTS: readonly Effect[] = [
  {
    id: 'protection',
    roles: ['creatures', 'removal', 'draw', 'ramp'],
    card: (_card, text) => /(?:target|creatures?|permanents?) you control[^.]*(?:gains?|have|has) (?:hexproof|indestructible|protection|shroud)/i.test(text),
  },
  {
    id: 'mana',
    roles: ['creatures', 'draw'],
    card: (_card, text) => /\{T\}: Add |search your library for (?:a|up to \w+) (?:basic )?lands?/i.test(text),
  },
  {
    id: 'draw',
    roles: ['creatures', 'ramp', 'removal'],
    card: (_card, text) => /\bdraws? (?:a|an additional|two|three|\w+) cards?\b/i.test(text),
  },
  {
    id: 'removal',
    roles: ['creatures', 'draw'],
    card: (_card, text) => /(?:destroy|exile) (?:up to one )?target (?:creature|artifact|enchantment|permanent|nonland)/i.test(text),
  },
  {
    id: 'etb',
    roles: ['creatures'],
    card: (_card, text) => /\bwhen [^.]* enters\b/i.test(text),
  },
  {
    id: 'instant',
    roles: ['removal', 'draw'],
    card: (card, text) => (card.type_line ?? '').includes('Instant') || /\bflash\b/i.test(text),
  },
  {
    id: 'repeatable',
    roles: ['draw'],
    card: (_card, text) => /whenever [^.]*draws? (?:a|an additional) card|whenever [^.]*, draw a card|at the beginning of [^.]*draw/i.test(text),
  },
  {
    id: 'oneSided',
    roles: ['wipes'],
    card: (_card, text) => /(?:creatures?|permanents?) (?:your opponents control|you don't control)|each opponent sacrifices/i.test(text),
  },
  {
    id: 'cheap',
    roles: ['ramp', 'removal', 'draw'],
    card: (card) => (card.cmc ?? 9) <= 2,
  },
  {
    id: 'untapped',
    roles: ['lands'],
    card: (_card, text) => !/enters (?:the battlefield )?tapped/i.test(text) || /tapped unless/i.test(text),
  },
  {
    id: 'fixing',
    roles: ['lands'],
    card: (card, text, colors) => {
      const produced = colors.filter((c) => new RegExp(`\\{${c}\\}`).test(text) || (card.produced_mana ?? []).includes(c));
      return produced.length >= 2 || /mana of any (?:color|type)/i.test(text);
    },
  },
];

/** Good effects of a card for its role, beyond what the commander asks for: e.g. a creature that also draws or removes. */
export function cardEffects(card: ScryfallCard, role: SuggestionRole, colors: readonly string[] = []): EffectId[] {
  const text = cardText(card);
  return EFFECTS.filter((e) => e.roles.includes(role) && e.card(card, text, colors)).map((e) => e.id);
}

const STYLE_FIT_SCORE = 1.5;

export interface CardRating {
  synergies: readonly SynergyId[];
  effects: readonly EffectId[];
}

/**
 * How well a card fits: synergies with the commander count most, then good effects, then how the mana value suits the
 * play style; the popularity rank (index in the suggestions) breaks ties.
 */
// Cards that carry a play style, e.g. token makers for go-wide or evasive creatures and equipment for voltron.
const STYLE_FITS: Record<string, (card: ScryfallCard, text: string) => boolean> = {
  aggro: (card) => hasKeyword(card, ['Haste', 'Menace', 'Trample', 'First strike']),
  control: (_card, text) => /counter target spell|\bflash\b|return target [^.]* to (?:its|their) owner's hand/i.test(text),
  goWide: (_card, text) => /create[^.]*\btokens?\b|creatures you control get/i.test(text),
  voltron: (card, text) =>
    hasKeyword(card, ['Flying', 'Trample', 'Double strike', 'Hexproof', 'Indestructible', 'Equip']) ||
    /equipped creature|enchanted creature|gains? (?:hexproof|indestructible|protection)/i.test(text),
  spellslinger: (card, text) => isType(card, 'Instant') || isType(card, 'Sorcery') || /instant or sorcery|noncreature spell/i.test(text),
  bigMana: (card, text) =>
    (card.cmc ?? 0) >= 6 || /\{T\}: Add \{\w\}\{\w\}|add \{\w\} for each|search your library for [^.]*lands?|double the amount of mana/i.test(text),
  combo: (_card, text) => /search your library for a card|untap (?:target|all|each)|copy target|whenever [^.]* untaps/i.test(text),
  landfall: (_card, text) => /landfall|whenever a land (?:you control )?enters|play an additional land|land cards? from your graveyard/i.test(text),
  reanimator: (_card, text) =>
    /from (?:a|your) graveyards? (?:on)?to the battlefield|return target creature card from your graveyard|\bmills? (?:one|two|three|four|five|x) cards|discard (?:a|two|three) cards?/i.test(text),
  mill: (_card, text) => /(?:target|each) (?:player|opponent)s? mills?|mills? (?:that many|x|half)/i.test(text),
  lifegain: (card, text) => hasKeyword(card, ['Lifelink']) || /you gain \d+ life|you gain life|whenever you gain life|life you(?:'ve)? gained/i.test(text),
};

// For the recommendation, voltron needs real equipment or auras, or a legend built to carry the deck alone (big, evasive
// and protected, like Smaug the Impenetrable): evasion alone (any flier) says nothing about the deck.
// Aggro only counts cheap cards – a 7 mana dragon with haste is no aggro card.
const AGGRO_ADVICE_MAX_MV = 3;
const STYLE_ADVICE_FITS: Record<string, (card: ScryfallCard, text: string) => boolean> = {
  ...STYLE_FITS,
  aggro: (card, text) => (card.cmc ?? 0) <= AGGRO_ADVICE_MAX_MV && STYLE_FITS['aggro'](card, text),
  voltron: (card, text) =>
    isType(card, 'Equipment') ||
    isType(card, 'Aura') ||
    /equipped creature|enchanted creature|equip/i.test(text) ||
    (isType(card, 'Legendary') &&
      isType(card, 'Creature') &&
      Number(card.power) >= BIG_COMMANDER_POWER &&
      hasKeyword(card, EVASION) &&
      hasKeyword(card, STURDY)),
};

const STYLE_ADVICE_SHARE = 0.25;
const STYLE_ADVICE_MIN = 2;
const AGGRO_CREATURE_SHARE = 0.6;
const AGGRO_MAX_AVERAGE_MV = 2.5;

export interface StyleAdvice {
  style: string;
  // Own non-land cards that fit the style, out of all of them.
  count: number;
  total: number;
}

/**
 * The play style the own cards point to: the style most of them fit, if at least a quarter (and two) do; many cheap
 * creatures also point to aggro. Undefined when the cards say nothing clear – the user then picks freely.
 */
export function recommendStyle(cards: readonly ScryfallCard[]): StyleAdvice | undefined {
  const spells = cards.filter((card) => !isType(card, 'Land'));
  if (!spells.length) {
    return undefined;
  }
  const scores = Object.entries(STYLE_ADVICE_FITS).map(([style, fits]) => ({
    style,
    count: spells.filter((card) => fits(card, cardText(card))).length,
  }));
  const creatures = spells.filter((card) => isType(card, 'Creature'));
  const averageMv = creatures.reduce((sum, card) => sum + (card.cmc ?? 0), 0) / Math.max(1, creatures.length);
  if (creatures.length / spells.length >= AGGRO_CREATURE_SHARE && averageMv <= AGGRO_MAX_AVERAGE_MV) {
    const aggro = scores.find((s) => s.style === 'aggro')!;
    aggro.count = Math.max(aggro.count, creatures.length);
  }
  const best = scores.sort((a, b) => b.count - a.count)[0];
  return best.count >= STYLE_ADVICE_MIN && best.count / spells.length >= STYLE_ADVICE_SHARE
    ? { ...best, total: spells.length }
    : undefined;
}

/**
 * The play style of a deck that has a commander: one the commander itself plays into, the one most of the other cards
 * share if it fits several; otherwise what the cards point to.
 */
export function commanderStyle(commander: ScryfallCard | undefined, cards: readonly ScryfallCard[]): string | undefined {
  const spells = cards.filter((card) => card !== commander && !isType(card, 'Land'));
  const own = commander ? Object.entries(STYLE_ADVICE_FITS).filter(([, fits]) => fits(commander, cardText(commander))) : [];
  if (!own.length) {
    return recommendStyle(spells)?.style;
  }
  return own
    .map(([style, fits]) => ({ style, count: spells.filter((card) => fits(card, cardText(card))).length }))
    .sort((a, b) => b.count - a.count)[0].style;
}

/** Whether a card plays into the play style. */
export function fitsStyle(card: ScryfallCard, style: string): boolean {
  return !!STYLE_FITS[style]?.(card, cardText(card));
}

/**
 * How well a card fits: synergies with the commander count most, then the play style and good effects, then how the
 * mana value suits the play style; the popularity rank (index in the suggestions) breaks ties.
 */
export function cardScore(
  card: ScryfallCard,
  rating: CardRating,
  role: SuggestionRole,
  style: string,
  index: number,
  total: number,
  bracket = 0,
): number {
  const cmc = card.cmc ?? 0;
  let curve = 0;
  if (role === 'creatures' && (style === 'aggro' || style === 'goWide')) {
    curve = cmc <= 3 ? 1 : cmc >= 5 ? -1.5 : 0;
  } else if (role === 'creatures' && style === 'control') {
    curve = cmc <= 2 ? -0.5 : 0;
  } else if (role !== 'lands' && style !== 'bigMana') {
    curve = cmc >= 6 ? -1 : 0;
  }
  const styleFit = fitsStyle(card, style) ? STYLE_FIT_SCORE : 0;
  return rating.synergies.length * 3 + styleFit + rating.effects.length + curve + powerScore(card, bracket) + (total - index) / Math.max(1, total);
}

// High brackets want the strongest cards: Game Changers above all, then mythics and rares.
function powerScore(card: ScryfallCard, bracket: number): number {
  if (bracket < 3) {
    return 0;
  }
  const gameChanger = card.game_changer ? (bracket >= 4 ? 3 : 1) : 0;
  const rarity = bracket >= 4 ? ({ mythic: 1, rare: 0.6 } as Record<string, number>)[card.rarity ?? ''] ?? 0 : 0;
  return gameChanger + rarity;
}
