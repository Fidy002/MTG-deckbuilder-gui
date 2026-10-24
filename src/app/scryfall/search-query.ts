const TOKEN = /(^|[\s(])(-?)("[^"]*"|[^\s()"]+)/g;
const KEYWORDS = new Set(['or', 'and']);

// Scryfall folds diacritics in plain name searches ("bär" also finds "Abartiger"), but regex searches keep them.
// Plain words and quoted phrases with non-ASCII letters therefore become regex searches on name and type.
export function preserveDiacritics(query: string): string {
  return query.replace(TOKEN, (match, prefix: string, negation: string, token: string) => {
    if (!/[^\x00-\x7f]/.test(token) || /[:=<>]/.test(token) || KEYWORDS.has(token.toLowerCase())) {
      return match;
    }
    const quoted = token.startsWith('"');
    const pattern = (quoted ? token.slice(1, -1) : token).replace(/[\\/^$.*+?()[\]{}|]/g, '\\$&');
    const search = quoted ? `name:/${pattern}/` : `(name:/${pattern}/ or t:/${pattern}/)`;
    return `${prefix}${negation}${search}`;
  });
}
