import { ScryfallCard } from '../scryfall/scryfall.models';
import type { SuggestionRole } from './deck-suggestions';

export type AutoCategory = 'wipe' | 'counter' | 'removal' | 'tutor' | 'ramp' | 'draw';

// Checked in this order; the first match wins (e.g. a wrath that also draws is a wipe).
export const AUTO_CATEGORIES: readonly AutoCategory[] = ['wipe', 'counter', 'removal', 'tutor', 'ramp', 'draw'];

const RULES: Record<AutoCategory, RegExp[]> = {
  wipe: [
    /\b(destroy|exile) all (creatures|nonland permanents|permanents|other creatures|artifacts|enchantments)\b/,
    /\bdeals? (\d+|x) damage to each (creature|other creature)\b/,
    /\ball (other )?creatures get -(\d+|x)\/-(\d+|x)\b/,
    /\breturn all (nonland )?permanents to their owners' hands\b/,
  ],
  counter: [/\bcounter target\b/],
  removal: [
    /\b(destroy|exile) target (creature|permanent|nonland permanent|artifact|enchantment|planeswalker|attacking|blocking|tapped|nontoken|noncreature|creature or)/,
    /\bdeals? (\d+|x) damage to (any target|target creature|target planeswalker|target attacking|target creature or planeswalker)\b/,
    /\btarget creature (an opponent controls )?gets -(\d+|x)\/-(\d+|x)\b/,
    /\breturn target (creature|nonland permanent|permanent) to its owner's hand\b/,
    /\bfights? target creature\b/,
    /\bowner of target (nonland )?permanent\b/,
    /\bput target (creature|nonland permanent|permanent) on (the )?(top|bottom)\b/,
    /\b(target (player|opponent)|each opponent) sacrifices an? (creature|attacking creature|nonland permanent)\b/,
  ],
  tutor: [/\bsearch your library for (a|an|up to \w+) (?!basic land|land|forest|island|plains|swamp|mountain)\w*/],
  ramp: [
    /\badd \{/,
    /\badd (one|two|three|x) mana\b/,
    /\badd .*mana of any (one )?(color|type)\b/,
    /\bsearch your library for .*\blands?\b.*\bonto the battlefield\b/,
  ],
  draw: [/\bdraws? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|x|that many|\d+) (additional )?cards?\b/],
};

export function autoCategory(card: ScryfallCard): AutoCategory | undefined {
  const typeLine = (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').toLowerCase();
  if (typeLine.includes('land')) {
    return undefined;
  }
  const text = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '');
  return AUTO_CATEGORIES.find((category) => RULES[category].some((rule) => rule.test(text)));
}

// The suggestion roles whose cards can't be told apart by their type line.
const CATEGORY_ROLES: Partial<Record<AutoCategory, SuggestionRole>> = {
  ramp: 'ramp',
  draw: 'draw',
  removal: 'removal',
  wipe: 'wipes',
  tutor: 'tutors',
};

/** The suggestion role a card fills by its rules text (ramp, draw, removal, wipes, tutors), if any. */
export function categoryRole(card: ScryfallCard): SuggestionRole | undefined {
  const category = autoCategory(card);
  return category && CATEGORY_ROLES[category];
}
