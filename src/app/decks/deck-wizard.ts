import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, firstValueFrom, forkJoin, map, of, switchMap } from 'rxjs';
import { I18nService, TranslationKey, TranslationParams } from '../i18n/i18n.service';
import { TranslatePipe } from '../i18n/translate.pipe';
import { Badge, CardBadges, suggestionBadges } from '../shared/card-badges/card-badges';
import { COLOR_ORDER, ScryfallCard, cardDisplayName, cardFaces, deckCardName, manaSymbolUrl } from '../scryfall/scryfall.models';
import { SettingsService } from '../settings/settings.service';
import { CardSearch } from '../cards/card-search';
import { DeckOverview, flashAdded } from './deck-overview';
import { CardHover } from '../shared/card-hover/card-hover';
import { CardHoverOverlay } from '../shared/card-hover/card-hover-overlay.service';
import { BRACKETS, Bracket, comboPartners, comboPiecesQuery, missingComboPieces } from './deck-brackets';
import { DeckCardsService, cardKey, withImages } from './deck-cards.service';
import { CONSTRUCTED_FORMATS, canBeCommander } from './deck-legality';
import {
  COMMANDER_LANDS,
  CONSTRUCTED_LANDS,
  CommanderFit,
  DeckSuggestions,
  PLAY_STYLES,
  PlayStyle,
  RoleQuery,
  SuggestionGroup,
  SuggestionOptions,
  SuggestionRole,
  basicLandName,
  bestCommander,
  deckCreatureTypes,
  manaPips,
  recommendColors,
  ColorAdvice,
  pickCommanders,
  preferredSets,
  splitBasics,
  POPULAR_TYPES,
  hasCreatureType,
} from './deck-suggestions';
import { categoryRole } from './auto-categories';
import { CardRating, cardEffects, cardScore, fitsStyle, recommendStyle, cardSynergies, commanderSynergies, roleSynergies } from './deck-synergies';
import { STYLE_CURVES, STYLE_CURVE_MAX, manaCurve, pickAlongCurve } from './deck-curve';
import { ManaCurve } from './mana-curve';
import { WinPlan, WinconId, cardWincons, planFinishers, recommendPlan, winconQueries } from './deck-wincons';
import { Deck, DeckService } from './deck.service';
import { DeckEntry, DeckFormat, parseDecklist, serializeDecklist, detectFormat } from './decklist';
import { ScryfallService } from '../scryfall/scryfall.service';
import { germanTypeName } from '../scryfall/type-translations';

type Step = 'format' | 'level' | 'cards' | 'style' | 'colors' | 'commander' | 'suggestions';

const COMMANDER_STEPS: readonly Step[] = ['format', 'cards', 'style', 'level', 'commander', 'suggestions'];
const CONSTRUCTED_STEPS: readonly Step[] = ['format', 'cards', 'style', 'level', 'colors', 'suggestions'];

// Play styles that usually need Game Changers or tutors, which the lower brackets leave out.
const STYLE_MIN_BRACKET: Partial<Record<PlayStyle, Bracket>> = { combo: 3, bigMana: 3 };

const POPULAR_THEMES = POPULAR_TYPES;
const MAX_THEME_MATCHES = 8;
const MIN_DECK_TYPES = 3;
// Card types that also work as a deck theme (artifact creatures, cards that care about artifacts); not in Scryfall's creature type catalog.
const THEME_CARD_TYPES = ['Artifact', 'Enchantment'];

const RECOMMENDED_BRACKET: Bracket = 2;
const COMMANDER_SIZE = 100;
const CONSTRUCTED_SIZE = 60;
const CONSTRUCTED_COPIES = 4;
// "Other suggestions" after cards were taken in a step shows at least this many, not only what the step still misses.
const MIN_OTHER_SUGGESTIONS = 8;
const COMMANDER_OPTIONS = 18;
const COMMANDER_PIP_WEIGHT = 3;
const PLAN_MAIN_SCORE = 2.5;
const PLAN_BACKUP_SCORE = 1.5;
const MAX_QUOTE = 140;
const MIN_COLOR_SHARE = 0.1;
const MAX_COLOR_SHARES = 3;

interface Reason {
  key: TranslationKey;
  params?: TranslationParams;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

interface OwnedCard {
  entry: DeckEntry;
  card?: ScryfallCard;
}

@Component({
  selector: 'app-deck-wizard',
  host: { '(document:keydown.escape)': 'showOutside.set(false); showGameChangers.set(false)' },
  imports: [NgTemplateOutlet, TranslatePipe, RouterLink, CardBadges, CardHover, CardSearch, DeckOverview, ManaCurve],
  templateUrl: './deck-wizard.html',
  styleUrl: './deck-wizard.scss',
})
export class DeckWizard {
  private readonly deckService = inject(DeckService);
  private readonly deckCards = inject(DeckCardsService);
  private readonly suggestionsService = inject(DeckSuggestions);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly hoverOverlay = inject(CardHoverOverlay);

  // Building on an existing deck (/decks/:id/wizard): its cards are the own cards, and the result updates that deck.
  protected readonly editing = signal<Deck | undefined>(undefined);

  constructor() {
    effect(() => {
      const group = this.currentGroup();
      if (this.step() === 'suggestions' && group && !this.loadedRoles().has(group.role) && !this.loadingRole()) {
        untracked(() => this.loadGroup(group.role));
      }
    });
    const deck =this.deckService.get(this.route.snapshot.paramMap.get('id') ?? '');
    if (!deck) {
      return;
    }
    this.editing.set(deck);
    this.format.set(deck.format ?? detectFormat(parseDecklist(deck.text)));
    if (deck.bracket) {
      this.bracket.set(deck.bracket);
    }
    if (deck.legalityFormat) {
      this.legalityFormat.set(deck.legalityFormat);
    }
    this.ownedText.set(deck.text);
    this.step.set('cards');
  }
  private readonly scryfall = inject(ScryfallService);

  protected readonly manaSymbolUrl = manaSymbolUrl;
  protected readonly brackets = BRACKETS;
  protected readonly constructedFormats = CONSTRUCTED_FORMATS;
  protected readonly colorOrder = COLOR_ORDER;

  protected readonly format = signal<DeckFormat>('commander');
  protected readonly bracket = signal<Bracket>(RECOMMENDED_BRACKET);
  protected readonly recommendedBracket = RECOMMENDED_BRACKET;
  protected readonly levels = BRACKETS.map((b) => b.value);
  protected readonly legalityFormat = signal(CONSTRUCTED_FORMATS[0].id);
  protected readonly ownedText = signal('');
  protected readonly owned = signal<OwnedCard[]>([]);
  protected readonly colors = signal<string[]>([]);
  protected readonly ownedColors = signal<string[]>([]);
  private readonly commanderPool = signal<ScryfallCard[]>([]);
  private readonly shownCommanders = new Set<string>();
  private readonly commanderFit = signal<CommanderFit>({ colors: [] });
  protected readonly commanderOptions = signal<ScryfallCard[]>([]);
  protected readonly commander = signal<ScryfallCard | undefined>(undefined);
  protected readonly commanderPicked = signal(false);
  protected readonly groups = signal<SuggestionGroup[]>([]);
  // The taken suggestions by name, each with the one role group it was taken in.
  protected readonly selected = signal(new Map<string, SuggestionRole>());
  protected readonly groupIndex = signal(0);
  protected readonly style = signal<PlayStyle>('midrange');
  protected readonly themes = signal<string[]>([]);
  protected readonly themeQuery = signal('');
  protected readonly themeActive = signal(0);
  protected readonly themeOpen = signal(false);
  protected readonly playStyles = PLAY_STYLES;
  protected readonly catalog = toSignal(this.scryfall.creatureTypes$.pipe(catchError(() => of([] as string[]))), {
    initialValue: [] as string[],
  });
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);

  protected readonly step = signal<Step>('format');
  protected readonly steps = computed(() => (this.format() === 'commander' ? COMMANDER_STEPS : CONSTRUCTED_STEPS));
  protected readonly stepIndex = computed(() => this.steps().indexOf(this.step()));

  protected readonly preferredSets = computed(() =>
    preferredSets(
      this.owned().map((o) => ({ set: o.entry.set ?? o.card?.set, basic: !!o.card?.type_line?.startsWith('Basic') })),
    ),
  );

  protected readonly notFound = computed(() => this.owned().filter((o) => !o.card).map((o) => o.entry.name));
  protected readonly ownedCount = computed(() => this.owned().reduce((sum, o) => sum + o.entry.count, 0));

  // Legendary creatures among the own cards come first; Scryfall's most played commanders follow.
  protected readonly ownedCommanders = computed(() =>
    this.owned().flatMap((o) => (o.card && canBeCommander(o.card, false) ? [o.card] : [])),
  );

  private readonly ownedCards = computed(() => this.owned().flatMap((o) => (o.card ? [o.card] : [])));

  // Types for the search dropdown, matched on the shown and the English name; names starting with the query come first.
  protected readonly themeMatches = computed(() => {
    const query = this.themeQuery().trim().toLowerCase();
    if (!query) {
      return [];
    }
    const chosen = new Set(this.themes());
    const matches = [...THEME_CARD_TYPES, ...this.catalog()]
      .filter((t) => !chosen.has(t))
      .map((type) => ({ type, names: [this.typeName(type).toLowerCase(), type.toLowerCase()] }))
      .filter(({ names }) => names.some((n) => n.includes(query)));
    const starts = ({ names }: { names: string[] }) => (names.some((n) => n.startsWith(query)) ? 0 : 1);
    return matches
      .sort((a, b) => starts(a) - starts(b) || a.names[0].localeCompare(b.names[0]))
      .slice(0, MAX_THEME_MATCHES)
      .map((m) => m.type);
  });

  protected readonly visibleGroups = this.groups;
  private suggestionOptions?: SuggestionOptions;
  private ownedGameChangers = 0;
  private readonly roleQueries = signal<RoleQuery[]>([]);
  private readonly loadingRole = signal<SuggestionRole | undefined>(undefined);
  private readonly loadedRoles = signal(new Set<SuggestionRole>());
  private readonly shown = signal(new Map<SuggestionRole, string[]>());
  private readonly seen = new Map<SuggestionRole, Set<string>>();
  protected readonly currentGroup = computed(() => this.visibleGroups()[this.groupIndex()]);
  protected readonly onBasics = computed(() => this.groupIndex() === this.visibleGroups().length);
  protected readonly lastGroup = computed(() => this.onBasics());
  protected readonly roleStepCount = computed(() => this.visibleGroups().length + 1);
  protected readonly deckComplete = computed(() => this.deckTotal() >= this.deckSize());
  protected readonly nextRoleLabel = computed<TranslationKey>(() => {
    const next = this.visibleGroups()[this.groupIndex() + 1];
    return next ? this.roleLabel(next.role) : 'wizard.basicLands';
  });

  protected copiesFor(group: SuggestionGroup): number {
    return this.format() === 'commander' || group.role === 'lands' ? 1 : CONSTRUCTED_COPIES;
  }

  protected specialsIn(group: SuggestionGroup): number {
    return this.takenIn(group).length * this.copiesFor(group);
  }

  protected selectedIn(group: SuggestionGroup): number {
    return this.specialsIn(group);
  }

  protected readonly basicCards = signal(new Map<string, ScryfallCard>());
  private readonly basicCounts = signal<Record<string, number> | undefined>(undefined);
  protected readonly basicColors = computed(() => (this.colors().length ? this.colors() : ['C']));
  private readonly landsGroup = computed(() => this.groups().find((g) => g.role === 'lands'));

  private readonly landTarget = computed(() => (this.format() === 'commander' ? COMMANDER_LANDS : CONSTRUCTED_LANDS));

  protected readonly basicCountParams = computed(() => {
    const group = this.landsGroup();
    return {
      target: this.landTarget(),
      owned: group?.owned ?? 0,
      specials: group ? this.specialsIn(group) : 0,
      count: this.recommendedBasicCount(),
    };
  });

  protected readonly recommendedBasicCount = computed(() => {
    const group = this.landsGroup();
    const missing = this.landTarget() - (group?.owned ?? 0) - (group ? this.specialsIn(group) : 0);
    return Math.max(0, Math.min(missing, this.deckSize() - this.nonBasicTotal()));
  });

  private readonly pips = computed(() => {
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const isLand = (card: ScryfallCard) => (card.type_line ?? '').includes('Land');
    const owned = this.owned().flatMap((o) => (o.card && !isLand(o.card) ? Array(o.entry.count).fill(this.manaCost(o.card)) : []));
    const suggested = this.groups()
      .filter((g) => g.role !== 'lands')
      .flatMap((g) => this.takenIn(g).flatMap((c) => Array(this.copiesFor(g)).fill(this.manaCost(c))));
    const commanderCost = commander ? Array(COMMANDER_PIP_WEIGHT).fill(this.manaCost(commander)) : [];
    return manaPips([...owned, ...suggested, ...commanderCost]);
  });

  private readonly recommendedBasics = computed(() => splitBasics(this.colors(), this.pips(), this.recommendedBasicCount()));
  protected readonly shownBasics = computed(() => this.basicCounts() ?? this.recommendedBasics());
  protected readonly basicsChanged = computed(() => !!this.basicCounts());
  protected readonly basicTotal = computed(() => Object.values(this.shownBasics()).reduce((sum, n) => sum + n, 0));

  protected readonly basicTip = computed(() => {
    const recommended = this.recommendedBasics();
    const pips = this.pips();
    const totalPips = this.colors().reduce((sum, c) => sum + (pips[c] ?? 0), 0);
    const split = this.basicColors()
      .map((c) => `${recommended[c] ?? 0}× ${this.basicName(c)}`)
      .join(', ');
    if (!this.colors().length) {
      return this.i18n.translate('wizard.basicTipColorless', { split });
    }
    if (this.colors().length === 1 || !totalPips) {
      return this.i18n.translate(this.colors().length === 1 ? 'wizard.basicTipMono' : 'wizard.basicTipEven', { split });
    }
    const shares = this.colors()
      .map((c) => `${Math.round(((pips[c] ?? 0) / totalPips) * 100)} % ${this.i18n.translate(`wizard.colorShare.${c as 'W'}`)}`)
      .join(', ');
    return this.i18n.translate('wizard.basicTip', { split, shares });
  });

  protected basicName(color: string): string {
    const card = this.basicCards().get(color);
    return card ? this.name(card) : basicLandName(color);
  }

  protected changeBasic(color: string, delta: number): void {
    const counts = { ...this.shownBasics() };
    counts[color] = Math.max(0, (counts[color] ?? 0) + delta);
    this.basicCounts.set(counts);
  }

  protected resetBasics(): void {
    this.basicCounts.set(undefined);
  }

  private manaCost(card: ScryfallCard): string {
    return card.mana_cost || (card.card_faces ?? []).map((f) => f.mana_cost ?? '').join('');
  }

  private readonly nonBasicTotal = computed(() => {
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const owned = this.owned()
      .filter((o) => !commander || o.card?.name !== commander.name)
      .reduce((sum, o) => sum + o.entry.count, 0);
    return (commander ? 1 : 0) + owned + this.visibleGroups().reduce((sum, g) => sum + this.specialsIn(g), 0);
  });

  protected readonly deckTotal = computed(() => this.nonBasicTotal() + this.basicTotal());

  protected readonly deckSize = computed(() => (this.format() === 'commander' ? COMMANDER_SIZE : CONSTRUCTED_SIZE));

  protected readonly countReasons = computed((): Reason[] => {
    const group = this.currentGroup();
    if (!group) {
      return [];
    }
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const commanderName = commander ? this.name(commander) : '';
    const style = this.i18n.translate(this.styleLabel(this.style()));
    const recommended = group.recommended ?? 0;
    if (group.role === 'lands') {
      return [{ key: 'wizard.reason.lands', params: { count: this.landTarget(), owned: group.owned ?? 0, picks: recommended } }];
    }
    if (group.role === 'tutors') {
      return [{ key: 'wizard.reason.tutors', params: { bracket: this.bracket(), count: recommended } }];
    }
    if (group.role !== 'creatures') {
      return [{ key: 'wizard.reason.roleStyle', params: { style, count: recommended } }];
    }
    const reasons: Reason[] = [];
    for (const factor of group.factors ?? []) {
      const delta = signed(factor.delta);
      if (factor.kind === 'style') {
        reasons.push({ key: 'wizard.reason.style', params: { style, count: factor.delta } });
      } else if (factor.kind === 'creatureSynergy') {
        reasons.push({ key: 'wizard.reason.creatureSynergy', params: { commander: commanderName, match: this.quote(commander, factor.match), delta } });
      } else if (factor.kind === 'spellSynergy') {
        reasons.push({ key: 'wizard.reason.spellSynergy', params: { commander: commanderName, match: this.quote(commander, factor.match), delta } });
      } else if (factor.kind === 'space') {
        reasons.push({ key: 'wizard.reason.space', params: { delta } });
      } else if (factor.kind === 'styleMax') {
        reasons.push({ key: 'wizard.reason.styleMax', params: { style, delta } });
      } else {
        reasons.push({ key: 'wizard.reason.types', params: { types: this.typeList(group.types ?? []), delta } });
      }
    }
    if (commander && !(group.factors ?? []).some((f) => f.kind === 'creatureSynergy' || f.kind === 'spellSynergy')) {
      reasons.push({ key: 'wizard.reason.commanderNeutral', params: { commander: commanderName } });
    }
    if (group.owned) {
      reasons.push({ key: 'wizard.reason.owned', params: { count: group.owned, missing: Math.max(0, recommended - group.owned) } });
    }
    return reasons;
  });

  private readonly deckTypesShown = computed(() => this.groups().find((g) => g.role === 'creatures')?.types ?? []);

  private readonly synergyIds = computed(() =>
    commanderSynergies(this.format() === 'commander' ? this.commander() : undefined, this.deckTypesShown()),
  );

  protected readonly tips = computed((): Reason[] => {
    const group = this.currentGroup();
    if (!group) {
      return [];
    }
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const params = { commander: commander ? this.name(commander) : '', types: this.typeList(this.deckTypesShown()) };
    const tips: Reason[] = roleSynergies(this.synergyIds(), group.role).map((id) => ({ key: `wizard.tip.${id}`, params }));
    const plan = this.plan();
    if (plan && group.role === 'creatures') {
      tips.push({ key: `wizard.planCreatures.${plan.main}`, params });
    }
    const status = this.planStatus();
    if (status && group.role === 'theme') {
      const tip = (id: WinconId) => this.i18n.translate(this.winconTip(id), { commander: '' });
      tips.push({ key: 'wizard.planMainTip', params: { plan: status.label, tip: tip(status.main) } });
      if (status.backup && status.backupLabel) {
        tips.push({ key: 'wizard.planBackupTip', params: { plan: status.backupLabel, tip: tip(status.backup) } });
      }
      tips.push({
        key: status.count < status.target ? 'wizard.planThin' : 'wizard.planReady',
        params: { count: status.count, target: status.target, plan: status.label },
      });
    }

    if (this.power() >= 4 && group.role !== 'lands') {
      tips.push({ key: 'wizard.powerTip', params: { bracket: this.bracket() } });
    }
    const style = this.style();
    tips.push({
      key:
        group.role === 'creatures' || group.role === 'wipes' || group.role === 'theme'
          ? `wizard.roleTip.${group.role}.${style}`
          : `wizard.roleTip.${group.role}`,
    });
    return tips;
  });

  private ratingsFor(group: SuggestionGroup | undefined): Map<string, CardRating> {
    const map = new Map<string, CardRating>();
    if (!group) {
      return map;
    }
    const ids = roleSynergies(this.synergyIds(), group.role);
    for (const card of group.cards) {
      map.set(card.name, {
        synergies: cardSynergies(card, ids, this.deckTypesShown()),
        effects: cardEffects(card, group.role, this.colors()),
      });
    }
    return map;
  }

  private readonly ratings = computed(() => this.ratingsFor(this.currentGroup()));

  protected readonly groupCards = computed(() => {
    const group = this.currentGroup();
    if (!group) {
      return [];
    }
    const byName = new Map(group.cards.map((c) => [c.name, c]));
    return (this.shown().get(group.role) ?? []).flatMap((name) => {
      const card = byName.get(name);
      return card && !this.isSelected(card) ? [card] : [];
    });
  });

  protected readonly groupLoading = computed(() => {
    const group = this.currentGroup();
    return !!group && (this.loadingRole() === group.role || !this.loadedRoles().has(group.role));
  });

  protected badges(card: ScryfallCard): Badge[] {
    const rating = this.ratings().get(card.name);
    const commander = this.commander();
    const plan = this.plan();
    return rating
      ? suggestionBadges(this.i18n, {
          rating,
          plans: this.cardPlans(card),
          deckPlans: [plan?.main, plan?.backup],
          commanderName: commander && this.name(commander),
          gameChanger: card.game_changer,
          style: fitsStyle(card, this.style()) ? this.style() : undefined,
          role: this.currentGroup()?.role,
        })
      : [];
  }

  private bestPicks(group: SuggestionGroup, open: readonly ScryfallCard[], needed: number): ScryfallCard[] {
    const ratings = this.ratingsFor(group);
    const empty: CardRating = { synergies: [], effects: [] };
    const scored = open.map((card, index) => ({
      card,
      score:
        cardScore(card, ratings.get(card.name) ?? empty, group.role, this.style(), index, open.length, this.power()) +
        this.planScore(card),
    }));
    // The picks fill the gaps of the mana curve one by one. A chosen theme is a must: the creatures are of its types,
    // others only when there are not enough of them.
    const along = (candidates: typeof scored, count: number) =>
      pickAlongCurve(candidates, count, this.curve(), this.curveTarget(), this.nonLandTarget(), this.copiesFor(group)).map((p) => p.card);
    const themes = group.role === 'creatures' ? this.themes() : [];
    const themed = scored.filter((s) => hasCreatureType(s.card, themes));
    const picks = !themes.length
      ? along(scored, needed)
      : themed.length >= needed
        ? along(themed, needed)
        : [...themed.map((s) => s.card), ...along(scored.filter((s) => !themed.includes(s)), needed - themed.length)];
    // The finishers keep one slot for the backup plan.
    const backup = this.plan()?.backup;
    if (group.role === 'theme' && backup && picks.length >= 2 && !picks.some((card) => this.cardPlans(card).includes(backup))) {
      const fallback = scored.filter((s) => this.cardPlans(s.card).includes(backup) && !picks.includes(s.card)).sort((a, b) => b.score - a.score)[0];
      if (fallback) {
        picks[picks.length - 1] = fallback.card;
      }
    }
    // From Optimized on, the deck gets a known two-card win: the pieces it misses take the first slots.
    if (group.role === 'theme' && this.power() >= 4) {
      const commander = this.commander();
      const have = new Set([...this.owned().flatMap((o) => (o.card ? [o.card.name] : [])), ...this.selected().keys(), ...(commander ? [commander.name] : [])]);
      const missing = missingComboPieces(have, new Set(open.map((c) => c.name))) ?? [];
      for (const piece of missing.flatMap((name) => open.filter((c) => c.name.toLowerCase() === name.toLowerCase()))) {
        if (!picks.includes(piece)) {
          picks.splice(picks.length - 1, 1);
          picks.unshift(piece);
        }
      }
    }
    // A combo piece only wins with its partner: the partners among the candidates take the last slots.
    if (group.role === 'theme') {
      for (const partner of picks.flatMap((card) => comboPartners(card.name)).flatMap((name) => open.filter((c) => c.name === name))) {
        if (!picks.includes(partner)) {
          picks.splice(picks.length - 1, 1);
          picks.unshift(partner);
        }
      }
    }
    return picks;
  }

  // Suggestions are shown as many as the role still needs (at least the minimum), the best candidates first.
  private async drawSuggestions(role: SuggestionRole, fresh: boolean, minimum = 0): Promise<void> {
    const group = this.groups().find((g) => g.role === role);
    if (!group) {
      return;
    }
    const needed = Math.max(minimum, (group.picks ?? 0) - this.takenIn(group).length);
    const seen = fresh ? new Set<string>() : (this.seen.get(role) ?? new Set<string>());
    // A card shown or taken in another group is never suggested a second time.
    const elsewhere = new Set([...this.shown()].filter(([r]) => r !== role).flatMap(([, names]) => names));
    const unselected = group.cards.filter((c) => !this.isSelected(c) && !elsewhere.has(c.name));
    let open = unselected.filter((c) => !seen.has(c.name));
    if (open.length < needed) {
      const current = new Set(this.shown().get(role) ?? []);
      seen.clear();
      current.forEach((name) => seen.add(name));
      open = unselected.filter((c) => !current.has(c.name));
      if (open.length < needed) {
        open = unselected;
      }
    }
    const picks = this.bestPicks(group, open, needed);
    picks.forEach((card) => seen.add(card.name));
    this.seen.set(role, seen);
    const localized = new Map((await this.localize(picks)).map((card) => [card.name, card]));
    this.groups.update((groups) =>
      groups.map((g) => (g.role === role ? { ...g, cards: g.cards.map((c) => localized.get(c.name) ?? c) } : g)),
    );
    this.shown.update((shown) => new Map(shown).set(role, picks.map((c) => c.name)));
  }

  private async loadGroup(role: SuggestionRole): Promise<void> {
    const query = this.roleQueries().find((r) => r.role === role);
    const options = this.suggestionOptions;
    if (!query || !options) {
      return;
    }
    this.loadingRole.set(role);
    this.failed.set(false);
    try {
      const others = [...this.shown()].filter(([r]) => r !== role).flatMap(([, names]) => names);
      const gameChangers =
        this.ownedGameChangers + this.groups().flatMap((g) => this.takenIn(g).filter((c) => c.game_changer)).length;
      const group = await firstValueFrom(
        this.suggestionsService.group(query, { ...options, exclude: [...options.exclude, ...this.selected().keys(), ...others] }, gameChangers),
      );
      this.groups.update((groups) => groups.map((g) => (g.role === role ? group : g)));
      await this.drawSuggestions(role, true);
    } catch {
      this.failed.set(true);
    } finally {
      this.loadedRoles.update((roles) => new Set(roles).add(role));
      this.loadingRole.set(undefined);
    }
  }

  protected async otherSuggestions(): Promise<void> {
    const group = this.currentGroup();
    if (!group || this.loadingRole()) {
      return;
    }
    if (!group.cards.length) {
      this.loadedRoles.update((roles) => new Set([...roles].filter((r) => r !== group.role)));
      return;
    }
    this.loadingRole.set(group.role);
    try {
      await this.drawSuggestions(group.role, false, this.takenIn(group).length ? MIN_OTHER_SUGGESTIONS : 0);
    } catch {
      this.failed.set(true);
    } finally {
      this.loadingRole.set(undefined);
    }
  }

  protected take(card: ScryfallCard): void {
    this.hoverOverlay.hide();
    this.slideIntoGap(card);
    const role = this.currentGroup()?.role;
    if (role) {
      this.selected.update((names) => new Map(names).set(card.name, role));
    }
    this.announce(card);
  }

  protected takeAll(): void {
    const cards = this.groupCards();
    this.hoverOverlay.hide();
    for (const card of cards) {
      this.hoverOverlay.spawnEmbers(this.suggestionTile(card.name)?.getBoundingClientRect() ?? new DOMRect());
    }
    const role = this.currentGroup()?.role;
    if (role) {
      this.selected.update((names) => new Map([...names, ...cards.map((c) => [c.name, role] as const)]));
    }
    cards.forEach((card) => this.announce(card));
  }

  private announce(card: ScryfallCard): void {
    const entry = this.printing(card);
    this.deckCards.remember(entry, this.settings.cardLanguage(), card);
    flashAdded(this.host.nativeElement, cardKey(entry));
  }

  private suggestionTiles(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('.suggestion-cards .pick[data-name]')];
  }

  private suggestionTile(name: string): HTMLElement | undefined {
    return this.suggestionTiles().find((tile) => tile.dataset['name'] === name);
  }

  private slideIntoGap(card: ScryfallCard): void {
    const before = new Map(this.suggestionTiles().map((tile) => [tile.dataset['name'], tile.getBoundingClientRect()]));
    const removed = before.get(card.name);
    if (removed) {
      this.hoverOverlay.spawnEmbers(removed);
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const duration = parseFloat(getComputedStyle(this.host.nativeElement).getPropertyValue('--card-slide-duration')) || 500;
    afterNextRender(
      () => {
        for (const tile of this.suggestionTiles()) {
          const old = before.get(tile.dataset['name']);
          const now = tile.getBoundingClientRect();
          if (old && (old.left !== now.left || old.top !== now.top)) {
            tile.animate([{ transform: `translate(${old.left - now.left}px, ${old.top - now.top}px)` }, { transform: 'none' }], {
              duration,
              easing: 'ease-in-out',
            });
          }
        }
      },
      { injector: this.injector },
    );
  }

  // The overview below the suggestions: only the cards of the current step, or the whole deck so far.
  protected readonly overviewAll = signal(false);

  protected readonly sectionEntries = computed((): DeckEntry[] => {
    const group = this.currentGroup();
    const all = this.overviewAll();
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const fits = (card: ScryfallCard) => all || this.fitsRole(card, group?.role);
    const owned = this.owned().flatMap((o) => (o.card && o.card.name !== commander?.name && fits(o.card) ? [{ ...o.entry, section: 'main' as const }] : []));
    const taken = this.groups().flatMap((g) =>
      this.takenIn(g)
        .filter((c) => all || g.role === group?.role || fits(c))
        .map((c): DeckEntry => ({ count: this.copiesFor(g), ...this.printing(c), section: 'main' })),
    );
    const basics =
      group && !all
        ? []
        : Object.entries(this.shownBasics()).flatMap(([color, count]): DeckEntry[] => (count > 0 ? [{ count, name: basicLandName(color), section: 'main' }] : []));
    const head: DeckEntry[] = all && commander ? [{ count: 1, name: deckCardName(commander), section: 'commander' }] : [];
    return [...head, ...owned, ...taken, ...basics];
  });

  // Whether an own card fills a step: the type line for creatures and lands, the rules text for the other roles;
  // no role means the basic lands.
  private fitsRole(card: ScryfallCard, role: SuggestionRole | undefined): boolean {
    const type = card.type_line ?? '';
    switch (role) {
      case undefined:
        return type.includes('Basic');
      case 'creatures':
        return type.includes('Creature');
      case 'lands':
        return type.includes('Land') && !type.includes('Basic');
      case 'theme':
        return !type.includes('Land') && fitsStyle(card, this.style());
      default:
        return categoryRole(card) === role;
    }
  }

  // Cards of a step in the deck so far: the own ones that fill it plus the suggestions taken in it (copies included).
  protected roleCount(group: SuggestionGroup): number {
    const commander = this.commander();
    const owned = this.owned()
      .filter((o) => o.card && o.card.name !== commander?.name && this.fitsRole(o.card, group.role))
      .reduce((sum, o) => sum + o.entry.count, 0);
    return owned + this.specialsIn(group);
  }

  // Card names, texts and types follow the card language; quotes and type names use it only when it matches the UI language.
  private usesCardLanguage(card: ScryfallCard | undefined): boolean {
    return !!card?.lang && card.lang === this.i18n.language();
  }

  private readonly typeNames = computed(() => {
    const names = new Map<string, string>();
    const commander = this.commander();
    const cards = [...this.ownedCards(), ...(commander ? [commander] : []), ...this.commanderOptions(), ...this.groups().flatMap((g) => g.cards)];
    for (const card of cards.filter((c) => this.usesCardLanguage(c))) {
      for (const face of [card, ...(card.card_faces ?? [])]) {
        const english = (face.type_line ?? '').split('—')[1]?.trim().split(/\s+/) ?? [];
        const printed = face.printed_type_line?.split('—')[1]?.trim() ?? '';
        const local = printed.split(printed.includes(',') ? /\s*,\s*/ : /\s+/).filter(Boolean);
        if (english.length && english.length === local.length) {
          english.forEach((type, i) => names.set(type, local[i]));
        }
      }
    }
    return names;
  });

  protected typeName(type: string): string {
    const known = this.typeNames().get(type);
    if (known) {
      return known;
    }
    if ((POPULAR_THEMES as readonly string[]).includes(type)) {
      return this.i18n.translate(`wizard.creatureType.${type as (typeof POPULAR_THEMES)[number]}`);
    }
    return (this.i18n.language() === 'de' && germanTypeName(type)) || type;
  }

  private typeList(types: readonly string[]): string {
    return types.map((type) => this.typeName(type)).join(', ');
  }

  // The quoted ability in the card language: the printed text has the same lines as the Oracle text.
  private quote(card: ScryfallCard | undefined, match: string | undefined): string {
    if (!match || !card || !this.usesCardLanguage(card)) {
      return match ?? '';
    }
    const oracle = [card.oracle_text, ...(card.card_faces ?? []).map((f) => f.oracle_text)].filter(Boolean).join('\n').split('\n');
    const printed = [card.printed_text, ...(card.card_faces ?? []).map((f) => f.printed_text)].filter(Boolean).join('\n').split('\n');
    const index = oracle.findIndex((line) => line.includes(match.replace(/…$/, '')));
    const line = oracle.length === printed.length && index >= 0 ? printed[index].replace(/\.$/, '') : match;
    return line.length > MAX_QUOTE ? `${line.slice(0, MAX_QUOTE - 1).trimEnd()}…` : line;
  }

  // How the deck wins, recognised from the commander, its abilities and the play style – shown as a tip.
  protected readonly plan = signal<WinPlan | undefined>(undefined);

  // The finishers of the main plan so far: commander, own cards and the selected suggestions.
  protected readonly planStatus = computed(() => {
    const plan = this.plan();
    if (!plan) {
      return undefined;
    }
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const selected = this.groups().flatMap((g) => this.takenIn(g));
    const cards = [...new Map([...(commander ? [commander] : []), ...this.ownedCards(), ...selected].map((c) => [c.name, c])).values()];
    const finishers = cards.filter((c) => this.cardPlans(c).includes(plan.main));
    const target = planFinishers(plan.main, this.format() === 'commander');
    return {
      main: plan.main,
      backup: plan.backup,
      label: this.winconLabel(plan.main),
      backupLabel: plan.backup ? this.winconLabel(plan.backup) : undefined,
      count: finishers.length,
      target,
    };
  });

  // What a card wins with: its rules text, and the plan searches (Scryfall's tags) that found it among the style cards.
  private cardPlans(card: ScryfallCard): WinconId[] {
    const plan = this.plan();
    const searched = [plan?.main, plan?.backup];
    const found = this.groups().find((g) => g.role === 'theme')?.sources?.[card.name] ?? [];
    return [...new Set([...cardWincons(card), ...found.flatMap((i) => searched[i] ?? [])])];
  }

  protected winconTip(id: WinconId): TranslationKey {
    return `wizard.winconTip.${id}`;
  }

  protected winconLabel(id: WinconId): string {
    return this.i18n.translate(`wizard.wincon.${id}`);
  }

  private planScore(card: ScryfallCard): number {
    const plan = this.plan();
    const brings = this.cardPlans(card);
    return (plan && brings.includes(plan.main) ? PLAN_MAIN_SCORE : 0) + (plan?.backup && brings.includes(plan.backup) ? PLAN_BACKUP_SCORE : 0);
  }

  // The mana curve of the deck so far (own cards without the commander, plus the selected suggestions) and its target.
  protected readonly curve = computed(() => {
    const commander = this.format() === 'commander' ? this.commander() : undefined;
    const owned = this.owned().flatMap((o) => (o.card && o.card.name !== commander?.name ? [{ card: o.card, count: o.entry.count }] : []));
    const selected = this.groups().flatMap((g) => this.takenIn(g).map((card) => ({ card, count: this.copiesFor(g) })));
    return manaCurve([...owned, ...selected]);
  });
  protected readonly curveTarget = computed(() => STYLE_CURVES[this.style()]);
  protected readonly nonLandTarget = computed(
    () => this.deckSize() - this.landTarget() - (this.format() === 'commander' && this.commander() ? 1 : 0),
  );

  protected readonly styleCurveMax = STYLE_CURVE_MAX;

  protected styleCurve(style: PlayStyle): readonly number[] {
    return STYLE_CURVES[style];
  }

  protected styleLabel(style: PlayStyle): TranslationKey {
    return `wizard.style.${style}`;
  }

  protected styleHint(style: PlayStyle): TranslationKey {
    return `wizard.styleHint.${style}`;
  }

  protected toggleTheme(type: string): void {
    this.themes.update((themes) => (themes.includes(type) ? themes.filter((t) => t !== type) : [...themes, type]));
  }

  protected onThemeInput(event: Event): void {
    this.themeQuery.set((event.target as HTMLInputElement).value);
    this.themeActive.set(0);
  }

  protected pickTheme(type: string, input: HTMLInputElement): void {
    this.toggleTheme(type);
    this.themeQuery.set('');
    input.value = '';
    input.focus();
  }

  // Arrow keys move through the dropdown, Enter takes the marked type, Escape closes it; Backspace in an empty field drops the last type.
  protected onThemeKey(event: KeyboardEvent, input: HTMLInputElement): void {
    const matches = this.themeMatches();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.themeActive.set(matches.length ? (this.themeActive() + step + matches.length) % matches.length : 0);
    } else if (event.key === 'Enter' && matches.length) {
      event.preventDefault();
      this.pickTheme(matches[Math.min(this.themeActive(), matches.length - 1)], input);
    } else if (event.key === 'Escape' && this.themeQuery()) {
      event.stopPropagation();
      this.themeQuery.set('');
      input.value = '';
    } else if (event.key === 'Backspace' && !input.value && this.themes().length) {
      this.themes.update((themes) => themes.slice(0, -1));
    }
  }

  private deckTypes(commander: ScryfallCard | undefined): string[] {
    const derived = deckCreatureTypes(commander, this.ownedCards(), this.catalog());
    const themes = this.themes();
    return [...themes, ...derived.filter((t) => !themes.includes(t))].slice(0, Math.max(MIN_DECK_TYPES, themes.length));
  }

  protected stepLabel(step: Step): TranslationKey {
    return step === 'level' ? (this.format() === 'commander' ? 'wizard.stepBracket' : 'wizard.stepFormatLegality') : `wizard.step.${step}`;
  }

  protected roleLabel(role: SuggestionRole): TranslationKey {
    return role === 'theme' ? `wizard.themeRole.${this.style()}` : `wizard.role.${role}`;
  }

  protected isCasual(bracket: Bracket): boolean {
    return bracket <= RECOMMENDED_BRACKET;
  }

  protected bracketNameKey(bracket: Bracket): TranslationKey {
    return `bracket.name${bracket}`;
  }

  protected bracketTaglineKey(bracket: Bracket): TranslationKey {
    return `bracket.tagline${bracket}`;
  }

  protected image(card: ScryfallCard): string | undefined {
    return cardFaces(card)[0]?.image?.normal;
  }

  protected largeImage(card: ScryfallCard): string | undefined {
    return cardFaces(card)[0]?.image?.large;
  }

  protected name(card: ScryfallCard): string {
    return cardDisplayName(card);
  }

  protected identityOf(card: ScryfallCard): string[] {
    return COLOR_ORDER.filter((c) => card.color_identity?.includes(c));
  }

  protected coversOwnedColors(card: ScryfallCard): boolean {
    return this.ownedColors().every((c) => card.color_identity?.includes(c));
  }

  protected readonly outsideIdentity = computed(() => {
    const commander = this.commander();
    if (!commander) {
      return [];
    }
    const allowed = new Set(commander.color_identity ?? []);
    return this.owned().filter(
      (o) => o.card && o.card.name !== commander.name && !(o.card.color_identity ?? []).every((c) => allowed.has(c)),
    );
  });

  protected readonly showOutside = signal(false);

  protected costSymbols(card: ScryfallCard): string[] {
    const cost = card.mana_cost || card.card_faces?.[0]?.mana_cost || '';
    const symbols = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1].replace('/', ''));
    return symbols.length ? symbols : this.identityOf(card);
  }

  protected cardKeyOf(owned: OwnedCard): string {
    return cardKey(owned.entry);
  }

  protected removeOutsideIdentity(): void {
    this.showOutside.set(false);
    const keys = new Set(this.outsideIdentity().map((o) => cardKey(o.entry)));
    this.owned.update((owned) => owned.filter((o) => !keys.has(cardKey(o.entry))));
    this.ownedText.set(serializeDecklist(parseDecklist(this.ownedText()).filter((e) => !keys.has(cardKey(e)))));
    const identity = new Set(this.owned().flatMap((o) => o.card?.color_identity ?? []));
    this.ownedColors.set(COLOR_ORDER.filter((c) => identity.has(c)));
  }

  protected chooseFormat(format: DeckFormat): void {
    this.format.set(format);
  }

  protected back(): void {
    const index = this.stepIndex();
    if (index > 0) {
      this.step.set(this.steps()[index - 1]);
    }
  }

  protected toggleColor(color: string): void {
    this.colors.update((colors) =>
      colors.includes(color) ? colors.filter((c) => c !== color) : COLOR_ORDER.filter((c) => c === color || colors.includes(c)),
    );
  }

  protected nextGroup(): void {
    this.groupIndex.update((i) => Math.min(i + 1, this.visibleGroups().length));
  }

  protected previousGroup(): void {
    this.groupIndex.update((i) => Math.max(i - 1, 0));
  }

  protected isSelected(card: ScryfallCard): boolean {
    return this.selected().has(card.name);
  }

  // The cards taken in this group; a card that is also in another group's pool counts only where it was taken.
  private takenIn(group: SuggestionGroup): ScryfallCard[] {
    return group.cards.filter((c) => this.selected().get(c.name) === group.role);
  }

  protected readonly lastAdded = signal<string | undefined>(undefined);
  protected readonly ownedView = signal<'overview' | 'text'>('overview');
  protected readonly ownedEntries = computed(() => parseDecklist(this.ownedText()));
  private readonly ownedIdentityEntries = computed(() =>
    this.ownedEntries().filter((e) => e.section !== 'maybeboard' && e.section !== 'sideboard'),
  );
  protected readonly ownedIdentity = toSignal(
    toObservable(this.ownedIdentityEntries).pipe(
      debounceTime(400),
      switchMap((entries) =>
        entries.length
          ? this.deckCards.resolve(entries, this.settings.cardLanguage()).pipe(
              map((resolved) => {
                const identity = new Set(entries.flatMap((e) => resolved.get(cardKey(e))?.card.color_identity ?? []));
                return COLOR_ORDER.filter((c) => identity.has(c));
              }),
              catchError(() => of(undefined)),
            )
          : of(undefined),
      ),
    ),
  );
  protected readonly cardLanguage = this.settings.cardLanguage;
  protected readonly deckSort = this.settings.deckSort;

  // Cards picked in the search end up in the text list, so both ways can be mixed and edited.
  protected readonly removingOwned = signal(false);

  protected removeOwned(entry: DeckEntry): void {
    const entries = parseDecklist(this.ownedText()).filter((e) => !(cardKey(e) === cardKey(entry) && e.section === entry.section));
    this.ownedText.set(serializeDecklist(entries));
    this.lastAdded.set(undefined);
    if (!entries.length) {
      this.removingOwned.set(false);
    }
  }

  protected readonly ownedNames = computed(() => new Set(this.ownedEntries().map((e) => e.name.toLowerCase())));

  // Clicking a search result selects it as an own card, clicking it again removes it.
  protected toggleOwned(card: ScryfallCard): void {
    const entry = { name: deckCardName(card), set: card.set, collectorNumber: card.collector_number };
    const entries = parseDecklist(this.ownedText());
    const same = (e: DeckEntry) => e.name.toLowerCase() === entry.name.toLowerCase();
    if (entries.some(same)) {
      this.ownedText.set(serializeDecklist(entries.filter((e) => !same(e))));
      this.lastAdded.set(undefined);
      return;
    }
    this.deckCards.remember(entry, this.settings.cardLanguage(), card);
    entries.push({ ...entry, count: 1, section: 'main' });
    this.ownedText.set(serializeDecklist(entries));
    this.lastAdded.set(cardDisplayName(card));
    flashAdded(this.host.nativeElement, cardKey(entry));
  }

  protected onOwnedInput(event: Event): void {
    this.ownedText.set((event.target as HTMLTextAreaElement).value);
  }

  protected async submitCards(): Promise<void> {
    await this.run(async () => {
      const entries = parseDecklist(this.ownedText()).filter((e) => e.section !== 'maybeboard' && e.section !== 'sideboard');
      const resolved = entries.length
        ? await firstValueFrom(this.deckCards.resolve(entries, this.settings.cardLanguage()))
        : new Map<string, never>();
      const owned = entries.map((entry): OwnedCard => {
        return { entry, card: resolved.get(cardKey(entry))?.card };
      });
      this.owned.set(owned);
      const identity = new Set(owned.flatMap((o) => o.card?.color_identity ?? []));
      this.ownedColors.set(COLOR_ORDER.filter((c) => identity.has(c)));
      this.colors.set(this.ownedColors());
      if (this.format() === 'commander') {
        const listed = owned.find((o) => o.entry.section === 'commander' && o.card)?.card;
        this.commander.set(listed);
        this.commanderPicked.set(!!listed);
      }
      const advice = this.styleAdvice();
      if (advice && !this.stylePicked()) {
        this.style.set(advice.style as PlayStyle);
      }
      this.step.set('style');
    });
  }

  protected submitStyle(): void {
    this.step.set('level');
  }

  // The play style the own cards point to; preselected until the user picks one.
  protected readonly styleAdvice = computed(() => recommendStyle(this.ownedCards()));
  private readonly stylePicked = signal(false);

  protected pickStyle(style: PlayStyle): void {
    this.style.set(style);
    this.stylePicked.set(true);
  }

  // Brackets only apply to commander decks.
  private readonly power = computed(() => (this.format() === 'commander' ? this.bracket() : 0));

  // The official Game Changer list, loaded from Scryfall when first opened so it is always current.
  protected readonly showGameChangers = signal(false);
  protected readonly gameChangers = signal<ScryfallCard[] | undefined>(undefined);
  protected readonly gameChangersFailed = signal(false);

  protected async openGameChangers(): Promise<void> {
    this.showGameChangers.set(true);
    if (this.gameChangers()) {
      return;
    }
    this.gameChangersFailed.set(false);
    try {
      const cards = await firstValueFrom(this.scryfall.findPopularCards('is:gamechanger'));
      const localized = await this.localize(cards);
      this.gameChangers.set(localized.sort((a, b) => this.name(a).localeCompare(this.name(b))));
    } catch {
      this.gameChangersFailed.set(true);
    }
  }

  protected pickBracket(bracket: Bracket): void {
    this.bracket.set(bracket);
  }

  protected readonly styleMinBracket = computed(() => STYLE_MIN_BRACKET[this.style()]);

  protected styleBracketReason(): TranslationKey {
    return `wizard.bracketReason.${this.style() as 'combo'}`;
  }

  protected async submitLevel(): Promise<void> {
    await this.run(async () => {
      if (this.format() === 'commander') {
        const style = this.style();
        this.commanderFit.set({
          colors: this.colors(),
          creatureTypes: this.deckTypes(undefined),
          preferredSets: this.preferredSets(),
          style: (card) => fitsStyle(card, style),
        });
        this.shownCommanders.clear();
        this.commanderPool.set(await firstValueFrom(this.suggestionsService.commanders(this.commanderFit(), this.bracket())));
        if (!this.commanderPicked()) {
          await this.suggestCommander();
        }
        await this.drawCommanders();
        this.step.set('commander');
      } else {
        const themeColors = await this.themeColors();
        const advice = recommendColors(this.ownedPips(), themeColors, this.style());
        this.colorAdvice.set(advice);
        this.colors.set(advice.colors);
        this.step.set('colors');
      }
    });
  }

  // Color counts of the popular creatures of all chosen theme types together.
  private async themeColors(): Promise<Record<string, number>> {
    const themes = this.themes();
    if (!themes.length) {
      return {};
    }
    const all = await firstValueFrom(
      forkJoin(themes.map((type) => this.suggestionsService.typeColors(type).pipe(catchError(() => of({} as Record<string, number>))))),
    );
    const counts: Record<string, number> = {};
    for (const [color, count] of all.flatMap((c) => Object.entries(c))) {
      counts[color] = (counts[color] ?? 0) + count;
    }
    return counts;
  }

  protected readonly colorAdvice = signal<ColorAdvice | undefined>(undefined);

  protected readonly colorReasons = computed((): Reason[] => {
    const advice = this.colorAdvice();
    if (!advice) {
      return [];
    }
    const shares = (values: Record<string, number>) =>
      COLOR_ORDER.filter((c) => (values[c] ?? 0) >= MIN_COLOR_SHARE)
        .sort((a, b) => (values[b] ?? 0) - (values[a] ?? 0))
        .slice(0, MAX_COLOR_SHARES)
        .map((c) => `${Math.round((values[c] ?? 0) * 100)} % ${this.i18n.translate(`wizard.colorShare.${c as 'W'}`)}`)
        .join(', ');
    const reasons: Reason[] = [];
    if (Object.keys(advice.owned).length) {
      reasons.push({ key: 'wizard.colorReason.owned', params: { shares: shares(advice.owned) } });
    }
    const themes = this.themes();
    if (themes.length && Object.keys(advice.theme).length) {
      reasons.push({ key: 'wizard.colorReason.theme', params: { theme: this.typeList(themes), shares: shares(advice.theme) } });
    }
    reasons.push({ key: `wizard.colorReason.style.${this.style()}`, params: { style: this.i18n.translate(this.styleLabel(this.style())) } });
    return reasons;
  });

  protected readonly colorsMatchAdvice = computed(() => {
    const advice = this.colorAdvice();
    return !advice || advice.colors.join('') === this.colors().join('');
  });

  protected useColorAdvice(): void {
    const advice = this.colorAdvice();
    if (advice) {
      this.colors.set(advice.colors);
    }
  }

  private ownedPips(): Record<string, number> {
    return manaPips(
      this.owned().flatMap((o) => (o.card && !(o.card.type_line ?? '').includes('Land') ? Array(o.entry.count).fill(this.manaCost(o.card)) : [])),
    );
  }

  // Clicking selects (or deselects) the commander; the suggestions only load on "next".
  protected selectCommander(card: ScryfallCard): void {
    this.commander.set(this.commander()?.name === card.name ? undefined : card);
    this.commanderPicked.set(true);
  }

  private async suggestCommander(): Promise<void> {
    const best = bestCommander(this.ownedCommanders(), this.commanderPool(), this.commanderFit());
    const owned = this.ownedCommanders().some((c) => c.name === best?.name);
    this.commander.set(best && !owned ? (await this.localize([best]))[0] : best);
  }

  protected readonly commanderOwned = computed(() => this.ownedCommanders().some((c) => c.name === this.commander()?.name));

  protected async shuffleCommanders(): Promise<void> {
    await this.run(() => this.drawCommanders());
  }

  private async drawCommanders(): Promise<void> {
    const ownedNames = new Set(this.ownedCommanders().map((c) => c.name));
    const selected = this.commander();
    const keep = selected && !ownedNames.has(selected.name) ? selected : undefined;
    const count = COMMANDER_OPTIONS - (keep ? 1 : 0);
    const pool = this.commanderPool().filter((c) => !ownedNames.has(c.name) && c.name !== keep?.name);
    let unseen = pool.filter((c) => !this.shownCommanders.has(c.name));
    if (unseen.length < count) {
      this.shownCommanders.clear();
      unseen = pool;
    }
    const picked = pickCommanders(unseen, count, this.commanderFit());
    picked.forEach((c) => this.shownCommanders.add(c.name));
    this.commanderOptions.set([...(keep ? [keep] : []), ...(await this.localize(picked))]);
  }

  protected async continueWithCommander(card: ScryfallCard | undefined): Promise<void> {
    this.commander.set(card);
    this.colors.set(card ? COLOR_ORDER.filter((c) => card.color_identity?.includes(c)) : this.ownedColors());
    await this.loadSuggestions();
  }

  protected async loadSuggestions(): Promise<void> {
    await this.run(async () => {
      const ownedCards = this.ownedCards();
      const commander = this.format() === 'commander' ? this.commander() : undefined;
      const rest = this.owned().filter((o) => !commander || o.card?.name !== commander.name);
      const countOf = (type: string) => rest.filter((o) => o.card?.type_line?.includes(type)).reduce((sum, o) => sum + o.entry.count, 0);
      this.plan.set(recommendPlan(this.style(), commanderSynergies(commander, this.deckTypes(commander)), commander));
      const plan = this.plan();
      const options: SuggestionOptions = {
        format: this.format() === 'commander' ? 'commander' : this.legalityFormat(),
        colors: this.colors(),
        bracket: this.format() === 'commander' ? this.bracket() : undefined,
        exclude: [...ownedCards.map((c) => c.name), ...(commander ? [commander.name] : [])],
        style: this.style(),
        commander,
        ownedCreatures: countOf('Creature'),
        ownedLands: countOf('Land'),
        creatureTypes: this.deckTypes(commander),
        themeTypes: this.themes(),
        preferredSets: this.preferredSets(),
        planQueries: [
          ...(plan ? winconQueries([plan.main, ...(plan.backup ? [plan.backup] : [])]) : []),
          ...(this.power() >= 4 ? [comboPiecesQuery()] : []),
        ],
      };
      this.suggestionOptions = options;
      this.ownedGameChangers = ownedCards.filter((c) => c.game_changer).length;
      const roles = this.suggestionsService.roles(options);
      this.roleQueries.set(roles);
      this.groups.set(roles.map((role) => this.suggestionsService.outline(role, options)));
      this.loadedRoles.set(new Set());
      this.shown.set(new Map());
      this.seen.clear();
      this.selected.set(new Map());
      this.groupIndex.set(0);
      this.basicCounts.set(undefined);
      await this.loadBasicCards();
      this.step.set('suggestions');
    });
  }

  protected create(): void {
    const editing = this.editing();
    if (editing) {
      this.updateDeck(editing);
      return;
    }
    const commanderDeck = this.format() === 'commander';
    const commander = commanderDeck ? this.commander() : undefined;
    const entries: DeckEntry[] = [];
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (commander) {
      entries.push({ count: 1, name: deckCardName(commander), section: 'commander' });
    }
    for (const { entry } of this.owned()) {
      if (commander && entry.name.toLowerCase() === deckCardName(commander).toLowerCase()) {
        continue;
      }
      entries.push({ ...entry, section: 'main' });
    }
    for (const group of this.groups()) {
      for (const card of this.takenIn(group)) {
        if (!entries.some((e) => same(e.name, deckCardName(card)))) {
          const copies = commanderDeck || group.role === 'lands' ? 1 : CONSTRUCTED_COPIES;
          entries.push({ count: copies, ...this.printing(card), section: 'main' });
        }
      }
    }

    for (const [color, count] of Object.entries(this.shownBasics())) {
      if (count > 0) {
        entries.push({ count, name: basicLandName(color), section: 'main' });
      }
    }

    const name = commander ? cardDisplayName(commander) : this.i18n.translate('decks.defaultName');
    const deck = this.deckService.create(name, serializeDecklist(entries), this.format());
    this.deckService.setThemes(deck.id, this.themes());
    this.deckService.setStyle(deck.id, this.style());
    if (commanderDeck) {
      this.deckService.setBracket(deck.id, this.bracket());
    } else {
      this.deckService.setLegalityFormat(deck.id, this.legalityFormat());
    }
    this.router.navigate(['/decks', deck.id]);
  }

  // Adds the selected suggestions and basic lands to the existing deck; its own lines (sideboard, categories) stay.
  private updateDeck(deck: Deck): void {
    const commanderDeck = this.format() === 'commander';
    const commander = commanderDeck ? this.commander() : undefined;
    const entries = parseDecklist(deck.text);
    const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
    if (commander && !entries.some((e) => e.section === 'commander')) {
      const name = deckCardName(commander);
      const rest = entries.filter((e) => !(e.section === 'main' && same(e.name, name)));
      entries.splice(0, entries.length, { count: 1, name, section: 'commander' }, ...rest);
    }
    for (const group of this.groups()) {
      for (const card of this.takenIn(group)) {
        if (!entries.some((e) => same(e.name, deckCardName(card)))) {
          const copies = commanderDeck || group.role === 'lands' ? 1 : CONSTRUCTED_COPIES;
          entries.push({ count: copies, ...this.printing(card), section: 'main' });
        }
      }
    }
    for (const [color, count] of Object.entries(this.shownBasics())) {
      const name = basicLandName(color);
      const existing = entries.find((e) => e.section === 'main' && same(e.name, name));
      if (existing) {
        existing.count += count;
      } else if (count > 0) {
        entries.push({ count, name, section: 'main' });
      }
    }
    this.deckService.updateText(deck.id, serializeDecklist(entries));
    this.deckService.setFormat(deck.id, this.format());
    this.deckService.setThemes(deck.id, this.themes());
    this.deckService.setStyle(deck.id, this.style());
    if (commanderDeck) {
      this.deckService.setBracket(deck.id, this.bracket());
    } else {
      this.deckService.setLegalityFormat(deck.id, this.legalityFormat());
    }
    this.router.navigate(['/decks', deck.id]);
  }

  protected createEmpty(): void {
    const deck = this.deckService.create(this.i18n.translate('decks.defaultName'), '', this.format());
    this.router.navigate(['/decks', deck.id]);
  }

  private async loadBasicCards(): Promise<void> {
    const colors = this.basicColors();
    const entries = colors.map((c): DeckEntry => ({ count: 1, name: basicLandName(c), section: 'main' }));
    const resolved = await firstValueFrom(this.deckCards.resolve(entries, this.settings.cardLanguage())).catch(() => new Map());
    this.basicCards.set(
      new Map(colors.flatMap((c, i) => {
        const card = resolved.get(cardKey(entries[i]))?.card;
        return card ? [[c, card] as const] : [];
      })),
    );
  }


  // Suggestions are ranked on the English cards; this swaps in the printings in the card language where they exist.
  // Cards from the own sets keep that printing; for all others any printing (in the card language) will do.
  private printing(card: ScryfallCard): Pick<DeckEntry, 'name' | 'set' | 'collectorNumber'> {
    return this.preferredSets().includes(card.set)
      ? { name: deckCardName(card), set: card.set, collectorNumber: card.collector_number }
      : { name: deckCardName(card) };
  }

  private async localize(cards: readonly ScryfallCard[]): Promise<ScryfallCard[]> {
    const entries = cards.map((card): DeckEntry => ({ count: 1, ...this.printing(card), section: 'main' }));
    if (!entries.length) {
      return [];
    }
    const resolved = await firstValueFrom(this.deckCards.resolve(entries, this.settings.cardLanguage()));
    return cards.map((card, i) => withImages(resolved.get(cardKey(entries[i]))?.card ?? card, card));
  }

  private async run(task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.failed.set(false);
    try {
      await task();
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
