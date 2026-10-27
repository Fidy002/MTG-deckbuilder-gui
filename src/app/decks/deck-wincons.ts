import { ScryfallCard } from '../scryfall/scryfall.models';
import type { PlayStyle } from './deck-suggestions';
import { SynergyId, cardText } from './deck-synergies';

export type WinconId =
  | 'alternate'
  | 'poison'
  | 'extraTurns'
  | 'ninjas'
  | 'vehicles'
  | 'enchantress'
  | 'cascade'
  | 'dice'
  | 'energy'
  | 'madness'
  | 'wheels'
  | 'discard'
  | 'pillowfort'
  | 'stax'
  | 'goad'
  | 'monarch'
  | 'clones'
  | 'blink'
  | 'enterDamage'
  | 'damageDoubler'
  | 'lifegain'
  | 'aristocrats'
  | 'drain'
  | 'groupSlug'
  | 'punisher'
  | 'storm'
  | 'mill'
  | 'theft'
  | 'reanimator'
  | 'graveyardCast'
  | 'landfall'
  | 'counters'
  | 'treasure'
  | 'artifacts'
  | 'typal'
  | 'tokens'
  | 'overrun'
  | 'extraCombat'
  | 'commanderDamage'
  | 'exalted'
  | 'xSpell'
  | 'burn'
  | 'planeswalkers'
  | 'combat';

interface Wincon {
  id: WinconId;
  // Scryfall search for cards of this plan; Scryfall's oracle tags (otag:) keep it current with new cards.
  query: string;
  // Recognises the plan in a card's rules text (commander and own cards).
  card: (card: ScryfallCard, text: string) => boolean;
  // Cards of the plan a commander deck should have before it is reliable.
  cards: number;
}

const EVASION = ['Flying', 'Trample', 'Menace', 'Shadow', 'Horsemanship'];

const isType = (card: ScryfallCard, type: string) => (card.type_line ?? '').includes(type);
const hasKeyword = (card: ScryfallCard, keywords: readonly string[]) => (card.keywords ?? []).some((k) => keywords.includes(k));

// From the most specific plan to the most general one: when a commander fits several, the specific one wins.
const WINCONS: readonly Wincon[] = [
  {
    id: 'alternate',
    query: 'otag:alternate-win-condition',
    card: (_card, text) => /you win the game|(?:target|each) (?:player|opponent) loses the game/i.test(text),
    cards: 2,
  },
  {
    id: 'poison',
    query: '(kw:infect or kw:toxic or o:"poison counter")',
    card: (card, text) => hasKeyword(card, ['Infect', 'Toxic', 'Poisonous']) || /poison counters?/i.test(text),
    cards: 8,
  },
  {
    id: 'extraTurns',
    query: 'otag:extra-turn',
    card: (_card, text) => /takes? an extra turn/i.test(text),
    cards: 3,
  },
  {
    id: 'ninjas',
    query: '(kw:ninjutsu or otag:synergy-ninjutsu)',
    card: (card, text) => hasKeyword(card, ['Ninjutsu']) || /ninjutsu|ninjas? you control/i.test(text),
    cards: 5,
  },
  {
    id: 'vehicles',
    query: '(t:vehicle or otag:synergy-vehicle)',
    card: (card, text) => isType(card, 'Vehicle') || /vehicles? you control|crews? a vehicle/i.test(text),
    cards: 6,
  },
  {
    id: 'enchantress',
    query: '(otag:enchantress or o:"constellation")',
    card: (_card, text) => /whenever you cast an enchantment spell|constellation|whenever an enchantment you control enters/i.test(text),
    cards: 6,
  },
  {
    id: 'cascade',
    query: '(kw:cascade or otag:synergy-cascade)',
    card: (card, text) => hasKeyword(card, ['Cascade']) || /\bcascade\b/i.test(text),
    cards: 5,
  },
  {
    id: 'dice',
    query: '(otag:dice or otag:synergy-dice)',
    card: (_card, text) => /roll (?:a|one or more|two|a number of) (?:d\d+|dice|die)|whenever you roll/i.test(text),
    cards: 5,
  },
  {
    id: 'energy',
    query: '(otag:energy-generator or otag:synergy-energy)',
    card: (_card, text) => /\{E\}|energy counters?/i.test(text),
    cards: 6,
  },
  {
    id: 'madness',
    query: '(otag:synergy-madness or otag:self-discard-matters)',
    card: (card, text) => hasKeyword(card, ['Madness']) || /whenever you discard|discard a card:/i.test(text),
    cards: 5,
  },
  {
    id: 'wheels',
    query: '(otag:wheel or otag:miniwheel)',
    card: (_card, text) => /each player (?:discards|shuffles) (?:their|his or her) hand|whenever an opponent draws/i.test(text),
    cards: 3,
  },
  {
    id: 'discard',
    query: 'otag:discard (o:"opponent" or o:"each player")',
    card: (_card, text) => /(?:target|each) (?:opponent|player) discards/i.test(text),
    cards: 5,
  },
  {
    id: 'pillowfort',
    query: 'otag:pillowfort',
    card: (_card, text) => /can't attack you(?: or planeswalkers you control)? unless/i.test(text),
    cards: 4,
  },
  {
    id: 'stax',
    query: 'otag:lockdown',
    card: (_card, text) => /don't untap during|can't cast (?:more than|spells)|(?:players|each player|your opponents) can't/i.test(text),
    cards: 4,
  },
  {
    id: 'goad',
    query: '(kw:goad or otag:synergy-goad)',
    card: (card, text) => hasKeyword(card, ['Goad']) || /\bgoad/i.test(text),
    cards: 4,
  },
  {
    id: 'monarch',
    query: '(otag:monarch-matters or o:"become the monarch" or otag:take-the-initiative)',
    card: (_card, text) => /the monarch|the initiative/i.test(text),
    cards: 3,
  },
  {
    id: 'clones',
    query: '(otag:copy-creature or otag:copy-permanent)',
    card: (_card, text) => /enters? as a copy|token that's a copy|becomes? a copy/i.test(text),
    cards: 4,
  },
  {
    id: 'blink',
    query: '(otag:blink or otag:flicker)',
    card: (_card, text) => /exile (?:another |up to one )?target [^.]*, then return|return (?:it|that card|those cards) to the battlefield under/i.test(text),
    cards: 5,
  },
  {
    id: 'enterDamage',
    query: 'o:"enters" o:"damage to each opponent"',
    card: (_card, text) => /whenever (?:a|another) (?:nontoken )?creature (?:you control )?enters[^.]*damage to each opponent/i.test(text),
    cards: 3,
  },
  {
    id: 'damageDoubler',
    query: '(otag:damage-doubler or otag:damage-multiplier)',
    card: (_card, text) => /deals? (?:double|twice|triple) that (?:much )?damage|that much damage plus/i.test(text),
    cards: 3,
  },
  {
    id: 'lifegain',
    query: 'otag:lifegain-matters',
    card: (_card, text) => /whenever you gain life|life you(?:'ve)? gained/i.test(text),
    cards: 5,
  },
  {
    id: 'aristocrats',
    query: '(otag:sac-outlet or otag:blood-artist-ability)',
    card: (_card, text) => /sacrifice (?:a|another) creature:|whenever (?:a|another) (?:nontoken )?creature (?:you control )?dies/i.test(text),
    cards: 6,
  },
  {
    id: 'drain',
    query: '(otag:life-drain or o:"each opponent loses")',
    card: (_card, text) => /each opponent loses (?:\d+|x|that much|life)/i.test(text),
    cards: 4,
  },
  {
    id: 'groupSlug',
    query: 'otag:group-slug',
    card: (_card, text) => /damage to each player|each player loses \d/i.test(text),
    cards: 4,
  },
  {
    id: 'punisher',
    query: 'otag:punisher',
    card: (_card, text) => /unless (?:that player|they) (?:pays?|sacrifices?|discards?)|each opponent (?:may|chooses)/i.test(text),
    cards: 4,
  },
  {
    id: 'storm',
    query: '(kw:storm or kw:magecraft or otag:copy-spell)',
    card: (card, text) => hasKeyword(card, ['Storm', 'Magecraft']) || /copy (?:target|that) (?:instant or sorcery|spell)/i.test(text),
    cards: 4,
  },
  {
    id: 'mill',
    query: 'otag:mill (o:"target player" or o:"each opponent" or o:"target opponent")',
    card: (_card, text) => /(?:target|each) (?:player|opponent)s? mills?/i.test(text),
    cards: 6,
  },
  {
    id: 'theft',
    query: 'otag:theft',
    card: (_card, text) => /gain control of (?:target|all|each)|(?:cards|spells|creatures) your opponents own/i.test(text),
    cards: 4,
  },
  {
    id: 'reanimator',
    query: 'otag:reanimate -t:land',
    card: (_card, text) => /from (?:a|your|an opponent's) graveyards? (?:on)?to the battlefield/i.test(text),
    cards: 5,
  },
  {
    id: 'graveyardCast',
    query: '(otag:cast-from-graveyard or otag:self-mill)',
    card: (card, text) => hasKeyword(card, ['Flashback', 'Escape', 'Unearth']) || /(?:cast|play) [^.]* from your graveyard|mill (?:two|three|four|\d+) cards/i.test(text),
    cards: 6,
  },
  {
    id: 'landfall',
    query: 'otag:landfall (o:"damage" or o:"token" or o:"loses")',
    card: (_card, text) => /landfall|whenever a land (?:you control )?enters/i.test(text) && /damage|token|loses/i.test(text),
    cards: 4,
  },
  {
    id: 'counters',
    query: '(otag:counter-doubler or o:"+1/+1 counter on each creature you control")',
    card: (_card, text) => /double the number of \+1\/\+1 counters|\+1\/\+1 counters? on each (?:other )?creature you control|proliferate/i.test(text),
    cards: 4,
  },
  {
    id: 'treasure',
    query: '(otag:repeatable-treasures or otag:synergy-treasure)',
    card: (_card, text) => /\btreasures?\b/i.test(text),
    cards: 5,
  },
  {
    id: 'artifacts',
    query: 'otag:artifact-matters',
    card: (_card, text) => /artifacts? you control|whenever (?:an|another) artifact/i.test(text),
    cards: 8,
  },
  {
    id: 'typal',
    query: 'otag:lord',
    card: (_card, text) => /other \w+ (?:creatures )?you control get \+|creatures you control of the chosen type/i.test(text),
    cards: 4,
  },
  {
    id: 'tokens',
    query: 'otag:repeatable-creature-tokens',
    card: (_card, text) => /create[^.]*creature tokens?/i.test(text),
    cards: 8,
  },
  {
    id: 'overrun',
    query: 'otag:overrun',
    card: (_card, text) =>
      /creatures you control get \+(?:\d+|x)\/\+(?:\d+|x)[^.]*until end of turn|until end of turn, creatures you control get \+/i.test(text),
    cards: 3,
  },
  {
    id: 'extraCombat',
    query: 'otag:extra-combat',
    card: (_card, text) => /additional combat phase/i.test(text),
    cards: 2,
  },
  {
    id: 'commanderDamage',
    query: '(t:equipment or t:aura) (o:"double strike" or o:"+3/+" or o:"+4/+" or o:"+5/+")',
    card: (card, text) => (isType(card, 'Equipment') || isType(card, 'Aura')) && /double strike|\+[3-9]\/\+/i.test(text),
    cards: 4,
  },
  {
    id: 'exalted',
    query: '(kw:exalted or otag:gives-exalted)',
    card: (card) => hasKeyword(card, ['Exalted']),
    cards: 5,
  },
  {
    id: 'xSpell',
    query: 'otag:infinite-mana-sink',
    card: (card, text) => /\{X\}/.test(card.mana_cost ?? '') && /each opponent|any target|target player/i.test(text),
    cards: 3,
  },
  {
    id: 'burn',
    query: 'otag:burn-player',
    card: (_card, text) => /damage to each opponent|deals? (?:x|that much) damage to (?:any target|target player|target opponent)/i.test(text),
    cards: 4,
  },
  {
    id: 'planeswalkers',
    query: 't:planeswalker',
    card: (card) => isType(card, 'Planeswalker'),
    cards: 4,
  },
  {
    id: 'combat',
    query: 't:creature pow>=5 (kw:flying or kw:trample or o:"can\'t be blocked")',
    card: (card, text) => isType(card, 'Creature') && Number(card.power) >= 5 && (hasKeyword(card, EVASION) || /can't be blocked/i.test(text)),
    cards: 4,
  },
];

const STYLE_WINCONS: Record<PlayStyle, readonly WinconId[]> = {
  aggro: ['overrun', 'burn'],
  midrange: ['combat', 'drain'],
  control: ['planeswalkers', 'pillowfort'],
  goWide: ['tokens', 'overrun'],
  voltron: ['commanderDamage', 'extraCombat'],
  spellslinger: ['storm', 'burn'],
  bigMana: ['xSpell', 'reanimator'],
  combo: ['alternate', 'storm'],
  landfall: ['landfall', 'combat'],
  reanimator: ['reanimator', 'combat'],
  mill: ['mill', 'pillowfort'],
  lifegain: ['lifegain', 'drain'],
};

const SYNERGY_WINCONS: Partial<Record<SynergyId, WinconId>> = {
  bigCommander: 'commanderDamage',
  tokens: 'tokens',
  tribal: 'typal',
  counters: 'counters',
  combatDamage: 'extraCombat',
  attacks: 'extraCombat',
  lifegain: 'lifegain',
  graveyard: 'aristocrats',
  spells: 'storm',
  artifacts: 'artifacts',
  enchantments: 'enchantress',
  landfall: 'landfall',
  planeswalkers: 'planeswalkers',
};

export interface WinPlan {
  main: WinconId;
  backup?: WinconId;
}

export function planFinishers(id: WinconId, commanderDeck: boolean): number {
  const cards = WINCONS.find((w) => w.id === id)?.cards ?? 4;
  return commanderDeck ? cards : Math.max(1, Math.ceil(cards / 2));
}

/** The plans a card plays into. */
export function cardWincons(card: ScryfallCard): WinconId[] {
  const text = cardText(card);
  return WINCONS.filter((w) => w.card(card, text)).map((w) => w.id);
}

/**
 * The plan that suits the deck: how the commander wins on its own first, then what its abilities build on, then what
 * the play style wins with; the next best as backup.
 */
export function recommendPlan(style: PlayStyle, synergies: readonly SynergyId[], commander?: ScryfallCard): WinPlan {
  // A commander that is itself a big, sturdy threat wins best by attacking: commander damage comes first.
  const own = [...(synergies.includes('bigCommander') ? ['commanderDamage' as const] : []), ...(commander ? cardWincons(commander) : [])].filter(
    (id) => id !== 'combat' || !synergies.includes('bigCommander'),
  );
  const fromAbilities = synergies.flatMap((s) => SYNERGY_WINCONS[s] ?? []);
  const [main, backup] = [...new Set([...own, ...fromAbilities, ...STYLE_WINCONS[style]])];
  return { main, backup };
}

/** The Scryfall searches for cards of the plans, in the given order. */
export function winconQueries(ids: readonly WinconId[]): string[] {
  return ids.flatMap((id) => WINCONS.find((w) => w.id === id)?.query ?? []);
}

/** The plans of the deck so far, with the cards that play into them. */
export function deckWincons(cards: readonly ScryfallCard[]): Map<WinconId, ScryfallCard[]> {
  const found = new Map<WinconId, ScryfallCard[]>();
  const unique = [...new Map(cards.map((c) => [c.name, c])).values()];
  for (const card of unique) {
    for (const id of cardWincons(card)) {
      found.set(id, [...(found.get(id) ?? []), card]);
    }
  }
  return found;
}
