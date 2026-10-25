import { Injectable, inject } from '@angular/core';
import { Observable, concatMap, from, map, toArray } from 'rxjs';
import { ScryfallCard } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { Bracket, isExtraTurn, isMassLandDenial } from './deck-brackets';
import { DeckEntry } from './decklist';

export type SuggestionRole = 'ramp' | 'draw' | 'removal' | 'wipes' | 'creatures' | 'lands';

export interface SuggestionGroup {
  role: SuggestionRole;
  cards: ScryfallCard[];
  // Creature types the creature suggestions were picked for.
  types?: string[];
}

export interface SuggestionOptions {
  format: 'commander' | string;
  colors: readonly string[];
  bracket?: Bracket;
  exclude: readonly string[];
  // Non-land cards that are already in the deck (own cards, commander); the creatures fill the rest.
  ownedNonLands?: number;
  // Creature types of the deck (see deckCreatureTypes); creatures of these types are suggested first.
  creatureTypes?: readonly string[];
  // Sets of the own cards (likely opened in boosters); cards from these sets come first.
  preferredSets?: readonly string[];
}

export interface RoleQuery {
  role: SuggestionRole;
  query: string;
  count: number;
}

const COMMANDER_ROLES: readonly RoleQuery[] = [
  { role: 'creatures', query: 't:creature', count: 20 },
  { role: 'ramp', query: 'otag:ramp -t:land', count: 10 },
  { role: 'draw', query: 'otag:draw -t:land', count: 10 },
  { role: 'removal', query: 'otag:removal -otag:sweeper -t:land', count: 8 },
  { role: 'wipes', query: 'otag:sweeper -t:land', count: 3 },
  { role: 'lands', query: 't:land -t:basic', count: 10 },
];

// 60 card decks play most cards four times, so fewer different cards are needed.
const CONSTRUCTED_ROLES: readonly RoleQuery[] = [
  { role: 'creatures', query: 't:creature', count: 5 },
  { role: 'removal', query: 'otag:removal -t:land', count: 2 },
  { role: 'draw', query: 'otag:draw -t:land', count: 2 },
  { role: 'lands', query: 't:land -t:basic', count: 4 },
];

const GAME_CHANGER_LIMIT_UPGRADED = 3;
const RECENT_YEARS = 3;
const MAX_CREATURE_TYPES = 3;
const MAX_PREFERRED_SETS = 6;
// Too common to say anything about a deck's theme, unless the commander names them.
const GENERIC_TYPES = new Set(['Human']);
const IRREGULAR_PLURALS: Record<string, string> = { Elf: 'Elves', Dwarf: 'Dwarves', Wolf: 'Wolves', Werewolf: 'Werewolves', Mouse: 'Mice', Ox: 'Oxen' };

function creatureSubtypes(card: ScryfallCard): string[] {
  return (card.card_faces?.map((f) => f.type_line ?? '') ?? [card.type_line ?? ''])
    .filter((line) => line.includes('Creature'))
    .flatMap((line) => (line.split('—')[1] ?? '').trim().split(/\s+/))
    .filter(Boolean);
}

function mentions(text: string, type: string): boolean {
  const forms = [type, IRREGULAR_PLURALS[type] ?? `${type}s`, `${type}es`];
  return forms.some((form) => new RegExp(`\\b${form}\\b`).test(text));
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

/** Cards from the last few years first, otherwise in the given (popularity) order. */
export function newerFirst(cards: readonly ScryfallCard[], now = new Date()): ScryfallCard[] {
  const cutoff = new Date(now.getFullYear() - RECENT_YEARS, now.getMonth(), now.getDate()).toISOString().slice(0, 10);
  const recent = (card: ScryfallCard) => (card.released_at ?? '') >= cutoff;
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
const COMMANDER_SIZE = 100;
const CONSTRUCTED_SIZE = 60;
const CONSTRUCTED_COPIES = 4;

/** Role counts, with as many creatures as needed to fill the non-land slots that are still free. */
export function roleCounts(options: SuggestionOptions): RoleQuery[] {
  const commander = options.format === 'commander';
  const roles = commander ? COMMANDER_ROLES : CONSTRUCTED_ROLES;
  const copies = commander ? 1 : CONSTRUCTED_COPIES;
  const nonLandSlots = (commander ? COMMANDER_SIZE - COMMANDER_LANDS : CONSTRUCTED_SIZE - CONSTRUCTED_LANDS) - (options.ownedNonLands ?? 0);
  const fixed = roles.filter((r) => r.role !== 'creatures' && r.role !== 'lands').reduce((sum, r) => sum + r.count * copies, 0);
  const creatures = Math.max(0, Math.ceil((nonLandSlots - fixed) / copies));
  return roles.map((r) => (r.role === 'creatures' ? { ...r, count: creatures } : r));
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

  // Commanders with exactly the needed colors first, then those with more; most played first within each.
  commanders(colors: readonly string[], bracket?: Bracket): Observable<ScryfallCard[]> {
    return this.scryfall
      .findPopularCards(commanderQuery(colors, bracket))
      .pipe(map((cards) => [...cards].sort((a, b) => (a.color_identity?.length ?? 0) - (b.color_identity?.length ?? 0))));
  }

  // One search per role, one after another (the rate limiter spaces them out anyway).
  cards(options: SuggestionOptions, ownedGameChangers = 0): Observable<SuggestionGroup[]> {
    const types = options.creatureTypes ?? [];
    return from(roleCounts(options).filter((r) => r.count > 0)).pipe(
      concatMap((role) => this.candidates(role, options).pipe(map((cards) => ({ role: role.role, count: role.count, cards })))),
      toArray(),
      map((results) =>
        pickSuggestions(results, options, ownedGameChangers).map((group) =>
          group.role === 'creatures' && types.length ? { ...group, types: [...types] } : group,
        ),
      ),
    );
  }

  // Candidates in order of preference; the first printing of a card wins, so cards from the own sets keep that set.
  // Creatures: the deck's types (and changelings) from the own sets, then of newer and older sets, then the rest.
  private candidates(role: RoleQuery, options: SuggestionOptions): Observable<ScryfallCard[]> {
    const sets = options.preferredSets ?? [];
    const types = role.role === 'creatures' ? (options.creatureTypes ?? []) : [];
    const search = (query: string, inSets: boolean, sort: (cards: ScryfallCard[]) => ScryfallCard[] = (c) => c) =>
      this.scryfall.findPopularCards([roleQuery({ ...role, query }, options), inSets ? setQuery(sets) : ''].filter(Boolean).join(' ')).pipe(map((cards) => sort(cards)));
    const searches: Observable<ScryfallCard[]>[] = [];
    if (types.length) {
      if (sets.length) {
        searches.push(search(tribalQuery(types), true));
      }
      searches.push(search(tribalQuery(types), false, newerFirst));
    }
    if (sets.length) {
      searches.push(search(role.query, true));
    }
    searches.push(search(role.query, false));
    return from(searches).pipe(
      concatMap((s) => s),
      toArray(),
      map((lists) => lists.flat()),
    );
  }
}
