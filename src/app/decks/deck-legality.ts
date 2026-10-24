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
  | { kind: 'mainDeckSize'; count: number }
  | { kind: 'sideboardSize'; count: number }
  | { kind: 'tooManyCopies'; name: string; count: number }
  | { kind: 'restricted'; name: string; count: number }
  | { kind: 'banned'; name: string }
  | { kind: 'notLegal'; name: string };

const KITCHEN_TABLE = 'kitchentable';

/** Scryfall legality keys of the 60 card formats, most played first; Kitchentable only checks deck size and copies. */
export const CONSTRUCTED_FORMATS: readonly { id: string; label: string }[] = [
  { id: 'standard', label: 'Standard' },
  { id: 'pioneer', label: 'Pioneer' },
  { id: 'modern', label: 'Modern' },
  { id: 'pauper', label: 'Pauper' },
  { id: 'legacy', label: 'Legacy' },
  { id: 'vintage', label: 'Vintage' },
  { id: 'historic', label: 'Historic' },
  { id: 'timeless', label: 'Timeless' },
  { id: 'alchemy', label: 'Alchemy' },
  { id: 'premodern', label: 'Premodern' },
  { id: 'oldschool', label: 'Old School' },
  { id: KITCHEN_TABLE, label: 'Kitchentable' },
];

export function legalityFormatLabel(format: string): string {
  return format === 'commander' ? 'Commander' : (CONSTRUCTED_FORMATS.find((f) => f.id === format)?.label ?? format);
}

export interface LegalityResult {
  format: string;
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
const MIN_MAIN_DECK = 60;
const MAX_SIDEBOARD = 15;
const MAX_COPIES = 4;
const BASIC_LANDS = new Set(
  ['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'].flatMap((name) => [name, `snow-covered ${name}`]),
);

export function checkLegality(format: string, cards: readonly CheckedCard[]): LegalityResult {
  return format === 'commander' ? checkCommanderLegality(cards) : checkConstructedLegality(format, cards);
}

function reporter(format: string) {
  const result: LegalityResult = { format, issues: [], cardIssues: new Map() };
  const report = (issue: LegalityIssue, key?: string) => {
    // A card in deck and sideboard is listed once but marked in both places.
    const same = JSON.stringify(issue);
    if (!result.issues.some((existing) => JSON.stringify(existing) === same)) {
      result.issues.push(issue);
    }
    if (key) {
      result.cardIssues.set(key, [...(result.cardIssues.get(key) ?? []), issue]);
    }
  };
  return { result, report };
}

function countCopies(cards: readonly CheckedCard[]): Map<string, number> {
  const copies = new Map<string, number>();
  for (const { entry } of cards) {
    copies.set(entry.name.toLowerCase(), (copies.get(entry.name.toLowerCase()) ?? 0) + entry.count);
  }
  return copies;
}

function reportFormatLegality(format: string, key: string, name: string, card: ScryfallCard, report: Reporter): void {
  const legality = card.legalities?.[format];
  if (legality === 'banned') {
    report({ kind: 'banned', name }, key);
  } else if (legality === 'not_legal') {
    report({ kind: 'notLegal', name }, key);
  }
}

type Reporter = ReturnType<typeof reporter>['report'];

export function checkConstructedLegality(format: string, cards: readonly CheckedCard[]): LegalityResult {
  const { result, report } = reporter(format);
  const sum = (list: readonly CheckedCard[]) => list.reduce((total, c) => total + c.entry.count, 0);

  const main = cards.filter((c) => c.entry.section === 'main' || c.entry.section === 'commander');
  const sideboard = cards.filter((c) => c.entry.section === 'sideboard' || c.entry.section === 'companion');

  if (sum(main) < MIN_MAIN_DECK) {
    report({ kind: 'mainDeckSize', count: sum(main) });
  }
  const casual = format === KITCHEN_TABLE;
  if (!casual && sum(sideboard) > MAX_SIDEBOARD) {
    report({ kind: 'sideboardSize', count: sum(sideboard) });
  }

  const deck = [...main, ...sideboard];
  const copies = countCopies(deck);
  // One issue per card name, but every line of that card is marked (e.g. two printings of the same card).
  const copyIssues = new Map<string, LegalityIssue>();
  for (const { key, entry, card } of deck) {
    const name = entry.name.toLowerCase();
    const total = copies.get(name) ?? 0;
    const restricted = card?.legalities?.[format] === 'restricted';
    if ((restricted && total > 1) || (total > MAX_COPIES && !allowsMultipleCopies(entry.name, card))) {
      const issue = copyIssues.get(name) ?? { kind: restricted ? 'restricted' : 'tooManyCopies', name: entry.name, count: total };
      copyIssues.set(name, issue);
      report(issue, key);
    }
    if (card && !casual) {
      reportFormatLegality(format, key, entry.name, card, report);
    }
  }

  return result;
}

export function checkCommanderLegality(cards: readonly CheckedCard[]): LegalityResult {
  const { result, report } = reporter('commander');

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

  const copies = countCopies(deck);

  const copyIssues = new Map<string, LegalityIssue>();
  for (const { key, entry, card } of deck) {
    const name = entry.name.toLowerCase();
    const total = copies.get(name) ?? 0;
    if (total > 1 && !allowsMultipleCopies(entry.name, card)) {
      const issue = copyIssues.get(name) ?? { kind: 'notSingleton', name: entry.name, count: total };
      copyIssues.set(name, issue);
      report(issue, key);
    }
    if (!card) {
      continue;
    }
    reportFormatLegality('commander', key, entry.name, card, report);
    if (identity && entry.section === 'main' && (card.color_identity ?? []).some((color) => !identity.has(color))) {
      report({ kind: 'colorIdentity', name: entry.name }, key);
    }
  }

  return result;
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

export function canBeCommander(card: ScryfallCard, paired: boolean): boolean {
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

export function canPair(a: ScryfallCard, b: ScryfallCard): boolean {
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

/** Whether a commander can have a second commander next to it (Partner, Background, Doctor's companion, ...). */
export function allowsSecondCommander(card: ScryfallCard): boolean {
  const type = typeLine(card);
  return (
    ['partner', 'friends forever', 'choose a background', "doctor's companion"].some((keyword) => hasKeyword(card, keyword)) ||
    type.includes('background') ||
    type.includes('time lord doctor')
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

export function legalityIssueParams(issue: LegalityIssue, format: string): TranslationParams {
  const { kind: _kind, ...params } = issue;
  return { ...params, format: legalityFormatLabel(format) };
}

export type LegalityFix = 'copies' | 'illegal' | 'all';

const COPY_LIMITS: Partial<Record<LegalityIssue['kind'], number>> = { notSingleton: 1, restricted: 1, tooManyCopies: MAX_COPIES };
const ILLEGAL_KINDS = new Set<LegalityIssue['kind']>(['banned', 'notLegal', 'colorIdentity']);

export function isCopyIssue(issue: LegalityIssue): boolean {
  return issue.kind in COPY_LIMITS;
}

export function canFix(issues: readonly LegalityIssue[], fix: LegalityFix): boolean {
  return issues.some((issue) => (fix !== 'illegal' && isCopyIssue(issue)) || (fix !== 'copies' && ILLEGAL_KINDS.has(issue.kind)));
}

/** Removes surplus copies and/or cards that are not allowed; the maybeboard stays untouched. */
export function applyLegalityFix(
  entries: readonly DeckEntry[],
  issues: readonly LegalityIssue[],
  fix: LegalityFix,
): { entries: DeckEntry[]; removed: number } {
  const limits = new Map<string, number>();
  for (const issue of issues) {
    const limit = issue.kind in COPY_LIMITS ? COPY_LIMITS[issue.kind]! : ILLEGAL_KINDS.has(issue.kind) ? 0 : undefined;
    const applies = limit !== undefined && (fix === 'all' || (fix === 'copies') === (limit > 0));
    if (applies && 'name' in issue) {
      const name = issue.name.toLowerCase();
      limits.set(name, Math.min(limit, limits.get(name) ?? limit));
    }
  }

  let removed = 0;
  const fixed = entries.flatMap((entry) => {
    const name = entry.name.toLowerCase();
    const remaining = limits.get(name);
    if (remaining === undefined || entry.section === 'maybeboard') {
      return [entry];
    }
    const count = Math.min(entry.count, remaining);
    limits.set(name, remaining - count);
    removed += entry.count - count;
    return count > 0 ? [{ ...entry, count }] : [];
  });
  return { entries: fixed, removed };
}
