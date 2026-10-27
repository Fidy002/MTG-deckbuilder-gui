import { ScryfallCard } from '../scryfall/scryfall.models';
import { comboPartners, comboPiecesQuery, estimateBracket, missingComboPieces } from './deck-brackets';

const card = (name: string, oracle_text = '', game_changer = false) => ({ name, oracle_text, game_changer }) as unknown as ScryfallCard;

describe('estimateBracket', () => {
  it('starts at Core for plain decks and ignores land searches', () => {
    const result = estimateBracket([card('Grizzly Bears'), card('Cultivate', 'Search your library for up to two basic land cards'), card('Arid Mesa', 'Pay 1 life, Sacrifice Arid Mesa: Search your library for a Mountain or Plains card')]);
    expect(result.bracket).toBe(2);
    expect(result.tutors).toEqual([]);
  });

  it('counts Game Changers', () => {
    expect(estimateBracket([card('Sol Ring'), card('Rhystic Study', '', true)]).bracket).toBe(3);
    const many = ['A', 'B', 'C', 'D'].map((n) => card(n, '', true));
    expect(estimateBracket(many).bracket).toBe(4);
  });

  it('treats mass land denial as Optimized and finds extra turns and tutors', () => {
    expect(estimateBracket([card('Armageddon', 'Destroy all lands.')]).bracket).toBe(4);
    const result = estimateBracket([
      card('Time Warp', 'Target player takes an extra turn after this one.'),
      card('Temporal Manipulation', 'Target player takes an extra turn after this one.'),
      card('Diabolic Tutor', 'Search your library for a card, put that card into your hand, then shuffle.'),
    ]);
    expect(result.bracket).toBe(3);
    expect(result.extraTurns.length).toBe(2);
    expect(result.tutors).toEqual(['Diabolic Tutor']);
  });

  it('recognises cEDH decks and known combos', () => {
    const gameChangers = ['Demonic Tutor', 'Vampiric Tutor', 'Rhystic Study', 'Force of Will', 'Mana Vault', 'Chrome Mox'].map((n) =>
      card(n, '', true),
    );
    const fastMana = ['Mox Diamond', 'Lotus Petal'].map((n) => card(n));
    const combo = [card("Thassa's Oracle"), card('Demonic Consultation')];

    const cedh = estimateBracket([...gameChangers, ...fastMana, ...combo]);
    expect(cedh.bracket).toBe(5);
    expect(cedh.combos).toEqual(["Thassa's Oracle + Demonic Consultation"]);
    expect(cedh.fastMana).toEqual(['Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Lotus Petal']);

    expect(estimateBracket([...gameChangers, ...fastMana]).bracket).toBe(4);
    expect(estimateBracket(combo).bracket).toBe(4);
  });
});

describe('combo pieces', () => {
  it('finds the partners of a combo piece and searches all pieces', () => {
    expect(comboPartners("Thassa's Oracle")).toEqual(['Demonic Consultation', 'Tainted Pact', 'Doomsday', 'Hermit Druid']);
    expect(comboPartners('Sol Ring')).toEqual([]);
    expect(comboPiecesQuery()).toContain('!"Demonic Consultation"');
  });
});

describe('missingComboPieces', () => {
  it('finds the pieces still missing for a known win among the available cards', () => {
    expect(missingComboPieces(new Set(["Thassa's Oracle"]), new Set(['Demonic Consultation', 'Sol Ring']))).toEqual(['Demonic Consultation']);
    expect(missingComboPieces(new Set(), new Set(['Isochron Scepter', 'Dramatic Reversal']))).toEqual(['Isochron Scepter', 'Dramatic Reversal']);
    expect(missingComboPieces(new Set(['Isochron Scepter', 'Dramatic Reversal']), new Set())).toEqual([]);
    expect(missingComboPieces(new Set(['Sol Ring']), new Set(['Isochron Scepter']))).toBeUndefined();
  });
});
