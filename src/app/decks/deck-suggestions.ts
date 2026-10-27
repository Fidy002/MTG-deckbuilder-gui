import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, from, map, toArray } from 'rxjs';
import { ScryfallCard } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { Bracket, isExtraTurn, isMassLandDenial } from './deck-brackets';
import { DeckEntry } from './decklist';

export type SuggestionRole = 'ramp' | 'draw' | 'removal' | 'wipes' | 'tutors' | 'theme' | 'creatures' | 'lands';

export type PlayStyle =
  | 'aggro'
  | 'midrange'
  | 'control'
  | 'goWide'
  | 'voltron'
  | 'spellslinger'
  | 'bigMana'
  | 'combo'
  | 'landfall'
  | 'reanimator'
  | 'mill'
  | 'lifegain';

export const PLAY_STYLES: readonly PlayStyle[] = [
  'aggro',
  'midrange',
  'control',
  'goWide',
  'voltron',
  'spellslinger',
  'bigMana',
  'combo',
  'landfall',
  'reanimator',
  'mill',
  'lifegain',
];

export interface SuggestionGroup {
  role: SuggestionRole;
  cards: ScryfallCard[];
  // Creature types the creature suggestions were picked for.
  types?: string[];
  // Cards of this role the deck should have (copies included) and those that are already in it.
  recommended?: number;
  owned?: number;
  // Different cards to pick for the recommendation, and why the creature count is what it is.
  picks?: number;
  factors?: CreatureFactor[];
  // Style cards: which searches found each card (indexes into the plan searches first, see planQueries).
  sources?: Record<string, number[]>;
}

export interface SuggestionOptions {
  format: 'commander' | string;
  colors: readonly string[];
  bracket?: Bracket;
  exclude: readonly string[];
  style?: PlayStyle;
  commander?: ScryfallCard;
  // Creatures and lands that are already in the deck (copies included).
  ownedCreatures?: number;
  ownedLands?: number;
  // Creature types of the deck (see deckCreatureTypes); creatures of these types are suggested first.
  creatureTypes?: readonly string[];
  // Creature types the user chose as the deck theme; only these (or types the commander names) make it a typal deck.
  themeTypes?: readonly string[];
  // Sets of the own cards (likely opened in boosters); cards from these sets come first.
  preferredSets?: readonly string[];
  // Scryfall searches for the finishers of the deck's plan, main plan first (see deck-wincons).
  planQueries?: readonly string[];
}

export interface RoleQuery {
  role: SuggestionRole;
  query: string;
  count: number;
}

const COMMANDER_ROLES: readonly RoleQuery[] = [
  { role: 'creatures', query: 't:creature', count: 0 },
  { role: 'ramp', query: 'otag:ramp -t:land', count: 10 },
  { role: 'draw', query: 'otag:draw -t:land', count: 10 },
  { role: 'removal', query: 'otag:removal -otag:sweeper -t:land', count: 8 },
  { role: 'wipes', query: 'otag:sweeper -t:land', count: 3 },
  { role: 'tutors', query: 'otag:tutor-any -t:land', count: 0 },
  { role: 'theme', query: '', count: 0 },
  { role: 'lands', query: 't:land -t:basic', count: 10 },
];

// 60 card decks play most cards four times, so fewer different cards are needed.
const CONSTRUCTED_ROLES: readonly RoleQuery[] = [
  { role: 'creatures', query: 't:creature', count: 0 },
  { role: 'removal', query: 'otag:removal -t:land', count: 2 },
  { role: 'draw', query: 'otag:draw -t:land', count: 2 },
  { role: 'theme', query: '', count: 0 },
  { role: 'lands', query: 't:land -t:basic', count: 4 },
];

const STYLE_ROLE_COUNTS: Record<PlayStyle, Partial<Record<SuggestionRole, { commander: number; constructed: number }>>> = {
  aggro: { draw: { commander: 8, constructed: 1 }, removal: { commander: 7, constructed: 2 }, wipes: { commander: 1, constructed: 0 } },
  midrange: {},
  control: { draw: { commander: 12, constructed: 3 }, removal: { commander: 10, constructed: 3 }, wipes: { commander: 5, constructed: 0 } },
  goWide: { wipes: { commander: 1, constructed: 0 } },
  voltron: { removal: { commander: 7, constructed: 2 }, wipes: { commander: 1, constructed: 0 } },
  spellslinger: { draw: { commander: 12, constructed: 3 }, removal: { commander: 10, constructed: 3 } },
  bigMana: { ramp: { commander: 15, constructed: 0 }, wipes: { commander: 2, constructed: 0 } },
  combo: { draw: { commander: 12, constructed: 3 }, removal: { commander: 7, constructed: 2 }, wipes: { commander: 1, constructed: 0 } },
  landfall: { ramp: { commander: 14, constructed: 2 }, wipes: { commander: 2, constructed: 0 } },
  reanimator: { draw: { commander: 8, constructed: 2 }, wipes: { commander: 2, constructed: 0 } },
  mill: { draw: { commander: 12, constructed: 3 }, removal: { commander: 9, constructed: 3 }, wipes: { commander: 4, constructed: 0 } },
  lifegain: { wipes: { commander: 2, constructed: 0 } },
};

// Cards that carry a play style, filling the non-land slots the creatures and the other roles leave free.
const THEME_QUERIES: Partial<Record<PlayStyle, string>> = {
  goWide: '(o:"create" o:"token" or o:"creatures you control get") -t:creature -t:land',
  voltron: '(t:equipment or (t:aura o:"enchanted creature")) -t:land',
  spellslinger: '(t:instant or t:sorcery) -otag:sweeper',
  bigMana: 'mv>=7 -t:land -t:creature',
  combo: '(otag:tutor or o:"untap target" or o:"copy target") -t:land',
  landfall: '(otag:landfall or o:"play an additional land" or o:"land cards from your graveyard") -t:land -t:creature',
  reanimator: '(otag:reanimate or (o:"mill" -o:"target player" -o:"each opponent" -o:"target opponent")) -t:land -t:creature',
  mill: 'otag:mill (o:"target player" or o:"each opponent" or o:"target opponent") -t:land',
  lifegain: '(otag:lifegain-matters or (o:"you gain" o:"life" -o:"gain protection")) -t:land -t:creature',
};

const CREATURE_BASE: Record<PlayStyle, { commander: number; constructed: number }> = {
  aggro: { commander: 32, constructed: 24 },
  midrange: { commander: 25, constructed: 16 },
  control: { commander: 10, constructed: 6 },
  goWide: { commander: 22, constructed: 14 },
  voltron: { commander: 16, constructed: 12 },
  spellslinger: { commander: 10, constructed: 6 },
  bigMana: { commander: 18, constructed: 10 },
  combo: { commander: 14, constructed: 8 },
  landfall: { commander: 20, constructed: 12 },
  reanimator: { commander: 22, constructed: 14 },
  mill: { commander: 12, constructed: 8 },
  lifegain: { commander: 26, constructed: 18 },
};

// Styles that win without many creatures: commander abilities or deck types may add some, but not beyond this.
const STYLE_CREATURE_MAX: Partial<Record<PlayStyle, { commander: number; constructed: number }>> = {
  control: { commander: 14, constructed: 10 },
  spellslinger: { commander: 14, constructed: 10 },
  mill: { commander: 16, constructed: 10 },
  combo: { commander: 18, constructed: 12 },
};

const CREATURE_SYNERGY = /(?:creatures?|other \w+) you control|whenever (?:a|another|one or more) (?:nontoken )?creatures?|creature spells?|creature tokens?|attacks/i;
const MAX_CLAUSE = 110;
const SPELL_SYNERGY = /instant or sorcery|instants? and sorcer|noncreature spells?/i;

const EXTRA_OPTIONS = 1.5;
const MIN_OPTIONS = 6;
const POOL_FACTOR = 4;

export function optionCount(count: number): number {
  return Math.max(MIN_OPTIONS, Math.ceil(count * EXTRA_OPTIONS));
}

const GAME_CHANGER_LIMIT_UPGRADED = 3;
const RECENT_YEARS = 3;
const MAX_CREATURE_TYPES = 3;
const MAX_PREFERRED_SETS = 6;
const EXACT_COLORS_WEIGHT = 2;
const TYPE_WEIGHT = 3;
const TYPE_TEXT_WEIGHT = 6;
const SET_WEIGHT = 5;
const RECENT_WEIGHT = 3;
const STYLE_WEIGHT = 2;
// The suggested commander is drawn from this many of the best fitting, most played ones, as long as they fit at least
// this share as well as the best one; the better a commander fits and the more it is played, the likelier it is drawn.
const BEST_COMMANDER_CHOICES = 5;
const BEST_COMMANDER_SHARE = 1 / 3;
// Too common to say anything about a deck's theme, unless the commander names them.
const GENERIC_TYPES = new Set(['Human']);
const IRREGULAR_PLURALS: Record<string, string> = { Elf: 'Elves', Dwarf: 'Dwarves', Wolf: 'Wolves', Werewolf: 'Werewolves', Mouse: 'Mice', Ox: 'Oxen' };

function creatureSubtypes(card: ScryfallCard): string[] {
  return (card.card_faces?.map((f) => f.type_line ?? '') ?? [card.type_line ?? ''])
    .filter((line) => line.includes('Creature'))
    .flatMap((line) => (line.split('—')[1] ?? '').trim().split(/\s+/))
    .filter(Boolean);
}

function typePattern(type: string): RegExp {
  const forms = [type, IRREGULAR_PLURALS[type] ?? `${type}s`, `${type}es`];
  return new RegExp(`\\b(?:${forms.join('|')})\\b`);
}

function mentions(text: string, type: string): boolean {
  return typePattern(type).test(text);
}

/** The sentence of the text the pattern matches in, shortened when it is long. */
function clause(text: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(text);
  if (!match) {
    return undefined;
  }
  const start = Math.max(text.lastIndexOf('.', match.index), text.lastIndexOf('\n', match.index)) + 1;
  const ends = ['.', '\n'].map((c) => text.indexOf(c, match.index + match[0].length)).filter((i) => i >= 0);
  const sentence = text.slice(start, ends.length ? Math.min(...ends) : text.length).trim();
  return sentence.length > MAX_CLAUSE ? `${sentence.slice(0, MAX_CLAUSE - 1).trimEnd()}…` : sentence;
}

/**
 * The deck's creature types: types the commander's text names (e.g. "Other Bears you control") count most,
 * then the commander's own types and those of the own creatures. Up to three types that occur at least twice;
 * changelings are always added to the search, as they have every type.
 */
export function deckCreatureTypes(commander: ScryfallCard | undefined, owned: readonly ScryfallCard[], catalog: readonly string[]): string[] {
  const scores = new Map<string, number>();
  const add = (type: string, score: number) => scores.set(type, (scores.get(type) ?? 0) + score);
  const named = new Set<string>();
  if (commander) {
    const text = [commander.oracle_text, ...(commander.card_faces ?? []).map((f) => f.oracle_text)].join('\n');
    for (const type of catalog.filter((t) => mentions(text, t))) {
      named.add(type);
      add(type, 4);
    }
    creatureSubtypes(commander).forEach((type) => add(type, 2));
  }
  const ownedCounts = new Map<string, number>();
  for (const type of owned.flatMap(creatureSubtypes)) {
    add(type, 1);
    ownedCounts.set(type, (ownedCounts.get(type) ?? 0) + 1);
  }
  // A commander that names types (Beorn: "Other Bears") sets the theme; its other types only count with own cards.
  const fits = (type: string) => !named.size || named.has(type) || (ownedCounts.get(type) ?? 0) >= 2;
  return [...scores]
    .filter(([type, score]) => score >= 2 && fits(type) && (!GENERIC_TYPES.has(type) || named.has(type)))
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CREATURE_TYPES)
    .map(([type]) => type);
}

function recentCutoff(now: Date): string {
  return new Date(now.getFullYear() - RECENT_YEARS, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
}

function isRecent(card: ScryfallCard, now = new Date()): boolean {
  return (card.released_at ?? '') >= recentCutoff(now);
}

/** Cards from the last few years first, otherwise in the given (popularity) order. */
export function newerFirst(cards: readonly ScryfallCard[], now = new Date()): ScryfallCard[] {
  const recent = (card: ScryfallCard) => isRecent(card, now);
  return [...cards.filter(recent), ...cards.filter((card) => !recent(card))];
}

export function setQuery(sets: readonly string[]): string {
  return `(${sets.map((set) => `set:${set}`).join(' or ')})`;
}

/** The most frequent sets among the own cards, without basic lands (they come from everywhere). */
export function preferredSets(owned: readonly { set?: string; basic?: boolean }[], max = MAX_PREFERRED_SETS): string[] {
  const counts = new Map<string, number>();
  for (const { set, basic } of owned) {
    if (set && !basic) {
      counts.set(set, (counts.get(set) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, max).map(([set]) => set);
}

export function tribalQuery(types: readonly string[]): string {
  return `t:creature (${[...types.map((type) => `t:"${type.toLowerCase()}"`), 'kw:changeling'].join(' or ')})`;
}

const BASIC_LANDS: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

export const COMMANDER_LANDS = 37;
export const CONSTRUCTED_LANDS = 24;
const CONSTRUCTED_COPIES = 4;
const COMMANDER_SIZE = 100;
const CONSTRUCTED_SIZE = 60;

export interface CreatureFactor {
  kind: 'style' | 'creatureSynergy' | 'spellSynergy' | 'types' | 'styleMax' | 'space';
  delta: number;
  match?: string;
}

/** Whether the deck plays its creature types: a commander that merely is a Dog makes no typal deck; a chosen theme or a commander that names its type does. */
export function isTypal(options: SuggestionOptions): boolean {
  const commander = options.commander;
  const text = commander ? [commander.oracle_text, ...(commander.card_faces ?? []).map((f) => f.oracle_text)].join('\n') : '';
  return !!options.creatureTypes?.length && (!!options.themeTypes?.length || options.creatureTypes.some((type) => clause(text, typePattern(type))));
}

/** The creatures that carry the play style (e.g. landfall creatures), for the styles whose theme cards leave creatures out. */
export function styleCreatureQuery(style: PlayStyle | undefined): string | undefined {
  const query = THEME_QUERIES[style ?? 'midrange'];
  return query?.includes('-t:creature') ? `t:creature ${query.replace(' -t:creature', '')}` : undefined;
}

/** Creatures the deck should play (copies included): set by the play style, adjusted by what the commander rewards. */
export function creatureRecommendation(options: SuggestionOptions): { count: number; factors: CreatureFactor[] } {
  const commanderDeck = options.format === 'commander';
  const base = CREATURE_BASE[options.style ?? 'midrange'][commanderDeck ? 'commander' : 'constructed'];
  const commander = options.commander;
  const text = commander ? [commander.oracle_text, ...(commander.card_faces ?? []).map((f) => f.oracle_text)].join('\n') : '';
  const scale = commanderDeck ? 1 : 0.6;
  const factors: CreatureFactor[] = [{ kind: 'style', delta: base }];
  const creatureMatch =
    clause(text, CREATURE_SYNERGY) ?? (options.creatureTypes ?? []).map((type) => clause(text, typePattern(type))).find(Boolean);
  if (creatureMatch) {
    factors.push({ kind: 'creatureSynergy', delta: Math.round(5 * scale), match: creatureMatch });
  }
  const spellMatch = clause(text, SPELL_SYNERGY);
  if (spellMatch) {
    factors.push({ kind: 'spellSynergy', delta: -Math.round(8 * scale), match: spellMatch });
  }
  if (isTypal(options)) {
    factors.push({ kind: 'types', delta: Math.round(3 * scale) });
  }
  const [min, max] = commanderDeck ? [6, 40] : [4, 32];
  const styleMax = STYLE_CREATURE_MAX[options.style ?? 'midrange']?.[commanderDeck ? 'commander' : 'constructed'] ?? max;
  const total = factors.reduce((sum, f) => sum + f.delta, 0);
  if (total > styleMax) {
    factors.push({ kind: 'styleMax', delta: styleMax - total });
  }
  const count = Math.min(max, styleMax, Math.max(min, total));
  const space = creatureSpace(options);
  if (count > space) {
    factors.push({ kind: 'space', delta: space - count });
    return { count: space, factors };
  }
  return { count, factors };
}

const PLAN_MINIMUM = { commander: 4, constructed: 1 };

// Tutors find the strongest cards and combo pieces; the higher brackets allow and expect more of them.
const BRACKET_TUTORS: Partial<Record<Bracket, number>> = { 3: 2, 4: 4, 5: 6 };

function bracketTutors(options: SuggestionOptions): number {
  return options.format === 'commander' && options.bracket ? (BRACKET_TUTORS[options.bracket] ?? 0) : 0;
}

// Mana that costs (almost) nothing: moxen, rituals and the cheapest mana rocks.
const FAST_MANA_QUERY = '(otag:moxen or otag:ritual or (otag:mana-rock mv<=1))';
const RARE_QUERY = '(r:rare or r:mythic)';

/** Slots kept for the finishers of the deck's plan (different cards). */
function planMinimum(options: SuggestionOptions): number {
  return options.planQueries?.length ? PLAN_MINIMUM[options.format === 'commander' ? 'commander' : 'constructed'] : 0;
}

/** The style cards: the finishers of the plan first, then what carries the play style. */
function themeQueries(options: SuggestionOptions): string[] {
  const style = THEME_QUERIES[options.style ?? 'midrange'];
  return [...(options.planQueries ?? []), ...(style ? [style] : [])];
}

/** Non-land slots left for creatures once the other roles of the play style have theirs (copies included). */
function creatureSpace(options: SuggestionOptions): number {
  const commanderDeck = options.format === 'commander';
  const format = commanderDeck ? 'commander' : 'constructed';
  const copies = commanderDeck ? 1 : CONSTRUCTED_COPIES;
  const styleCounts = STYLE_ROLE_COUNTS[options.style ?? 'midrange'];
  const fixed = (commanderDeck ? COMMANDER_ROLES : CONSTRUCTED_ROLES)
    .filter((r) => r.role !== 'creatures' && r.role !== 'lands' && r.role !== 'theme' && r.role !== 'tutors')
    .reduce((sum, r) => sum + (styleCounts[r.role]?.[format] ?? r.count) * copies, 0) + (planMinimum(options) + bracketTutors(options)) * copies;
  const nonLands = commanderDeck ? COMMANDER_SIZE - COMMANDER_LANDS - 1 : CONSTRUCTED_SIZE - CONSTRUCTED_LANDS;
  return Math.max(0, nonLands - fixed);
}

export function recommendedCreatures(options: SuggestionOptions): number {
  return creatureRecommendation(options).count;
}

/** Role counts in different cards: the creatures fill up to the recommendation, the other roles depend on the play style. */
export function roleCounts(options: SuggestionOptions): RoleQuery[] {
  const commander = options.format === 'commander';
  const roles = commander ? COMMANDER_ROLES : CONSTRUCTED_ROLES;
  const copies = commander ? 1 : CONSTRUCTED_COPIES;
  const style = options.style ?? 'midrange';
  const styleCounts = STYLE_ROLE_COUNTS[style];
  const recommended = recommendedCreatures(options);
  const creatures = Math.max(0, Math.ceil((recommended - (options.ownedCreatures ?? 0)) / copies));
  // The creature space keeps the plan's slots free; they belong to the theme.
  const theme = Math.max(0, Math.floor((creatureSpace(options) - recommended) / copies) + planMinimum(options));
  return roles.map((r) => {
    if (r.role === 'creatures') {
      return { ...r, count: creatures };
    }
    if (r.role === 'tutors') {
      return { ...r, count: bracketTutors(options) };
    }
    if (r.role === 'theme') {
      const queries = themeQueries(options);
      return { ...r, query: queries.join(' or '), count: queries.length ? Math.max(planMinimum(options), theme) : 0 };
    }
    const styled = styleCounts[r.role];
    return styled ? { ...r, count: styled[commander ? 'commander' : 'constructed'] } : r;
  });
}

/** What the deck should have per role and what it already has (copies included), as shown to the user. */
export function roleTargets(role: RoleQuery, options: SuggestionOptions): Pick<SuggestionGroup, 'recommended' | 'owned' | 'picks' | 'factors'> {
  const commander = options.format === 'commander';
  if (role.role === 'creatures') {
    const { count, factors } = creatureRecommendation(options);
    return { recommended: count, owned: options.ownedCreatures ?? 0, picks: role.count, factors };
  }
  if (role.role === 'lands') {
    return { recommended: role.count, owned: options.ownedLands ?? 0, picks: role.count };
  }
  return { recommended: role.count * (commander ? 1 : CONSTRUCTED_COPIES), picks: role.count };
}

/** Scryfall color filter: commander decks stay inside the color identity, 60 card decks inside the colors. */
function colorFilter(format: string, colors: readonly string[]): string {
  const value = colors.length ? colors.join('').toLowerCase() : 'c';
  return format === 'commander' ? `id<=${value}` : `c<=${value}`;
}

function legalityFilter(format: string): string {
  return format === 'kitchentable' ? '' : `legal:${format}`;
}

export function commanderQuery(colors: readonly string[], bracket?: Bracket): string {
  return ['is:commander', 'legal:commander', colors.length ? `id>=${colors.join('').toLowerCase()}` : '', bracketFilter(bracket)]
    .filter(Boolean)
    .join(' ');
}

function bracketFilter(bracket: Bracket | undefined): string {
  return bracket && bracket <= 2 ? '-is:gamechanger' : '';
}

export function roleQuery(role: RoleQuery, options: SuggestionOptions): string {
  return [role.query, colorFilter(options.format, options.colors), legalityFilter(options.format), bracketFilter(options.bracket)]
    .filter(Boolean)
    .join(' ');
}

/**
 * Picks the most played cards per role, without duplicates and cards already in the deck, and within what the
 * bracket allows: no Game Changers or extra turns up to bracket 2, no mass land denial and at most three Game Changers up to bracket 3.
 */
export function pickSuggestions(
  results: readonly { role: SuggestionRole; count: number; cards: readonly ScryfallCard[] }[],
  options: SuggestionOptions,
  ownedGameChangers = 0,
): SuggestionGroup[] {
  const taken = new Set(options.exclude.map((name) => name.toLowerCase()));
  const bracket = options.format === 'commander' ? options.bracket : undefined;
  let gameChangers = ownedGameChangers;

  return results.map(({ role, count, cards }) => {
    const picked: ScryfallCard[] = [];
    for (const card of cards) {
      if (picked.length >= count) {
        break;
      }
      const name = card.name.toLowerCase();
      if (taken.has(name)) {
        continue;
      }
      if (bracket && bracket <= 2 && (isExtraTurn(card) || card.game_changer)) {
        continue;
      }
      if (bracket && bracket <= 3 && isMassLandDenial(card)) {
        continue;
      }
      if (bracket === 3 && card.game_changer && gameChangers >= GAME_CHANGER_LIMIT_UPGRADED) {
        continue;
      }
      gameChangers += card.game_changer ? 1 : 0;
      taken.add(name);
      picked.push(card);
    }
    return { role, cards: picked };
  });
}

export interface CommanderFit {
  colors: readonly string[];
  creatureTypes?: readonly string[];
  preferredSets?: readonly string[];
  // Whether a commander plays into the chosen play style (see fitsStyle).
  style?: (card: ScryfallCard) => boolean;
}

export function commanderFit(card: ScryfallCard, fit: CommanderFit, now = new Date()): number {
  const text = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].join('\n');
  const types = fit.creatureTypes ?? [];
  const typeFit = types.some((type) => mentions(text, type)) ? TYPE_TEXT_WEIGHT : types.some((type) => creatureSubtypes(card).includes(type)) ? TYPE_WEIGHT : 1;
  const setFit = fit.preferredSets?.includes(card.set) ? SET_WEIGHT : 1;
  const colorFit = fit.colors.length && (card.color_identity?.length ?? 0) === fit.colors.length ? EXACT_COLORS_WEIGHT : 1;
  const recentFit = isRecent(card, now) ? RECENT_WEIGHT : 1;
  const styleFit = fit.style?.(card) ? STYLE_WEIGHT : 1;
  return typeFit * setFit * colorFit * recentFit * styleFit;
}

export function pickCommanders(
  pool: readonly ScryfallCard[],
  count: number,
  fit: CommanderFit,
  random: () => number = Math.random,
): ScryfallCard[] {
  const colorCount = (card: ScryfallCard) => card.color_identity?.length ?? 0;
  return pool
    .map((card, rank) => {
      const score = commanderFit(card, fit);
      return { card, rank, score, key: random() ** Math.sqrt((rank + 1) / score) };
    })
    .sort((a, b) => b.key - a.key)
    .slice(0, count)
    .sort((a, b) => b.score - a.score || colorCount(a.card) - colorCount(b.card) || a.rank - b.rank)
    .map(({ card }) => card);
}

/**
 * The commander to suggest: one that covers the colors and fits well. An own commander that fits best wins; otherwise
 * it is drawn among the best fitting, most played ones (the best one most likely), so the same commander is not
 * suggested every time.
 */
export function bestCommander(
  owned: readonly ScryfallCard[],
  pool: readonly ScryfallCard[],
  fit: CommanderFit,
  random: () => number = Math.random,
): ScryfallCard | undefined {
  const quality = { ...fit, preferredSets: undefined };
  const covers = (card: ScryfallCard) => fit.colors.every((c) => card.color_identity?.includes(c));
  const ownedNames = new Set(owned.map((c) => c.name));
  const ranked = [...owned, ...pool.filter((c) => !ownedNames.has(c.name))]
    .map((card, index) => ({ card, index, owned: ownedNames.has(card.name), covers: covers(card), score: commanderFit(card, quality) }))
    .sort((a, b) => +b.covers - +a.covers || b.score - a.score || +b.owned - +a.owned || a.index - b.index);
  const best = ranked[0];
  if (!best || best.owned) {
    return best?.card;
  }
  const choices = ranked.filter((r) => r.covers === best.covers && r.score >= best.score * BEST_COMMANDER_SHARE).slice(0, BEST_COMMANDER_CHOICES);
  // A weighted draw: the higher the weight, the closer the key gets to the random number itself.
  return choices
    .map((r, rank) => ({ card: r.card, key: random() ** (Math.sqrt(rank + 1) * (best.score / r.score)) }))
    .sort((a, b) => b.key - a.key)[0].card;
}

export function typeQuery(types: readonly string[]): string {
  const forms = types.flatMap((type) => [type, IRREGULAR_PLURALS[type] ?? `${type}s`]).map((form) => form.toLowerCase());
  return `(${[...types.map((type) => `t:"${type.toLowerCase()}"`), `o:/\\b(${forms.join('|')})\\b/`].join(' or ')})`;
}

export function basicLandName(color: string): string {
  return BASIC_LANDS[color] ?? 'Wastes';
}

/** Colored mana symbols per color in the given mana costs; hybrid symbols count half for each of their colors. */
export function manaPips(costs: readonly (string | undefined)[]): Record<string, number> {
  const pips: Record<string, number> = {};
  for (const cost of costs) {
    for (const [, symbol] of (cost ?? '').matchAll(/\{([^}]+)\}/g)) {
      const colors = symbol.split('/').filter((part) => 'WUBRG'.includes(part));
      for (const color of colors) {
        pips[color] = (pips[color] ?? 0) + 1 / colors.length;
      }
    }
  }
  return pips;
}

/** Basic lands per color in proportion to the mana symbols (largest remainder), at least one per color; Wastes when colorless. */
export function splitBasics(colors: readonly string[], pips: Record<string, number>, count: number): Record<string, number> {
  if (!colors.length) {
    return count > 0 ? { C: count } : {};
  }
  const weights = colors.map((c) => pips[c] ?? 0);
  const total = weights.reduce((sum, w) => sum + w, 0);
  const shares = weights.map((w) => (total ? w / total : 1 / colors.length) * count);
  const result = shares.map(Math.floor);
  const order = shares.map((s, i) => [s - Math.floor(s), i] as const).sort((a, b) => b[0] - a[0]);
  for (let left = count - result.reduce((sum, n) => sum + n, 0), k = 0; left > 0; left--, k++) {
    result[order[k % order.length][1]]++;
  }
  if (count >= colors.length) {
    for (let i = 0; i < result.length; i++) {
      if (result[i] === 0) {
        const largest = result.indexOf(Math.max(...result));
        result[largest]--;
        result[i]++;
      }
    }
  }
  return Object.fromEntries(colors.map((c, i) => [c, result[i]]));
}

// Colors whose cards suit a play style best, with how strongly they do.
const STYLE_COLORS: Record<PlayStyle, Partial<Record<string, number>>> = {
  aggro: { R: 2, W: 1.5, B: 1 },
  midrange: { G: 1.5, B: 1, W: 0.5 },
  control: { U: 2, B: 1.5, W: 1 },
  goWide: { W: 2, G: 1.5 },
  voltron: { W: 1.5, R: 1, G: 1 },
  spellslinger: { U: 2, R: 2 },
  bigMana: { G: 2.5, U: 0.5 },
  combo: { U: 2, B: 1.5, G: 0.5 },
  landfall: { G: 2.5, R: 1 },
  reanimator: { B: 2.5, G: 1, W: 0.5 },
  mill: { U: 2.5, B: 1.5 },
  lifegain: { W: 2.5, B: 1.5, G: 0.5 },
};

const OWNED_COLOR_WEIGHT = 4;
const THEME_COLOR_WEIGHT = 3;
const STYLE_COLOR_WEIGHT = 1;
const SECOND_COLOR_SHARE = 0.45;
const OWNED_COLOR_SHARE = 0.15;
const MAX_COLORS = 2;

export interface ColorAdvice {
  colors: string[];
  owned: Record<string, number>;
  theme: Record<string, number>;
  style: Partial<Record<string, number>>;
}

/** Shares of each color among the given colors (e.g. mana symbols or color identities), as fractions that add up to 1. */
export function colorShares(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return total ? Object.fromEntries(Object.entries(counts).map(([c, n]) => [c, n / total])) : {};
}

/**
 * The colors for a 60 card deck: the mana symbols of the own cards count most, then the colors of the theme's creature
 * type, then what suits the play style. The strongest color always, a second one when it is close enough; more only
 * when the own cards already need them.
 */
export function recommendColors(ownedPips: Record<string, number>, themeColors: Record<string, number>, style: PlayStyle): ColorAdvice {
  const owned = colorShares(ownedPips);
  const theme = colorShares(themeColors);
  const styleWeights = STYLE_COLORS[style];
  const styleTotal = Object.values(styleWeights).reduce((sum: number, n) => sum + (n ?? 0), 0) || 1;
  const score = (c: string) =>
    (owned[c] ?? 0) * OWNED_COLOR_WEIGHT + (theme[c] ?? 0) * THEME_COLOR_WEIGHT + ((styleWeights[c] ?? 0) / styleTotal) * STYLE_COLOR_WEIGHT;
  const ranked = ['W', 'U', 'B', 'R', 'G'].map((c) => ({ c, score: score(c) })).sort((a, b) => b.score - a.score);
  const needed = ranked.filter((r) => (owned[r.c] ?? 0) >= OWNED_COLOR_SHARE).map((r) => r.c);
  const max = Math.max(MAX_COLORS, Math.min(3, needed.length));
  const top = ranked[0].score;
  const strong = ranked.filter((r, i) => i === 0 || (r.score > 0 && r.score >= top * SECOND_COLOR_SHARE)).map((r) => r.c);
  const colors = [...new Set([...needed, ...strong])].slice(0, max);
  return { colors: ['W', 'U', 'B', 'R', 'G'].filter((c) => colors.includes(c)), owned, theme, style: styleWeights };
}

/** Basic lands for the free land slots, split as evenly as possible over the colors (Wastes when colorless). */
export function basicLands(colors: readonly string[], count: number): DeckEntry[] {
  const names = colors.map((c) => BASIC_LANDS[c]).filter(Boolean);
  const lands = names.length ? names : ['Wastes'];
  return lands
    .map((name, i) => ({
      count: Math.floor(count / lands.length) + (i < count % lands.length ? 1 : 0),
      name,
      section: 'main' as const,
    }))
    .filter((entry) => entry.count > 0);
}

@Injectable({ providedIn: 'root' })
export class DeckSuggestions {
  private readonly scryfall = inject(ScryfallService);

  /** How often each color occurs among the most played creatures of a type. */
  typeColors(type: string): Observable<Record<string, number>> {
    return this.scryfall.findPopularCards(`t:creature t:"${type.toLowerCase()}"`).pipe(
      map((cards) => {
        const counts: Record<string, number> = {};
        for (const color of cards.flatMap((c) => c.color_identity ?? [])) {
          counts[color] = (counts[color] ?? 0) + 1;
        }
        return counts;
      }),
    );
  }

  commanders(fit: CommanderFit, bracket?: Bracket): Observable<ScryfallCard[]> {
    const base = commanderQuery(fit.colors, bracket);
    const types = fit.creatureTypes ?? [];
    const sets = fit.preferredSets ?? [];
    const queries = [
      ...(types.length ? [`${base} ${typeQuery(types)}`] : []),
      ...(sets.length ? [`${base} ${setQuery(sets)}`] : []),
      `${base} not:reprint date>=${recentCutoff(new Date())}`,
      base,
    ];
    return from(queries).pipe(
      concatMap((query) => this.scryfall.findPopularCards(query)),
      toArray(),
      map((lists) => {
        const seen = new Set<string>();
        return lists.flat().filter((card) => !seen.has(card.name) && !!seen.add(card.name));
      }),
    );
  }

  // The candidates of one role from a single search (the theme's queries taken together), most played first.
  roleCards(role: RoleQuery, options: SuggestionOptions, ownedGameChangers = 0): Observable<SuggestionGroup> {
    const parts = role.role === 'theme' ? themeQueries(options) : [role.query];
    const query = roleQuery({ ...role, query: parts.length > 1 ? `(${parts.map((part) => `(${part})`).join(' or ')})` : (parts[0] ?? '') }, options);
    return this.scryfall.findPopularCards(query).pipe(
      map((cards) => {
        const [picked] = pickSuggestions([{ role: role.role, count: cards.length, cards }], options, ownedGameChangers);
        return { ...this.outline(role, options), cards: picked.cards };
      }),
    );
  }

  private search(role: RoleQuery, options: SuggestionOptions): Observable<{ cards: ScryfallCard[]; sources: Record<string, number[]> }> {
    return role.role === 'theme' ? this.mixed(role, themeQueries(options), options) : this.candidates(role, options).pipe(map((cards) => ({ cards, sources: {} })));
  }

  roles(options: SuggestionOptions): RoleQuery[] {
    return roleCounts(options).filter((r) => r.count > 0 || r.role === 'creatures');
  }

  // The targets of a role without its cards, shown until the cards are loaded.
  outline(role: RoleQuery, options: SuggestionOptions): SuggestionGroup {
    const types = options.creatureTypes ?? [];
    return {
      role: role.role,
      cards: [],
      ...roleTargets(role, options),
      ...(role.role === 'creatures' && types.length ? { types: [...types] } : {}),
    };
  }

  // The candidates of one role, more than it needs, so other suggestions can be drawn from them.
  group(role: RoleQuery, options: SuggestionOptions, ownedGameChangers = 0): Observable<SuggestionGroup> {
    return this.search(role, options).pipe(
      map(({ cards, sources }) => {
        const [picked] = pickSuggestions([{ role: role.role, count: optionCount(role.count) * POOL_FACTOR, cards }], options, ownedGameChangers);
        return { ...this.outline(role, options), cards: picked.cards, ...(role.role === 'theme' ? { sources } : {}) };
      }),
    );
  }

  // Candidates in order of preference; the first printing of a card wins, so cards from the own sets keep that set.
  // Creatures: those of the play style, and in a typal deck the deck's types (and changelings) from the own sets, then
  // of newer and older sets; then the rest.
  private candidates(role: RoleQuery, options: SuggestionOptions): Observable<ScryfallCard[]> {
    const sets = options.preferredSets ?? [];
    const creatures = role.role === 'creatures';
    const types = creatures && isTypal(options) ? (options.creatureTypes ?? []) : [];
    const styleCreatures = creatures ? styleCreatureQuery(options.style) : undefined;
    const search = (query: string, inSets: boolean, sort: (cards: ScryfallCard[]) => ScryfallCard[] = (c) => c) =>
      this.scryfall.findPopularCards([roleQuery({ ...role, query }, options), inSets ? setQuery(sets) : ''].filter(Boolean).join(' ')).pipe(map((cards) => sort(cards)));
    const searches: Observable<ScryfallCard[]>[] = [];
    // The higher the bracket, the more the strongest cards come first: Game Changers, fast mana, rares and mythics.
    const power = options.format === 'commander' ? (options.bracket ?? 0) : 0;
    if (power >= 3) {
      searches.push(search(`${role.query} is:gamechanger`, false));
    }
    if (power >= 5 && role.role === 'ramp') {
      searches.push(search(FAST_MANA_QUERY, false));
    }
    if (styleCreatures) {
      searches.push(search(styleCreatures, false));
    }
    if (types.length) {
      if (sets.length) {
        searches.push(search(tribalQuery(types), true));
      }
      searches.push(search(tribalQuery(types), false, newerFirst));
    }
    if (sets.length) {
      searches.push(search(role.query, true));
    }
    if (power >= 4) {
      searches.push(search(`${role.query} ${RARE_QUERY}`, false));
    }
    searches.push(search(role.query, false));
    return from(searches).pipe(
      concatMap((s) => s),
      toArray(),
      map((lists) => lists.flat()),
    );
  }

  // One search per query, taken in turns so every part of the plan shows up early; remembers which searches found each card.
  private mixed(role: RoleQuery, queries: readonly string[], options: SuggestionOptions): Observable<{ cards: ScryfallCard[]; sources: Record<string, number[]> }> {
    return from(queries).pipe(
      concatMap((query) => this.scryfall.findPopularCards(roleQuery({ ...role, query }, options))),
      toArray(),
      map((lists) => {
        const sources: Record<string, number[]> = {};
        lists.forEach((list, i) => list.forEach((card) => (sources[card.name] = [...(sources[card.name] ?? []), i])));
        return { cards: interleave(lists), sources };
      }),
    );
  }
}

export function interleave<T>(lists: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  for (let i = 0; lists.some((list) => i < list.length); i++) {
    lists.forEach((list) => i < list.length && result.push(list[i]));
  }
  return result;
}
