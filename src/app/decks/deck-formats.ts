import { DeckEntry, DeckSection, SECTION_HEADERS, entryLine } from './decklist';

export interface DeckExportFormat {
  id: string;
  label: string;
  export: (entries: readonly DeckEntry[]) => string;
}

function sectionBlocks(
  entries: readonly DeckEntry[],
  sections: readonly DeckSection[],
  line: (entry: DeckEntry) => string,
): string {
  return sections
    .map((section) => ({ section, lines: entries.filter((e) => e.section === section).map(line) }))
    .filter((block) => block.lines.length > 0)
    .map((block) => [SECTION_HEADERS[block.section], ...block.lines].join('\n'))
    .join('\n\n');
}

export const DECK_EXPORT_FORMATS: readonly DeckExportFormat[] = [
  {
    id: 'arena',
    label: 'MTG Arena',
    // Arena uses its own set codes, so only names are exported to avoid "card not found" errors.
    export: (entries) =>
      sectionBlocks(entries, ['commander', 'companion', 'main', 'sideboard'], (e) =>
        entryLine(e, { withPrint: false, withFoil: false, withCategory: false }),
      ),
  },
  {
    id: 'mtgo',
    label: 'MTGO (.txt)',
    export: (entries) => {
      const line = (e: DeckEntry) => entryLine(e, { withPrint: false, withFoil: false, withCategory: false });
      const main = entries.filter((e) => e.section === 'main').map(line);
      const side = entries
        .filter((e) => e.section === 'commander' || e.section === 'companion' || e.section === 'sideboard')
        .map(line);
      return side.length ? `${main.join('\n')}\n\n${side.join('\n')}` : main.join('\n');
    },
  },
  {
    id: 'moxfield',
    label: 'Moxfield',
    export: (entries) =>
      sectionBlocks(entries, ['commander', 'companion', 'main', 'sideboard', 'maybeboard'], (e) => entryLine(e, { withCategory: false })),
  },
  {
    id: 'archidekt',
    label: 'Archidekt',
    export: (entries) =>
      entries
        .map((e) => {
          const line = entryLine(e, { countSuffix: 'x', upperCaseSet: false, withCategory: false });
          const categories = [ARCHIDEKT_CATEGORIES[e.section], e.category].filter(Boolean);
          return categories.length ? `${line} [${categories.join(',')}]` : line;
        })
        .join('\n'),
  },
  {
    id: 'text',
    label: 'Text',
    export: (entries) =>
      sectionBlocks(entries, ['commander', 'companion', 'main', 'sideboard', 'maybeboard'], (e) =>
        entryLine(e, { withPrint: false, withFoil: false, withCategory: false }),
      ),
  },
];

const ARCHIDEKT_CATEGORIES: Record<DeckSection, string | undefined> = {
  commander: 'Commander{top}',
  companion: 'Companion{noDeck}',
  main: undefined,
  sideboard: 'Sideboard{noDeck}{noPrice}',
  maybeboard: 'Maybeboard{noDeck}{noPrice}',
};
