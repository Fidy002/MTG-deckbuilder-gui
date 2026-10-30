import { ScryfallCard } from '../scryfall/scryfall.models';
import { effectiveManaValue } from './deck-curve';
import { SuggestionRole, lordClause } from './deck-suggestions';

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
  | 'landfall'
  | 'creatureSpells';

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

// The type of the front face: a creature with an adventure (Creature // Sorcery) is a creature to play.
function isFrontType(card: ScryfallCard, type: string): boolean {
  return (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').includes(type);
}

// A commander that is a threat on its own: big, evasive and hard to remove – worth making even bigger.
const STURDY = ['Indestructible', 'Hexproof', 'Ward', 'Shroud', 'Protection'];
const BIG_COMMANDER_POWER = 5;

// An ability the deck is built around instead of the commander's own hits: a trigger that is not about its attacks
// (Niv-Mizzet drawing, Atraxa proliferating, Korvold sacrificing), one that wants it damaged (Smaug), or creature types
// it cares about (The Ur-Dragon's Dragons).
const DAMAGE_ENGINE = /whenever [^.]*\bis dealt (?:noncombat )?damage/i;
const TYPE_MATTERS = /\b(?!Creature|Legendary|Other|Nontoken|Token)[A-Z][a-z]+s? (?:spells you cast|you control)/;
function hasEngine(card: ScryfallCard): boolean {
  const text = cardText(card);
  const triggers = text
    .split('\n')
    .map((line) => line.replace(/^[^—\n]*— /, ''))
    .filter((line) => /^(?:whenever|at the beginning)\b/i.test(line));
  return triggers.some((line) => !/\battacks?\b|\bcombat damage/i.test(line)) || DAMAGE_ENGINE.test(text) || TYPE_MATTERS.test(text);
}

const SYNERGIES: readonly Synergy[] = [
  {
    id: 'bigCommander',
    roles: ['theme', 'removal'],
    commander: (_text, _types, card) =>
      isType(card, 'Creature') &&
      Number(card.power) >= BIG_COMMANDER_POWER &&
      hasKeyword(card, EVASION) &&
      hasKeyword(card, [...STURDY, 'Haste']) &&
      !hasEngine(card),
    card: (card, text) =>
      ((isType(card, 'Equipment') || isType(card, 'Aura')) && /equipped creature|enchanted creature/i.test(text)) ||
      /(?:target|creatures?|permanents?) you control[^.]*(?:gains?|have|has) (?:hexproof|indestructible|protection|shroud|double strike)/i.test(text),
  },
  {
    id: 'tribal',
    roles: ['creatures', 'draw'],
    commander: (text, types) => namesType(text, types),
    // Only lords: a creature that merely is of the type plays like any other.
    card: (_card, text, types) => !!lordClause(text, types),
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
    commander: (text) => /whenever [^.]*\battacks?\b|attacking causes/i.test(text),
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
    commander: (text) => /from your graveyard|\bdies\b|\bdying\b|sacrifice/i.test(text),
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
  {
    // A commander that rewards casting creatures (Chulane): creatures with a strong effect when they enter.
    id: 'creatureSpells',
    roles: ['creatures'],
    commander: (text) => /whenever you cast a creature spell|creature spells you cast/i.test(text),
    card: (card, text) => isFrontType(card, 'Creature') && /when [^.]* enters/i.test(text),
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
  // Creature tokens only: Treasures, Food or Clues are no army.
  goWide: (_card, text) => /create[^.]*\bcreature tokens?\b|creatures you control get/i.test(text),
  voltron: (card, text) =>
    hasKeyword(card, ['Flying', 'Trample', 'Double strike', 'Hexproof', 'Indestructible', 'Equip']) ||
    /equipped creature|enchanted creature|gains? (?:hexproof|indestructible|protection)/i.test(text),
  spellslinger: (card, text) => isFrontType(card, 'Instant') || isFrontType(card, 'Sorcery') || /instant or sorcery|noncreature spell/i.test(text),
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
// A legend built to carry the deck alone: big, evasive and protected.
function carriesTheDeck(card: ScryfallCard): boolean {
  return isVoltronLegend(card) && Number(card.power) >= BIG_COMMANDER_POWER && hasKeyword(card, STURDY);
}

// A legend that can win on its own once it is pumped and protected: evasive and already hitting hard – unless it has
// an engine (see hasEngine): then the deck is built around that, not around pumping it.
const VOLTRON_LEGEND_POWER = 4;
function isVoltronLegend(card: ScryfallCard): boolean {
  return (
    isType(card, 'Legendary') &&
    isFrontType(card, 'Creature') &&
    Number(card.power) >= VOLTRON_LEGEND_POWER &&
    hasKeyword(card, EVASION) &&
    !hasEngine(card)
  );
}

const STYLE_ADVICE_FITS: Record<string, (card: ScryfallCard, text: string) => boolean> = {
  ...STYLE_FITS,
  aggro: (card, text) => (card.cmc ?? 0) <= AGGRO_ADVICE_MAX_MV && STYLE_FITS['aggro'](card, text),
  voltron: (card, text) =>
    isType(card, 'Equipment') || isType(card, 'Aura') || /equipped creature|enchanted creature|\bequip\b/i.test(text) || isVoltronLegend(card),
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
 * The play style of a deck that has a commander: voltron for a legend built to carry the deck alone (its high mana value
 * or Treasures make no other style); otherwise one the commander itself plays into, the one most of the other cards
 * share if it fits several; otherwise what the cards point to.
 */
export function commanderStyle(commander: ScryfallCard | undefined, cards: readonly ScryfallCard[]): string | undefined {
  if (commander && carriesTheDeck(commander)) {
    return 'voltron';
  }
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
  const cmc = effectiveManaValue(card);
  const popularity = (total - index) / Math.max(1, total);
  if (role === 'ramp') {
    // Mana is judged as mana alone: a real mana source (mana enchantments before rocks), as cheap as possible – the
    // play style or synergies must not bring in equipment or treasure makers that merely make mana on the side.
    return manaSourceScore(card) - cmc / 2 - Math.max(0, cmc - 2) + powerScore(card, bracket) + popularity;
  }
  if (role === 'removal') {
    // Removal is judged by how directly and how cheaply it answers a threat: a 2 mana "destroy target creature" beats
    // a 5 mana one with extra effects, so neither side effects nor the play style count here.
    return removalScore(cardText(card)) - cmc * 0.75 - Math.max(0, cmc - 2) + powerScore(card, bracket) + popularity;
  }
  let curve = 0;
  if (role === 'creatures' && (style === 'aggro' || style === 'goWide')) {
    curve = cmc <= 3 ? 1 : cmc >= 5 ? -1.5 : 0;
  } else if (role === 'creatures' && style === 'control') {
    curve = cmc <= 2 ? -0.5 : 0;
  } else if (role !== 'lands' && style !== 'bigMana') {
    curve = cmc >= 6 ? -1 : 0;
  }
  const styleFit = fitsStyle(card, style) ? STYLE_FIT_SCORE : 0;
  return rating.synergies.length * 3 + styleFit + rating.effects.length + curve + powerScore(card, bracket) + popularity;
}

// How directly a card removes something: "Destroy/Exile target creature." without a condition counts most, then the
// targeted spells of the other colors (damage, fight, bite, turning it into a token); conditional answers least.
const DIRECT_REMOVAL = /\b(?:destroy|exile) target (?:creature|permanent|nonland permanent|artifact or creature|creature or planeswalker|creature or enchantment|artifact, creature, or enchantment|creature an opponent controls|creature or vehicle)\./i;
const TARGETED_REMOVAL =
  /deals? (?:\d+|x) damage to (?:target creature|any target|target creature or planeswalker)|fights? (?:up to one )?target creature|damage equal to its power to target creature|(?:destroy|exile) target (?:[\w-]+ )*?(?:creature|permanent)|target creature (?:an opponent controls )?(?:loses all abilities and )?becomes a/i;

function removalScore(text: string): number {
  return DIRECT_REMOVAL.test(text) ? 4 : TARGETED_REMOVAL.test(text) ? 2 : 0;
}

// Mana every turn without strings attached: a land aura that adds mana, or a rock whose own ability is "{T}: Add …"
// (or a Signet's "{1}, {T}: Add …").
function manaSourceScore(card: ScryfallCard): number {
  const type = card.type_line ?? '';
  const text = card.oracle_text ?? '';
  if (type.includes('Enchantment') && /enchanted land is tapped for mana/i.test(text)) {
    return 4;
  }
  return type.includes('Artifact') && !type.includes('Creature') && /^(?:\{\d\}, )?\{T\}: Add/m.test(text) ? 3 : 0;
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
