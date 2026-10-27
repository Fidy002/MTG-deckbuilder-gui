import { ScryfallCard } from '../scryfall/scryfall.models';
import { filterQuery, matchesFilter } from './card-search';

describe('card search filters', () => {
  it('turns the color and land toggles into a Scryfall filter', () => {
    expect(filterQuery([], false)).toBe('');
    expect(filterQuery(['R', 'B'], false)).toBe('c<=rb -c:c');
    expect(filterQuery(['R', 'B', 'C'], false)).toBe('c<=rb');
    expect(filterQuery(['R', 'B', 'M'], false)).toBe('c<=rb c:m');
    expect(filterQuery(['R', 'C', 'M'], false)).toBe('c<=r (c:c or c:m)');
    expect(filterQuery(['C', 'M'], false)).toBe('(c:c or c:m)');
    expect(filterQuery(['M'], false)).toBe('c:m');
    expect(filterQuery([], true)).toBe('t:land');
    expect(filterQuery(['U', 'M'], true)).toBe('t:land (produces:u)');
  });
});

describe('local filter', () => {
  const card = (extra: Partial<ScryfallCard>) => ({ name: 'Card', ...extra }) as ScryfallCard;
  const bolt = card({ type_line: 'Instant', colors: ['R'] });
  const charm = card({ type_line: 'Instant', colors: ['R', 'W'] });
  const terminate = card({ type_line: 'Instant', colors: ['B', 'R'] });
  const doom = card({ type_line: 'Instant', colors: ['B'] });
  const rock = card({ type_line: 'Artifact', colors: [] });
  const land = card({ type_line: 'Land', colors: [], produced_mana: ['R', 'G'] });
  const all = [bolt, charm, terminate, doom, rock, land];
  const shown = (colors: Parameters<typeof matchesFilter>[1], lands = false) => all.filter((c) => matchesFilter(c, colors, lands));

  it('applies the same rules as the search filter', () => {
    expect(shown(['R'])).toEqual([bolt]);
    expect(shown(['R', 'B'])).toEqual([bolt, terminate, doom]);
    expect(shown(['R', 'B', 'C'])).toEqual([bolt, terminate, doom, rock, land]);
    expect(shown(['R', 'B', 'M'])).toEqual([terminate]);
    expect(shown(['M'])).toEqual([charm, terminate]);
    expect(shown(['C'])).toEqual([rock, land]);
    expect(shown(['G'], true)).toEqual([land]);
    expect(shown([])).toEqual(all);
  });
});
