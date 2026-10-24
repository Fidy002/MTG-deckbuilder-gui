import { TestBed } from '@angular/core/testing';
import { DeckService, countCards, deckCoverEntry } from './deck.service';

describe('DeckService', () => {
  let service: DeckService;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(DeckService);
  });

  it('creates, renames and deletes decks', () => {
    const deck = service.create('Burn');
    expect(deck.legalityCheck).toBe(false);
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

  it('fills up an existing card even when another printing is added', () => {
    const deck = service.create('Bears');
    service.updateText(deck.id, '1 Grizzly Bears (M10) 180');
    service.addCard(deck.id, { name: 'Grizzly Bears', set: 'dmr', collectorNumber: '161' });
    expect(service.get(deck.id)?.text).toBe('2 Grizzly Bears (M10) 180');
  });

  it('merges several lines of the same card when another copy is added', () => {
    const deck = service.create('Bears');
    service.updateText(deck.id, '1 Grizzly Bears (M10) 180\n1 Forest\n2 Grizzly Bears (DMR) 161');
    service.addCard(deck.id, { name: 'Grizzly Bears', set: 'dmr', collectorNumber: '161' });
    expect(service.get(deck.id)?.text).toBe('1 Forest\n4 Grizzly Bears (DMR) 161');
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

  it('stores a deck language and resets it to auto', () => {
    const deck = service.create('Burn');
    service.setLanguage(deck.id, 'de');
    expect(service.get(deck.id)?.language).toBe('de');
    service.setLanguage(deck.id, undefined);
    expect(service.get(deck.id)?.language).toBeUndefined();
  });

  it('marks a card as commander and sets categories', () => {
    const deck = service.create('Goblins');
    service.updateText(deck.id, '1 Krenko, Mob Boss\n1 Sol Ring');
    service.updateEntry(deck.id, { count: 1, name: 'Krenko, Mob Boss', section: 'main' }, { section: 'commander' });
    service.updateEntry(deck.id, { count: 1, name: 'Sol Ring', section: 'main' }, { category: 'Ramp' });
    expect(service.get(deck.id)?.text).toBe('Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring [Ramp]');

    service.updateEntry(deck.id, { count: 1, name: 'Sol Ring', section: 'main', category: 'Ramp' }, { category: undefined });
    expect(service.get(deck.id)?.text).toBe('Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring');
  });

  it('changes the number of copies and removes a card at 0', () => {
    const deck = service.create('Burn');
    service.updateText(deck.id, '4 Lightning Bolt\n20 Mountain');
    const bolt = { count: 4, name: 'Lightning Bolt', section: 'main' as const };
    service.setCount(deck.id, bolt, 2);
    expect(service.get(deck.id)?.text).toBe('2 Lightning Bolt\n20 Mountain');
    service.setCount(deck.id, bolt, 0);
    expect(service.get(deck.id)?.text).toBe('20 Mountain');
  });

  it('counts played cards, without sideboard', () => {
    expect(countCards('4 Lightning Bolt\n2x Shock\n20 Mountain\n\nSideboard\n3 Duress')).toBe(26);
  });

  it('picks the cover card, then the commander, then the first card', () => {
    const text = 'Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Goblin Guide\n1 Shock';
    expect(deckCoverEntry({ text, coverCard: 'shock' })?.name).toBe('Shock');
    expect(deckCoverEntry({ text })?.name).toBe('Krenko, Mob Boss');
    expect(deckCoverEntry({ text: '1 Goblin Guide\n1 Shock' })?.name).toBe('Goblin Guide');
    expect(deckCoverEntry({ text: '' })).toBeUndefined();
  });
});
