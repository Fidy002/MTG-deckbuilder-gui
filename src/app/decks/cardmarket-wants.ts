const CARDMARKET_LANGUAGES = new Set(['en', 'de', 'fr', 'es', 'it']);

/** Cardmarket's decklist field reads one "count English name" per line. */
export function wantsListText(cards: readonly { name: string; count: number }[]): string {
  const counts = new Map<string, number>();
  for (const { name, count } of cards) {
    counts.set(name, (counts.get(name) ?? 0) + count);
  }
  return [...counts].map(([name, count]) => `${count} ${name}`).join('\n');
}

export function cardmarketWantsUrl(language: string): string {
  const site = CARDMARKET_LANGUAGES.has(language) ? language : 'en';
  return `https://www.cardmarket.com/${site}/Magic/Wants`;
}
