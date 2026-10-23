import { TestBed } from '@angular/core/testing';
import { ManaText } from './mana-text';

describe('ManaText', () => {
  it('renders mana symbols as images and keeps the text around them', async () => {
    const fixture = TestBed.createComponent(ManaText);
    fixture.componentRef.setInput('text', '{T}: Add {W/U}{2}.');
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    const images = [...element.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    expect(images).toEqual([
      'https://svgs.scryfall.io/card-symbols/T.svg',
      'https://svgs.scryfall.io/card-symbols/WU.svg',
      'https://svgs.scryfall.io/card-symbols/2.svg',
    ]);
    expect(element.textContent).toBe(': Add .');
  });
});
