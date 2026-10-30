import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { COLOR_ORDER, ScryfallCard, deckCardName } from '../scryfall/scryfall.models';
import { ScryfallService } from '../scryfall/scryfall.service';
import { categoryRole } from './auto-categories';
import { comboPiecesQuery } from './deck-brackets';
import { STYLE_CURVES, curveScore, manaCurve } from './deck-curve';
import { DeckCardsService, cardKey, withImages } from './deck-cards.service';
import { CONSTRUCTED_FORMATS } from './deck-legality';
import {
  COMMANDER_LANDS,
  CONSTRUCTED_LANDS,
  DeckSuggestions,
  PlayStyle,
  RoleQuery,
  SuggestionOptions,
  SuggestionRole,
  deckCreatureTypes,
  hasCreatureType,
  interleave,
  isTypal,
  preferredSets,
} from './deck-suggestions';
import { CardRating, SynergyId, cardEffects, cardScore, cardSynergies, commanderStyle, commanderSynergies, fitsStyle, roleSynergies } from './deck-synergies';
import { WinPlan, WinconId, cardWincons, recommendPlan, winconQueries } from './deck-wincons';
import { Deck } from './deck.service';
import { DeckEntry, detectFormat, parseDecklist } from './decklist';

// The wizard searches the deck's creature types first; with one search per role they are lifted in the ranking instead.
// A chosen theme makes its creature types the top priority; a lord commander only adds a little.
const TYPAL_SCORE = 2;
const THEME_TYPE_SCORE = 10;

export interface RankedSuggestion {
  // English printing.
  card: ScryfallCard;
  rating: CardRating;
  // The win plans the card brings.
  plans: WinconId[];
  // Whether it plays into the deck's play style.
  styleFit: boolean;
}

/** What the suggestions for a deck are read off: commander, play style, plan and what each role should have. */
export interface DeckAdvice {
  options: SuggestionOptions;
  roles: RoleQuery[];
  // Cards of each role the deck should have (copies included).
  targets: Map<SuggestionRole, number>;
  plan: WinPlan;
  commander?: ScryfallCard;
  synergies: SynergyId[];
  curve: number[];
  nonLands: number;
  ownedGameChangers: number;
  // Ranked candidates per role, searched when the role is first needed.
  ranked: Map<SuggestionRole, RankedSuggestion[]>;
}

/**
 * The roles in the order the deck needs them: the biggest gap (missing cards relative to the target) first; once
 * nothing is missing, the cards of the play style come first.
 */
export function rolesByNeed(targets: ReadonlyMap<SuggestionRole, number>, missing: ReadonlyMap<SuggestionRole, number>): SuggestionRole[] {
  const gap = (role: SuggestionRole) => (missing.get(role) ?? 0) / Math.max(1, targets.get(role) ?? 0);
  return [...targets.keys()].sort((a, b) => gap(b) - gap(a) || +(b === 'theme') - +(a === 'theme'));
}

// A click mixes every role the deck misses (the neediest ones if that's too many), each with a few cards at least.
const MIN_ROLES_PER_CLICK = 3;
const MAX_ROLES_PER_CLICK = 6;
const MIN_PER_ROLE = 2;
// Cards with a synergy come first, but only this many per click, so the rest of the deck's needs show up too.
export const MAX_SYNERGY_PER_CLICK = 8;

/** How many of the suggestions of one click go to which role, by how much each misses. */
export function suggestionShares(
  order: readonly SuggestionRole[],
  missing: ReadonlyMap<SuggestionRole, number>,
  total: number,
): [SuggestionRole, number][] {
  const needy = order.filter((role) => (missing.get(role) ?? 0) > 0).slice(0, MAX_ROLES_PER_CLICK);
  const roles = needy.length >= MIN_ROLES_PER_CLICK ? needy : order.slice(0, MIN_ROLES_PER_CLICK);
  const weights = roles.map((role) => Math.max(1, missing.get(role) ?? 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  const shares = weights.map((w) => Math.max(MIN_PER_ROLE, Math.floor((total * w) / sum)));
  // The neediest role takes what rounding leaves over (or gives back what the minimum took too much).
  shares[0] = Math.max(MIN_PER_ROLE, shares[0] + total - shares.reduce((a, b) => a + b, 0));
  return roles.map((role, i) => [role, shares[i]]);
}

/**
 * The suggestions of one click from the ranked candidates of each role (in order of need): every role its share,
 * what one can't fill goes to the next; a card is shown once. Cards with a synergy lead, up to the maximum, then the
 * roles take turns.
 */
export function mixSuggestions(
  lists: readonly [SuggestionRole, readonly RankedSuggestion[]][],
  shares: ReadonlyMap<SuggestionRole, number>,
  total: number,
  isSynergy: (suggestion: RankedSuggestion) => boolean,
  maxSynergy = MAX_SYNERGY_PER_CLICK,
): RankedSuggestion[] {
  const taken = new Set<string>();
  const picked: RankedSuggestion[][] = [];
  let synergies = 0;
  let carry = 0;
  for (const [role, list] of lists) {
    const wanted = Math.min(total - taken.size, (shares.get(role) ?? 0) + carry);
    const cards: RankedSuggestion[] = [];
    for (const suggestion of list) {
      if (cards.length >= wanted) {
        break;
      }
      const synergy = isSynergy(suggestion);
      if (taken.has(suggestion.card.name) || (synergy && synergies >= maxSynergy)) {
        continue;
      }
      cards.push(suggestion);
      taken.add(suggestion.card.name);
      synergies += +synergy;
    }
    carry = Math.max(0, wanted - cards.length);
    picked.push(cards);
  }
  return [...interleave(picked.map((cards) => cards.filter(isSynergy))), ...interleave(picked.map((cards) => cards.filter((c) => !isSynergy(c))))];
}

/** Card suggestions for a deck that already exists, read off its commander, colors and cards like in the deck wizard. */
@Injectable({ providedIn: 'root' })
export class DeckAdvisor {
  private readonly deckCards = inject(DeckCardsService);
  private readonly suggestions = inject(DeckSuggestions);
  private readonly scryfall = inject(ScryfallService);

  /** Reads the deck; no card search yet (see candidates). */
  async advise(deck: Deck, language: string): Promise<DeckAdvice> {
    const entries = parseDecklist(deck.text).filter((e) => e.section !== 'maybeboard' && e.section !== 'sideboard');
    const resolved = entries.length ? await firstValueFrom(this.deckCards.resolve(entries, language)) : new Map();
    const owned = entries.flatMap((entry) => {
      const card = resolved.get(cardKey(entry))?.card;
      return card ? [{ entry, card }] : [];
    });
    const cards = owned.map((o) => o.card);
    const commanderDeck = (deck.format ?? detectFormat(entries)) === 'commander';
    const commander = commanderDeck ? owned.find((o) => o.entry.section === 'commander')?.card : undefined;
    const identity = new Set(commander?.color_identity ?? cards.flatMap((c) => c.color_identity ?? []));
    const colors = COLOR_ORDER.filter((c) => identity.has(c));
    const catalog = await firstValueFrom(this.scryfall.creatureTypes$).catch(() => [] as string[]);
    // The theme chosen in the wizard is a must: its types alone, not others read off the deck's cards.
    const themes = deck.themes ?? [];
    const types = themes.length ? themes : deckCreatureTypes(commander, cards, catalog);
    // The play style chosen in the wizard decides what fits; without one, the commander's.
    const style = deck.style ?? ((commanderStyle(commander, cards) ?? 'midrange') as PlayStyle);
    const bracket = commanderDeck ? (deck.bracket ?? 2) : undefined;
    const synergies = commanderSynergies(commander, types);
    const plan = recommendPlan(style, synergies, commander);
    const countOf = (type: string) =>
      owned.filter((o) => o.entry.section !== 'commander' && o.card.type_line?.includes(type)).reduce((sum, o) => sum + o.entry.count, 0);
    const options: SuggestionOptions = {
      format: commanderDeck ? 'commander' : (deck.legalityFormat ?? CONSTRUCTED_FORMATS[0].id),
      colors,
      bracket,
      exclude: cards.map((c) => c.name),
      style,
      commander,
      ownedCreatures: countOf('Creature'),
      ownedLands: countOf('Land'),
      creatureTypes: types,
      themeTypes: themes,
      preferredSets: preferredSets(owned.map((o) => ({ set: o.entry.set ?? o.card.set, basic: !!o.card.type_line?.startsWith('Basic') }))),
      planQueries: [
        ...winconQueries([plan.main, ...(plan.backup ? [plan.backup] : [])]),
        ...((bracket ?? 0) >= 4 ? [comboPiecesQuery()] : []),
      ],
    };
    const roles = this.suggestions.roles(options);
    const lands = commanderDeck ? COMMANDER_LANDS : CONSTRUCTED_LANDS;
    return {
      options,
      roles,
      targets: new Map(roles.map((r) => [r.role, r.role === 'lands' ? lands : (this.suggestions.outline(r, options).recommended ?? 0)])),
      plan,
      commander,
      synergies,
      curve: manaCurve(owned.filter((o) => o.entry.section !== 'commander').map((o) => ({ card: o.card, count: o.entry.count }))),
      nonLands: commanderDeck ? 100 - lands - 1 : 60 - lands,
      ownedGameChangers: cards.filter((c) => c.game_changer).length,
      ranked: new Map(),
    };
  }

  /** The candidates of a role, best fitting first, with one search the first time the role is asked for. */
  async candidates(advice: DeckAdvice, role: SuggestionRole): Promise<RankedSuggestion[]> {
    const known = advice.ranked.get(role);
    const query = advice.roles.find((r) => r.role === role);
    if (known || !query) {
      return known ?? [];
    }
    const { options } = advice;
    const group = await firstValueFrom(this.suggestions.roleCards(query, options, advice.ownedGameChangers));
    const style = options.style ?? 'midrange';
    // Unlike in the wizard, a synergy with the commander counts in every role: the deck mostly misses other roles than
    // the ones its synergies are made for (a lifegain card is one whether it is filed under the theme or removal).
    const roleIds = role === 'lands' ? roleSynergies(advice.synergies, role) : advice.synergies;
    const types = role === 'creatures' && isTypal(options) ? (options.creatureTypes ?? []) : [];
    const typeScore = options.themeTypes?.length ? THEME_TYPE_SCORE : TYPAL_SCORE;
    const typal = (card: ScryfallCard) => (types.length && hasCreatureType(card, types) ? typeScore : 0);
    const ranked = group.cards
      .map((card, index) => {
        const rating = { synergies: cardSynergies(card, roleIds, options.creatureTypes ?? []), effects: cardEffects(card, role, options.colors) };
        const score =
          cardScore(card, rating, role, style, index, group.cards.length, options.bracket ?? 0) +
          (role === 'theme' ? 0 : curveScore(card, advice.curve, STYLE_CURVES[style], advice.nonLands)) +
          typal(card);
        return { suggestion: { card, rating, plans: cardWincons(card), styleFit: fitsStyle(card, style) }, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ suggestion }) => suggestion);
    advice.ranked.set(role, ranked);
    return ranked;
  }

  /** What each role still misses in the deck as it is now (copies included). */
  async missing(deck: Deck, advice: DeckAdvice, language: string): Promise<Map<SuggestionRole, number>> {
    const entries = parseDecklist(deck.text).filter((e) => e.section !== 'maybeboard' && e.section !== 'sideboard' && e.section !== 'commander');
    const resolved = entries.length ? await firstValueFrom(this.deckCards.resolve(entries, language)) : new Map();
    const byType = (type: string) =>
      entries.filter((e) => resolved.get(cardKey(e))?.card?.type_line?.includes(type)).reduce((sum, e) => sum + e.count, 0);
    const owned = new Map<SuggestionRole, number>([
      ['creatures', byType('Creature')],
      ['lands', byType('Land')],
    ]);
    // Checked locally on the rules text, so no search is needed for the cards already in the deck.
    for (const entry of entries) {
      const card = resolved.get(cardKey(entry))?.card;
      const role = card ? categoryRole(card) : undefined;
      if (role) {
        owned.set(role, (owned.get(role) ?? 0) + entry.count);
      }
    }
    return new Map([...advice.targets].map(([role, target]) => [role, Math.max(0, target - (owned.get(role) ?? 0))]));
  }

  /** The given cards in the card language, with English images where a printing has no scan yet. */
  async localize(cards: readonly ScryfallCard[], language: string): Promise<ScryfallCard[]> {
    const entries = cards.map((card): DeckEntry => ({ count: 1, name: deckCardName(card), section: 'main' }));
    if (!entries.length) {
      return [];
    }
    const resolved = await firstValueFrom(this.deckCards.resolve(entries, language));
    return cards.map((card, i) => withImages(resolved.get(cardKey(entries[i]))?.card ?? card, card));
  }
}
