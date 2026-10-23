
export interface ScryfallImageUris {
  small: string;
  normal: string;
  large: string;
  png: string;
  art_crop: string;
  border_crop: string;
}

export interface ScryfallCardFace {
  name: string;
  printed_name?: string;
  mana_cost?: string;
  type_line?: string;
  printed_type_line?: string;
  oracle_text?: string;
  printed_text?: string;
  image_uris?: ScryfallImageUris;
}

export type ScryfallRarity = 'common' | 'uncommon' | 'rare' | 'mythic' | 'special' | 'bonus';

export interface ScryfallCard {
  object: 'card';
  id: string;
  oracle_id?: string;
  name: string;
  printed_name?: string;
  lang: string;
  layout: string;
  set: string;
  set_name: string;
  collector_number: string;
  rarity: ScryfallRarity;
  cmc?: number;
  color_identity?: string[];
  mana_cost?: string;
  type_line?: string;
  printed_type_line?: string;
  oracle_text?: string;
  printed_text?: string;
  image_uris?: ScryfallImageUris;
  card_faces?: ScryfallCardFace[];
  scryfall_uri: string;
}

export interface ScryfallSet {
  object: 'set';
  code: string;
  name: string;
  set_type: string;
  released_at?: string;
  card_count: number;
  digital: boolean;
  icon_svg_uri: string;
}

export interface ScryfallList<T> {
  object: 'list';
  data: T[];
  has_more: boolean;
  next_page?: string;
  total_cards?: number;
}

export interface ScryfallError {
  object: 'error';
  code: string;
  status: number;
  details: string;
}

export interface CardSearchResult {
  cards: ScryfallCard[];
  totalCards: number;
  nextPage?: string;
  language: string;
  isFallback: boolean;
}

export interface CardFaceView {
  name: string;
  manaCost?: string;
  typeLine?: string;
  text?: string;
  image?: ScryfallImageUris;
}

export function cardFaces(card: ScryfallCard): CardFaceView[] {
  if (card.card_faces?.length) {
    return card.card_faces.map((face) => ({
      name: face.printed_name ?? face.name,
      manaCost: face.mana_cost,
      typeLine: face.printed_type_line ?? face.type_line,
      text: face.printed_text ?? face.oracle_text,
      image: face.image_uris ?? card.image_uris,
    }));
  }
  return [
    {
      name: card.printed_name ?? card.name,
      manaCost: card.mana_cost,
      typeLine: card.printed_type_line ?? card.type_line,
      text: card.printed_text ?? card.oracle_text,
      image: card.image_uris,
    },
  ];
}

export function cardDisplayName(card: ScryfallCard): string {
  if (card.printed_name) {
    return card.printed_name;
  }
  return card.card_faces?.length ? cardFaces(card).map((f) => f.name).join(' // ') : card.name;
}

const FULL_NAME_LAYOUTS = new Set(['split', 'aftermath']);

export function deckCardName(card: ScryfallCard): string {
  if (card.card_faces?.length && !FULL_NAME_LAYOUTS.has(card.layout)) {
    return card.card_faces[0].name;
  }
  return card.name;
}

export function cardNameVariants(card: ScryfallCard): string[] {
  const names = [card.name, card.printed_name];
  for (const face of card.card_faces ?? []) {
    names.push(face.name, face.printed_name);
  }
  return names.filter((n): n is string => !!n).map((n) => n.toLowerCase());
}

export function hasMultipleImages(card: ScryfallCard): boolean {
  return !card.image_uris && (card.card_faces?.filter((f) => f.image_uris).length ?? 0) > 1;
}

const SYMBOL_URL = 'https://svgs.scryfall.io/card-symbols';

export function manaSymbolUrl(symbol: string): string {
  return `${SYMBOL_URL}/${encodeURIComponent(symbol)}.svg`;
}

export const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;
