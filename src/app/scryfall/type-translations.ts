// German card types, supertypes and the common creature and other subtypes, with their English Oracle names.
// Scryfall only searches the English type line, so a German type word also searches its English type.
const GERMAN_TYPES: Record<string, string> = {
  // Card types and supertypes
  kreatur: 'creature',
  spontanzauber: 'instant',
  hexerei: 'sorcery',
  verzauberung: 'enchantment',
  artefakt: 'artifact',
  land: 'land',
  planeswalker: 'planeswalker',
  schlacht: 'battle',
  legendär: 'legendary',
  standard: 'basic',
  standardland: 'basic',
  schnee: 'snow',
  stamm: 'kindred',
  // Artifact, enchantment and land subtypes
  ausrüstung: 'equipment',
  fahrzeug: 'vehicle',
  aura: 'aura',
  fluch: 'curse',
  saga: 'saga',
  schatz: 'treasure',
  nahrung: 'food',
  hinweis: 'clue',
  wüste: 'desert',
  tor: 'gate',
  ebene: 'plains',
  insel: 'island',
  sumpf: 'swamp',
  gebirge: 'mountain',
  wald: 'forest',
  // Creature types
  drache: 'dragon',
  elf: 'elf',
  goblin: 'goblin',
  zombie: 'zombie',
  vampir: 'vampire',
  engel: 'angel',
  dämon: 'demon',
  teufel: 'devil',
  zauberer: 'wizard',
  krieger: 'warrior',
  soldat: 'soldier',
  ritter: 'knight',
  kleriker: 'cleric',
  schurke: 'rogue',
  druide: 'druid',
  schamane: 'shaman',
  mönch: 'monk',
  barbar: 'barbarian',
  berserker: 'berserker',
  pirat: 'pirate',
  ninja: 'ninja',
  samurai: 'samurai',
  assassine: 'assassin',
  söldner: 'mercenary',
  adliger: 'noble',
  bürger: 'citizen',
  bauer: 'peasant',
  späher: 'scout',
  handwerker: 'artificer',
  hexenmeister: 'warlock',
  mensch: 'human',
  meervolk: 'merfolk',
  zwerg: 'dwarf',
  riese: 'giant',
  oger: 'ogre',
  ork: 'orc',
  troll: 'troll',
  minotaurus: 'minotaur',
  zentaur: 'centaur',
  satyr: 'satyr',
  sphinx: 'sphinx',
  hydra: 'hydra',
  wyrm: 'wyrm',
  lindwurm: 'wurm',
  wurm: 'wurm',
  dinosaurier: 'dinosaur',
  bestie: 'beast',
  elementarwesen: 'elemental',
  geist: 'spirit',
  schrecken: 'horror',
  avatar: 'avatar',
  gott: 'god',
  golem: 'golem',
  konstrukt: 'construct',
  myr: 'myr',
  thopter: 'thopter',
  eldrazi: 'eldrazi',
  phyrexianer: 'phyrexian',
  sliver: 'sliver',
  vogel: 'bird',
  katze: 'cat',
  hund: 'dog',
  wolf: 'wolf',
  werwolf: 'werewolf',
  bär: 'bear',
  frosch: 'frog',
  ratte: 'rat',
  maus: 'mouse',
  eichhörnchen: 'squirrel',
  kaninchen: 'rabbit',
  otter: 'otter',
  fledermaus: 'bat',
  eidechse: 'lizard',
  schlange: 'snake',
  spinne: 'spider',
  insekt: 'insect',
  fisch: 'fish',
  krake: 'kraken',
  oktopus: 'octopus',
  schildkröte: 'turtle',
  krokodil: 'crocodile',
  pferd: 'horse',
  einhorn: 'unicorn',
  elefant: 'elephant',
  affe: 'ape',
  echse: 'lizard',
  wal: 'whale',
  hai: 'shark',
  baumvolk: 'treefolk',
  pflanze: 'plant',
  pilzling: 'fungus',
  pilz: 'fungus',
  saprobier: 'saproling',
  schleim: 'ooze',
  skelett: 'skeleton',
  gespenst: 'specter',
  schatten: 'shade',
  gargoyle: 'gargoyle',
  greif: 'griffin',
  phönix: 'phoenix',
  wächter: 'sentinel',
  mauer: 'wall',
  illusion: 'illusion',
  gestaltwandler: 'shapeshifter',
  verbündeter: 'ally',
};

// English Oracle type -> German name; the first German word of a type wins (e.g. Lindwurm for Wurm).
const GERMAN_NAMES = new Map<string, string>();
for (const [german, english] of Object.entries(GERMAN_TYPES)) {
  if (!GERMAN_NAMES.has(english)) {
    GERMAN_NAMES.set(english, german.charAt(0).toUpperCase() + german.slice(1));
  }
}

/** The German name of an English type such as "Bear" (Bär), or undefined if it is not known. */
export function germanTypeName(english: string): string | undefined {
  return GERMAN_NAMES.get(english.toLowerCase());
}

const TOKEN = /(^|[\s(])(-?)([^\s()":=<>]+)(?=$|[\s)])/g;
const KEYWORDS = new Set(['or', 'and']);

function englishType(word: string): string | undefined {
  const lower = word.toLowerCase();
  // Plural and inflected forms: "Drachen", "Elfen", "Krieger", "Ritter", "Engeln".
  const forms = [lower, ...['n', 'en', 'e', 's', 'nen', 'er', 'ern'].filter((end) => lower.endsWith(end)).map((end) => lower.slice(0, -end.length))];
  return forms.map((form) => GERMAN_TYPES[form]).find(Boolean);
}

/** German type words also search their English type, e.g. "Drache" becomes "(Drache or t:dragon)". */
export function withEnglishTypes(query: string): string {
  return query.replace(TOKEN, (match, prefix: string, negation: string, word: string) => {
    if (KEYWORDS.has(word.toLowerCase())) {
      return match;
    }
    const english = englishType(word);
    if (!english) {
      return match;
    }
    return negation ? `${prefix}-${word} -t:${english}` : `${prefix}(${word} or t:${english})`;
  });
}
