import { TranslationKey, TranslationParams } from '../i18n/i18n.service';
import { ScryfallCard } from '../scryfall/scryfall.models';
import { DeckEntry } from './decklist';

export type LegalityIssue =
  | { kind: 'deckSize'; count: number }
  | { kind: 'noCommander' }
  | { kind: 'tooManyCommanders' }
  | { kind: 'invalidCommander'; name: string }
  | { kind: 'invalidPartners'; names: string }
  | { kind: 'notSingleton'; name: string; count: number }
  | { kind: 'colorIdentity'; name: string }
  | { kind: 'banned'; name: string }
  | { kind: 'notLegal'; name: string };

export interface LegalityResult {
  issues: LegalityIssue[];
  /** Issues per card key (see `cardKey`), for marking the cards in the overview. */
  cardIssues: Map<string, LegalityIssue[]>;
}

interface CheckedCard {
  key: string;
  entry: DeckEntry;
  card?: ScryfallCard;
}

const DECK_SIZE = 100;
const BASIC_LANDS = new Set(
  ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'].flatMap((name) => [name, `snow-covered ${name}`]),
);

export function checkCommanderLegality(cards: readonly CheckedCard[]): LegalityResult {
  const issues: LegalityIssue[] = [];
  const cardIssues = new Map<string, LegalityIssue[]>();
  const report = (issue: LegalityIssue, key?: string) => {
    issues.push(issue);
    if (key) {
      cardIssues.set(key, [...(cardIssues.get(key) ?? []), issue]);
    }
  };

  const commanders = cards.filter((c) => c.entry.section === 'commander');
  const deck = cards.filter((c) => c.entry.section === 'commander' || c.entry.section === 'main');

  const size = deck.reduce((sum, c) => sum + c.entry.count, 0);
  if (size !== DECK_SIZE) {
    report({ kind: 'deckSize', count: size });
  }

  const commanderCount = commanders.reduce((sum, c) => sum + c.entry.count, 0);
  if (commanderCount === 0) {
    report({ kind: 'noCommander' });
  } else if (commanderCount > 2) {
    report({ kind: 'tooManyCommanders' });
  } else {
    for (const commander of commanders) {
      if (commander.card && !canBeCommander(commander.card, commanders.length === 2)) {
        report({ kind: 'invalidCommander', name: commander.entry.name }, commander.key);
      }
    }
    const [first, second] = commanders.map((c) => c.card);
    if (commanders.length === 2 && first && second && !canPair(first, second)) {
      report({ kind: 'invalidPartners', names: commanders.map((c) => c.entry.name).join(' + ') });
    }
  }

  // Color identity can only be checked once every commander is known.
  const identity =
    commanders.length && commanders.every((c) => c.card)
      ? new Set(commanders.flatMap((c) => c.card!.color_identity ?? []))
      : undefined;

  const copies = new Map<string, number>();
  for (const { entry } of deck) {
    copies.set(entry.name.toLowerCase(), (copies.get(entry.name.toLowerCase()) ?? 0) + entry.count);
  }

  for (const { key, entry, card } of deck) {
    const total = copies.get(entry.name.toLowerCase()) ?? 0;
    if (total > 1 && !allowsMultipleCopies(entry.name, card)) {
      report({ kind: 'notSingleton', name: entry.name, count: total }, key);
      copies.set(entry.name.toLowerCase(), 0);
    }
    if (!card) {
      continue;
    }
    const legality = card.legalities?.['commander'];
    if (legality === 'banned') {
      report({ kind: 'banned', name: entry.name }, key);
    } else if (legality === 'not_legal') {
      report({ kind: 'notLegal', name: entry.name }, key);
    }
    if (identity && entry.section === 'main' && (card.color_identity ?? []).some((color) => !identity.has(color))) {
      report({ kind: 'colorIdentity', name: entry.name }, key);
    }
  }

  return { issues, cardIssues };
}

function typeLine(card: ScryfallCard): string {
  return (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').toLowerCase();
}

function oracleText(card: ScryfallCard): string {
  return [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].join('\n').toLowerCase();
}

function hasKeyword(card: ScryfallCard, keyword: string): boolean {
  return (card.keywords ?? []).some((k) => k.toLowerCase() === keyword);
}

function canBeCommander(card: ScryfallCard, paired: boolean): boolean {
  const type = typeLine(card);
  if (type.includes('legendary') && type.includes('creature')) {
    return true;
  }
  if (oracleText(card).includes('can be your commander')) {
    return true;
  }
  // A Background is only a commander next to a creature with "Choose a Background".
  return paired && type.includes('background');
}

function canPair(a: ScryfallCard, b: ScryfallCard): boolean {
  const both = (keyword: string) => hasKeyword(a, keyword) && hasKeyword(b, keyword);
  const oneWithOther = (keyword: string, partnerType: string) =>
    (hasKeyword(a, keyword) && typeLine(b).includes(partnerType)) ||
    (hasKeyword(b, keyword) && typeLine(a).includes(partnerType));
  return (
    both('partner') ||
    both('friends forever') ||
    oneWithOther('choose a background', 'background') ||
    oneWithOther("doctor's companion", 'time lord doctor')
  );
}

function allowsMultipleCopies(name: string, card: ScryfallCard | undefined): boolean {
  if (BASIC_LANDS.has(name.toLowerCase())) {
    return true;
  }
  const text = card ? oracleText(card) : '';
  return text.includes('a deck can have any number of cards named') || text.includes('a deck can have up to');
}

export function legalityIssueKey(issue: LegalityIssue): TranslationKey {
  return `legality.${issue.kind}`;
}

export function legalityIssueParams(issue: LegalityIssue): TranslationParams {
  const { kind: _kind, ...params } = issue;
  return params;
}
