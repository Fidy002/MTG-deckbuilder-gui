
export type DeckSection = 'commander' | 'companion' | 'main' | 'sideboard' | 'maybeboard';

export const DECK_SECTIONS: readonly DeckSection[] = ['commander', 'companion', 'main', 'sideboard', 'maybeboard'];

export interface DeckEntry {
  count: number;
  name: string;
  set?: string;
  collectorNumber?: string;
  foil?: boolean;
  section: DeckSection;
}

export interface ParseOptions {
  // MTGO convention: a blank line starts the sideboard. Only for imports, not the deck editor.
  blankLineStartsSideboard?: boolean;
}

const HEADERS: Record<string, DeckSection | 'ignore'> = {
  commander: 'commander',
  commanders: 'commander',
  companion: 'companion',
  deck: 'main',
  main: 'main',
  maindeck: 'main',
  mainboard: 'main',
  sideboard: 'sideboard',
  sb: 'sideboard',
  maybeboard: 'maybeboard',
  maybe: 'maybeboard',
  considering: 'maybeboard',
  about: 'ignore',
};

const CARD_LINE = /^(\d+)\s*x?\s+(.+)$/i;
const SET_AND_NUMBER = /\s+\(([a-z0-9]{2,6})\)(?:\s+([^\s()]+))?\s*$/i;
const FOIL_MARKER = /\s+\*(?:f|e|foil|etched)\*/gi;
const ARCHIDEKT_TAGS = /\s*\^[^^]*\^/g;
const ARCHIDEKT_CATEGORY = /\s*\[([^\]]*)\]/;

export function parseDecklist(text: string, options: ParseOptions = {}): DeckEntry[] {
  const entries: DeckEntry[] = [];
  let section: DeckSection = 'main';
  let ignoring = false;
  let sawHeader = false;
  let blankAfterCards = false;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();

    if (!line) {
      blankAfterCards = entries.length > 0;
      continue;
    }

    const header = headerOf(line);
    if (header) {
      sawHeader = true;
      ignoring = header === 'ignore';
      if (header !== 'ignore') {
        section = header;
      }
      blankAfterCards = false;
      continue;
    }
    if (ignoring || line.startsWith('//') || line.startsWith('#')) {
      continue;
    }

    let lineSection = section;
    if (/^sb:\s*/i.test(line)) {
      line = line.replace(/^sb:\s*/i, '');
      lineSection = 'sideboard';
    } else if (options.blankLineStartsSideboard && blankAfterCards && !sawHeader && section === 'main') {
      section = lineSection = 'sideboard';
    }
    blankAfterCards = false;

    const entry = parseCardLine(line, lineSection);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function headerOf(line: string): DeckSection | 'ignore' | undefined {
  const normalized = line
    .replace(/^\/\/\s*/, '')
    .replace(/:$/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
  return HEADERS[normalized];
}

function parseCardLine(line: string, section: DeckSection): DeckEntry | undefined {
  const match = CARD_LINE.exec(line);
  const count = match ? Number(match[1]) : 1;
  let rest = match ? match[2] : line;

  rest = rest.replace(ARCHIDEKT_TAGS, '');

  const category = ARCHIDEKT_CATEGORY.exec(rest);
  if (category) {
    rest = rest.replace(ARCHIDEKT_CATEGORY, '');
    section = sectionFromCategory(category[1]) ?? section;
  }

  const foil = rest.match(FOIL_MARKER) !== null;
  rest = rest.replace(FOIL_MARKER, '');

  const entry: DeckEntry = { count, name: rest.trim(), section };
  const print = SET_AND_NUMBER.exec(rest);
  if (print) {
    entry.name = rest.slice(0, print.index).trim();
    if (print[2]) {
      entry.set = print[1].toLowerCase();
      entry.collectorNumber = print[2];
    }
  }
  if (foil) {
    entry.foil = true;
  }
  return entry.name && count > 0 ? entry : undefined;
}

function sectionFromCategory(categories: string): DeckSection | undefined {
  for (const category of categories.split(',')) {
    const name = category.replace(/\{[^}]*\}/g, '').trim().toLowerCase();
    const section = HEADERS[name];
    if (section && section !== 'ignore') {
      return section;
    }
  }
  return undefined;
}

export function serializeDecklist(entries: readonly DeckEntry[]): string {
  const used = DECK_SECTIONS.filter((section) => entries.some((e) => e.section === section));
  if (used.length === 0) {
    return '';
  }
  if (used.length === 1 && used[0] === 'main') {
    return entries.map((e) => entryLine(e)).join('\n');
  }
  return used
    .map((section) =>
      [SECTION_HEADERS[section], ...entries.filter((e) => e.section === section).map((e) => entryLine(e))].join('\n'),
    )
    .join('\n\n');
}

export const SECTION_HEADERS: Record<DeckSection, string> = {
  commander: 'Commander',
  companion: 'Companion',
  main: 'Deck',
  sideboard: 'Sideboard',
  maybeboard: 'Maybeboard',
};

export interface EntryLineOptions {
  withPrint?: boolean;
  withFoil?: boolean;
  countSuffix?: string;
  upperCaseSet?: boolean;
}

export function entryLine(entry: DeckEntry, options: EntryLineOptions = {}): string {
  const { withPrint = true, withFoil = true, countSuffix = '', upperCaseSet = true } = options;
  let line = `${entry.count}${countSuffix} ${entry.name}`;
  if (withPrint && entry.set && entry.collectorNumber) {
    line += ` (${upperCaseSet ? entry.set.toUpperCase() : entry.set}) ${entry.collectorNumber}`;
  }
  if (withFoil && entry.foil) {
    line += ' *F*';
  }
  return line;
}

export function isSameCard(a: DeckEntry, b: DeckEntry): boolean {
  return (
    a.section === b.section &&
    a.name.toLowerCase() === b.name.toLowerCase() &&
    a.set === b.set &&
    a.collectorNumber === b.collectorNumber &&
    !!a.foil === !!b.foil
  );
}

export function countEntries(entries: readonly DeckEntry[], sections: readonly DeckSection[]): number {
  return entries.filter((e) => sections.includes(e.section)).reduce((sum, e) => sum + e.count, 0);
}
