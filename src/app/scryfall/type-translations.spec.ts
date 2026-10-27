import { preserveDiacritics } from './search-query';
import { germanTypeName, withEnglishTypes } from './type-translations';

describe('withEnglishTypes', () => {
  it('also searches the English type of German type words', () => {
    expect(withEnglishTypes('Drache')).toBe('(Drache or t:dragon)');
    expect(withEnglishTypes('drachen')).toBe('(drachen or t:dragon)');
    expect(withEnglishTypes('roter Drache')).toBe('roter (Drache or t:dragon)');
    expect(withEnglishTypes('Elfen Krieger')).toBe('(Elfen or t:elf) (Krieger or t:warrior)');
  });

  it('keeps other words, operators and negation sensible', () => {
    expect(withEnglishTypes('Smaug')).toBe('Smaug');
    expect(withEnglishTypes('t:dragon c:r')).toBe('t:dragon c:r');
    expect(withEnglishTypes('-drache')).toBe('-drache -t:dragon');
    expect(withEnglishTypes('drache or engel')).toBe('(drache or t:dragon) or (engel or t:angel)');
  });

  it('works together with the diacritics handling', () => {
    expect(preserveDiacritics(withEnglishTypes('bär'))).toBe('((name:/bär/ or t:/bär/) or t:bear)');
  });
});

describe('germanTypeName', () => {
  it('names English types in German', () => {
    expect(germanTypeName('Bear')).toBe('Bär');
    expect(germanTypeName('Ally')).toBe('Verbündeter');
    expect(germanTypeName('Wurm')).toBe('Lindwurm');
    expect(germanTypeName('Atog')).toBeUndefined();
  });
});
