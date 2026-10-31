import { cardmarketProductUrl } from './card-prices.service';

describe('cardmarketProductUrl', () => {
  it('drops the referral parameters of Scryfall', () => {
    expect(
      cardmarketProductUrl(
        'https://www.cardmarket.com/en/Magic/Products?idProduct=559712&referrer=scryfall&utm_campaign=card_prices&utm_medium=text&utm_source=scryfall',
      ),
    ).toBe('https://www.cardmarket.com/en/Magic/Products?idProduct=559712');
  });

  it('leaves links it cannot read as they are', () => {
    expect(cardmarketProductUrl('not a url')).toBe('not a url');
  });
});
