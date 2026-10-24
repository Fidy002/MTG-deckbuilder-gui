import { preserveDiacritics } from './search-query';

describe('preserveDiacritics', () => {
  it('turns plain words with diacritics into regex searches on name and type', () => {
    expect(preserveDiacritics('bär')).toBe('(name:/bär/ or t:/bär/)');
    expect(preserveDiacritics('grüner bär')).toBe('(name:/grüner/ or t:/grüner/) (name:/bär/ or t:/bär/)');
  });

  it('keeps ASCII words, operators and keywords unchanged', () => {
    expect(preserveDiacritics('goblin t:creature c>=r or set:dom')).toBe('goblin t:creature c>=r or set:dom');
    expect(preserveDiacritics('o:zerstöre')).toBe('o:zerstöre');
  });

  it('handles quoted phrases, negation and parentheses', () => {
    expect(preserveDiacritics('"Königin der Bären"')).toBe('name:/Königin der Bären/');
    expect(preserveDiacritics('-bär')).toBe('-(name:/bär/ or t:/bär/)');
    expect(preserveDiacritics('(bär or elch)')).toBe('((name:/bär/ or t:/bär/) or elch)');
  });

  it('escapes regex characters', () => {
    expect(preserveDiacritics('bär.')).toBe('(name:/bär\\./ or t:/bär\\./)');
  });
});
