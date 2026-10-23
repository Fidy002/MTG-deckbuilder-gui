import { DECK_EXPORT_FORMATS } from './deck-formats';
import { DeckEntry, parseDecklist, serializeDecklist } from './decklist';

const exportAs = (id: string, entries: DeckEntry[]) => DECK_EXPORT_FORMATS.find((f) => f.id === id)!.export(entries);

describe('parseDecklist', () => {
  it('reads MTG Arena lists with sections and printings', () => {
    const entries = parseDecklist(
      'Commander\n1 Krenko, Mob Boss (M13) 141\n\nDeck\n4 Lightning Bolt (M10) 146\n10 Mountain\n\nSideboard\n2 Pyroblast',
    );
    expect(entries).toEqual([
      { count: 1, name: 'Krenko, Mob Boss', set: 'm13', collectorNumber: '141', section: 'commander' },
      { count: 4, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', section: 'main' },
      { count: 10, name: 'Mountain', section: 'main' },
      { count: 2, name: 'Pyroblast', section: 'sideboard' },
    ]);
  });

  it('reads Archidekt lines with categories, tags and foil markers', () => {
    const entries = parseDecklist(
      '1x Krenko, Mob Boss (m13) 141 [Commander{top}]\n4x Lightning Bolt (m10) 146 *F* [Burn] ^Have,#37d67a^\n1x Pyroblast [Sideboard{noDeck}{noPrice}]',
    );
    expect(entries).toEqual([
      { count: 1, name: 'Krenko, Mob Boss', set: 'm13', collectorNumber: '141', section: 'commander' },
      { count: 4, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', foil: true, category: 'Burn', section: 'main' },
      { count: 1, name: 'Pyroblast', section: 'sideboard' },
    ]);
  });

  it('treats a blank line as sideboard separator only on import (MTGO)', () => {
    const text = '4 Lightning Bolt\n\n2 Pyroblast';
    expect(parseDecklist(text, { blankLineStartsSideboard: true })[1].section).toBe('sideboard');
    expect(parseDecklist(text)[1].section).toBe('main');
  });

  it('understands "SB:" prefixes, "x" counts and lines without count', () => {
    expect(parseDecklist('2x Shock\nSB: 1 Duress\nFire // Ice')).toEqual([
      { count: 2, name: 'Shock', section: 'main' },
      { count: 1, name: 'Duress', section: 'sideboard' },
      { count: 1, name: 'Fire // Ice', section: 'main' },
    ]);
  });

  it('keeps custom categories but not Archidekt type categories', () => {
    expect(parseDecklist('1x Sol Ring (c21) 263 [Ramp]\n1x Shock [Instant]\n1x Krenko [Commander{top},Goblins]')).toEqual([
      { count: 1, name: 'Sol Ring', set: 'c21', collectorNumber: '263', category: 'Ramp', section: 'main' },
      { count: 1, name: 'Shock', section: 'main' },
      { count: 1, name: 'Krenko', category: 'Goblins', section: 'commander' },
    ]);
  });

  it('round-trips through the storage format', () => {
    const text = 'Commander\n1 Krenko, Mob Boss (M13) 141\n\nDeck\n4 Lightning Bolt (M10) 146 *F*';
    expect(serializeDecklist(parseDecklist(text))).toBe(text);
  });
});

describe('export formats', () => {
  const entries: DeckEntry[] = [
    { count: 1, name: 'Krenko, Mob Boss', set: 'm13', collectorNumber: '141', section: 'commander' },
    { count: 4, name: 'Lightning Bolt', set: 'm10', collectorNumber: '146', section: 'main' },
    { count: 2, name: 'Pyroblast', section: 'sideboard' },
  ];

  it('MTG Arena', () => {
    expect(exportAs('arena', entries)).toBe(
      'Commander\n1 Krenko, Mob Boss\n\nDeck\n4 Lightning Bolt\n\nSideboard\n2 Pyroblast',
    );
  });

  it('MTGO', () => {
    expect(exportAs('mtgo', entries)).toBe('4 Lightning Bolt\n\n1 Krenko, Mob Boss\n2 Pyroblast');
  });

  it('Moxfield', () => {
    expect(exportAs('moxfield', entries)).toBe(
      'Commander\n1 Krenko, Mob Boss (M13) 141\n\nDeck\n4 Lightning Bolt (M10) 146\n\nSideboard\n2 Pyroblast',
    );
  });

  it('Archidekt', () => {
    expect(exportAs('archidekt', entries)).toBe(
      '1x Krenko, Mob Boss (m13) 141 [Commander{top}]\n4x Lightning Bolt (m10) 146\n2x Pyroblast [Sideboard{noDeck}{noPrice}]',
    );
  });

  it('Archidekt keeps custom categories, other formats drop them', () => {
    const withCategory: DeckEntry[] = [{ count: 1, name: 'Sol Ring', category: 'Ramp', section: 'main' }];
    expect(exportAs('archidekt', withCategory)).toBe('1x Sol Ring [Ramp]');
    expect(exportAs('arena', withCategory)).toBe('Deck\n1 Sol Ring');
  });

  it('every export can be imported again', () => {
    for (const format of DECK_EXPORT_FORMATS) {
      const reimported = parseDecklist(format.export(entries), { blankLineStartsSideboard: true });
      expect(reimported.map((e) => [e.count, e.name]), format.id).toEqual(
        format.id === 'mtgo'
          ? [[4, 'Lightning Bolt'], [1, 'Krenko, Mob Boss'], [2, 'Pyroblast']]
          : entries.map((e) => [e.count, e.name]),
      );
    }
  });
});
