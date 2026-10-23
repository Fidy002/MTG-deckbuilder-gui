import { TestBed } from '@angular/core/testing';
import { DeckService, countCards } from './deck.service';

describe('DeckService', () => {
  let service: DeckService;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(DeckService);
  });

  it('creates, renames and deletes decks', () => {
    const deck = service.create('Burn');
    service.rename(deck.id, 'Mono Red Burn');
    expect(service.get(deck.id)?.name).toBe('Mono Red Burn');

    service.delete(deck.id);
    expect(service.decks()).toEqual([]);
  });

  it('increments existing lines when adding a card', () => {
    const deck = service.create('Burn');
    service.updateText(deck.id, '3 Lightning Bolt\n20 Mountain');
    service.addCard(deck.id, { name: 'lightning bolt' });
    service.addCard(deck.id, { name: 'Lava Spike', set: 'm10', collectorNumber: '140' });
    expect(service.get(deck.id)?.text).toBe('4 Lightning Bolt\n20 Mountain\n1 Lava Spike (M10) 140');
  });

  it('adds cards to the main deck, not the sideboard', () => {
    const deck = service.create('Burn');
    service.updateText(deck.id, 'Deck\n4 Lightning Bolt\n\nSideboard\n2 Pyroblast');
    service.addCard(deck.id, { name: 'Shock' });
    expect(service.get(deck.id)?.text).toBe('Deck\n4 Lightning Bolt\n1 Shock\n\nSideboard\n2 Pyroblast');
  });

  it('persists decks in localStorage as text', () => {
    const deck = service.create('Burn');
    service.updateText(deck.id, '4 Lightning Bolt');
    TestBed.tick();
    const stored = JSON.parse(localStorage.getItem('mtg-deckbuilder.decks')!);
    expect(stored[0]).toMatchObject({ name: 'Burn', text: '4 Lightning Bolt' });
  });

  it('counts played cards, without sideboard', () => {
    expect(countCards('4 Lightning Bolt\n2x Shock\n20 Mountain\n\nSideboard\n3 Duress')).toBe(26);
  });
});
