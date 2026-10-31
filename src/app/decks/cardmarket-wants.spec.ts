import { describe, expect, it } from 'vitest';
import { cardmarketWantsUrl, wantsListText } from './cardmarket-wants';

describe('wantsListText', () => {
  it('writes one line per card and adds up copies of the same name', () => {
    expect(
      wantsListText([
        { name: 'Sol Ring', count: 1 },
        { name: 'Lightning Bolt', count: 2 },
        { name: 'Lightning Bolt', count: 2 },
      ]),
    ).toBe('1 Sol Ring\n4 Lightning Bolt');
  });
});

describe('cardmarketWantsUrl', () => {
  it('opens the wants page in the UI language, falling back to English', () => {
    expect(cardmarketWantsUrl('de')).toBe('https://www.cardmarket.com/de/Magic/Wants');
    expect(cardmarketWantsUrl('ja')).toBe('https://www.cardmarket.com/en/Magic/Wants');
  });
});
