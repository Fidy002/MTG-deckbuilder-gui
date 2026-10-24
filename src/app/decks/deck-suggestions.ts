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
}

export interface SuggestionOptions {
  format: 'commander' | string;
  colors: readonly string[];
  bracket?: Bracket;
  exclude: readonly string[];
  // Non-land cards that are already in the deck (own cards, commander); the creatures fill the rest.
  ownedNonLands?: number;
}

export interface RoleQuery {
  role: SuggestionRole;
  query: string;
  count: number;
}

const COMMANDER_ROLES: readonly RoleQuery[] = [
  { role: 'ramp', query: 'otag:ramp -t:land', count: 10 },
  { role: 'draw', query: 'otag:draw -t:land', count: 10 },
  { role: 'removal', query: 'otag:removal -otag:sweeper -t:land', count: 8 },
  { role: 'wipes', query: 'otag:sweeper -t:land', count: 3 },
  { role: 'creatures', query: 't:creature', count: 20 },
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
    return from(roleCounts(options).filter((r) => r.count > 0)).pipe(
      concatMap((role) =>
        this.scryfall.findPopularCards(roleQuery(role, options)).pipe(map((cards) => ({ role: role.role, count: role.count, cards }))),
      ),
      toArray(),
      map((results) => pickSuggestions(results, options, ownedGameChangers)),
    );
  }
}
