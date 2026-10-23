import { deckGroupName } from './deck-group-names';

describe('deckGroupName', () => {
  it('uses the card language and falls back to English', () => {
    expect(deckGroupName('instant', 'de')).toBe('Spontanzauber');
    expect(deckGroupName('instant', 'fr')).toBe('Éphémères');
    expect(deckGroupName('instant', 'xx')).toBe('Instants');
  });
});
