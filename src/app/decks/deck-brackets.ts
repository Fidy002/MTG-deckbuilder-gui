import { ScryfallCard } from '../scryfall/scryfall.models';

export type Bracket = 1 | 2 | 3 | 4 | 5;

export const BRACKETS: readonly { value: Bracket; name: string }[] = [
  { value: 1, name: 'Exhibition' },
  { value: 2, name: 'Core' },
  { value: 3, name: 'Upgraded' },
  { value: 4, name: 'Optimized' },
  { value: 5, name: 'cEDH' },
];

export interface BracketEstimate {
  bracket: Bracket;
  gameChangers: string[];
  massLandDenial: string[];
  extraTurns: string[];
  tutors: string[];
  fastMana: string[];
  combos: string[];
}

const MAX_GAME_CHANGERS_UPGRADED = 3;
const EXTRA_TURN = /takes? an extra turn/;
const MASS_LAND_DENIAL =
  /destroy all (?:[a-z, ]+ )?lands|each player sacrifices (?:all|\w+) lands|can't untap more than one land|lands don't untap/;
const TUTOR = /search(?:es)? (?:your|their) library for ([^.]*?)cards?/g;

// Mana that costs (almost) nothing and wins tempo in the first turns; typical for cEDH. Sol Ring is left out,
// as nearly every Commander deck plays it.
const FAST_MANA = new Set(
  [
    'Mana Crypt', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Mox Opal', 'Mox Amber', 'Mox Opalescence',
    'Lotus Petal', 'Jeweled Lotus', "Lion's Eye Diamond", 'Grim Monolith', 'Ancient Tomb', 'Gemstone Caverns',
    'Elvish Spirit Guide', 'Simian Spirit Guide', 'Dark Ritual', 'Cabal Ritual', 'Rite of Flame', 'Springleaf Drum',
  ].map((name) => name.toLowerCase()),
);

// Well-known two-card wins of the cEDH metagame; every card of one entry must be in the deck.
const CEDH_COMBOS: readonly (readonly string[])[] = [
  ["Thassa's Oracle", 'Demonic Consultation'],
  ["Thassa's Oracle", 'Tainted Pact'],
  ['Laboratory Maniac', 'Demonic Consultation'],
  ['Jace, Wielder of Mysteries', 'Demonic Consultation'],
  ['Jace, Wielder of Mysteries', 'Tainted Pact'],
  ['Isochron Scepter', 'Dramatic Reversal'],
  ['Underworld Breach', "Lion's Eye Diamond"],
  ['Doomsday', "Thassa's Oracle"],
  ['Ad Nauseam', "Angel's Grace"],
  ['Food Chain', 'Eternal Scourge'],
  ['Food Chain', 'Misthollow Griffin'],
  ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'],
  ['Dualcaster Mage', 'Twinflame'],
  ['Dualcaster Mage', 'Heat Shimmer'],
  ['Heliod, Sun-Crowned', 'Walking Ballista'],
  ['Basalt Monolith', 'Rings of Brighthearth'],
  ['Basalt Monolith', 'Forsaken Monument'],
  ['Kinnan, Bonder Prodigy', 'Basalt Monolith'],
  ['Niv-Mizzet, Parun', 'Curiosity'],
  ['Grindstone', "Painter's Servant"],
  ['Sanguine Bond', 'Exquisite Blood'],
  ['Hermit Druid', "Thassa's Oracle"],
];

// cEDH: either a known compact win next to plenty of Game Changers and fast mana, or overwhelming amounts of both.
const CEDH_WITH_COMBO = { gameChangers: 6, fastMana: 3 };
const CEDH_WITHOUT_COMBO = { gameChangers: 10, fastMana: 5 };

function oracleText(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].join('\n').toLowerCase();
}

function frontName(card: ScryfallCard): string {
  return card.name.split(' // ')[0];
}

// Searches for lands (ramp, fetch lands naming basic land types) are no tutors in the sense of the brackets.
const LAND_SEARCH = /land|plains|island|swamp|mountain|forest/;

function isTutor(text: string): boolean {
  return [...text.matchAll(TUTOR)].some((match) => !LAND_SEARCH.test(match[1]));
}

/**
 * Bracket estimate from what can be read off the cards: Game Changers, mass land denial, extra turns, tutors,
 * fast mana and known two-card combos. Bracket 1 depends on the deck's intent and is never assigned;
 * bracket 5 only when the deck clearly looks like cEDH.
 */
export function estimateBracket(cards: readonly ScryfallCard[]): BracketEstimate {
  const names = (test: (card: ScryfallCard, text: string) => boolean) => [
    ...new Set(cards.filter((card) => test(card, oracleText(card))).map(frontName)),
  ];
  const gameChangers = names((card) => !!card.game_changer);
  const massLandDenial = names((_, text) => MASS_LAND_DENIAL.test(text));
  const extraTurns = names((_, text) => EXTRA_TURN.test(text));
  const tutors = names((_, text) => isTutor(text));
  const fastMana = names((card) => FAST_MANA.has(frontName(card).toLowerCase()));

  const inDeck = new Set(cards.map((card) => frontName(card).toLowerCase()));
  const combos = CEDH_COMBOS.filter((combo) => combo.every((name) => inDeck.has(name.toLowerCase()))).map((combo) =>
    combo.join(' + '),
  );

  const enough = (limits: { gameChangers: number; fastMana: number }) =>
    gameChangers.length >= limits.gameChangers && fastMana.length >= limits.fastMana;

  let bracket: Bracket = 2;
  if ((combos.length && enough(CEDH_WITH_COMBO)) || enough(CEDH_WITHOUT_COMBO)) {
    bracket = 5;
  } else if (gameChangers.length > MAX_GAME_CHANGERS_UPGRADED || massLandDenial.length || combos.length) {
    bracket = 4;
  } else if (gameChangers.length || extraTurns.length > 1) {
    bracket = 3;
  }
  return { bracket, gameChangers, massLandDenial, extraTurns, tutors, fastMana, combos };
}
