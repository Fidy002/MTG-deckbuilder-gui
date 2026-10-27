import { Component, input } from '@angular/core';
import { I18nService } from '../../i18n/i18n.service';
import { PlayStyle, SuggestionRole } from '../../decks/deck-suggestions';
import { CardRating, EffectId } from '../../decks/deck-synergies';
import { WinconId } from '../../decks/deck-wincons';

export interface Badge {
  label: string;
  title: string;
  synergy: boolean;
}

const MAX_BADGES = 3;

// The badge that names what a card does in the deck: the effect of the same name, or a badge of its own.
const ROLE_EFFECTS: Partial<Record<SuggestionRole, EffectId>> = { ramp: 'mana', draw: 'draw', removal: 'removal' };
const ROLE_BADGES = ['wipes', 'tutors'] as const;

export interface BadgeInfo {
  rating: CardRating;
  // The win plans the card brings, and the deck's plans (main first) that are worth a badge.
  plans: readonly WinconId[];
  deckPlans: readonly (WinconId | undefined)[];
  commanderName?: string;
  gameChanger?: boolean;
  // The play style, when the card plays into it.
  style?: PlayStyle;
  // The role the card fills (ramp, draw, removal, ...): always shown first.
  role?: SuggestionRole;
}

/** Why a suggested card fits: the deck's win plans and the commander's synergies first, then its own strengths. */
export function suggestionBadges(i18n: I18nService, info: BadgeInfo): Badge[] {
  const badges: Badge[] = [];
  const effect = info.role && ROLE_EFFECTS[info.role];
  const own = ROLE_BADGES.find((role) => role === info.role);
  const roleBadge: Badge | undefined = effect
    ? { label: i18n.translate(`wizard.effect.${effect}`), title: i18n.translate(`wizard.effectTitle.${effect}`), synergy: false }
    : own
      ? { label: i18n.translate(`wizard.roleBadge.${own}`), title: i18n.translate(`wizard.roleBadgeTitle.${own}`), synergy: false }
      : undefined;
  for (const id of [...info.deckPlans].reverse()) {
    if (id && info.plans.includes(id)) {
      badges.unshift({
        label: i18n.translate(`wizard.wincon.${id}`),
        title: i18n.translate(`wizard.winconTip.${id}`, { commander: '' }),
        synergy: true,
      });
    }
  }
  if (info.rating.synergies.length && info.commanderName) {
    const labels = info.rating.synergies.map((id) => i18n.translate(`wizard.synergyLabel.${id}`)).join(', ');
    badges.push({
      label: `★ ${i18n.translate('wizard.synergy')}`,
      title: i18n.translate('wizard.synergyTitle', { commander: info.commanderName, labels }),
      synergy: true,
    });
  }
  if (info.style) {
    const style = i18n.translate(`wizard.style.${info.style}`);
    badges.push({ label: style, title: i18n.translate('wizard.styleBadge', { style }), synergy: true });
  }
  if (info.gameChanger) {
    badges.push({ label: 'Game Changer', title: i18n.translate('wizard.gameChangerBadge'), synergy: false });
  }
  for (const id of info.rating.effects) {
    badges.push({ label: i18n.translate(`wizard.effect.${id}`), title: i18n.translate(`wizard.effectTitle.${id}`), synergy: false });
  }
  if (roleBadge) {
    badges.unshift(roleBadge);
  }
  // A win plan and the play style can share a name (e.g. Landfall), so can a role and an effect: each label once.
  const labels = new Set<string>();
  return badges.filter((badge) => !labels.has(badge.label) && !!labels.add(badge.label)).slice(0, MAX_BADGES);
}

/** The badges at the bottom of a suggested card. */
@Component({
  selector: 'app-card-badges',
  template: `
    @for (badge of badges(); track badge.label) {
      <span class="badge" [class.synergy]="badge.synergy" [title]="badge.title">{{ badge.label }}</span>
    }
  `,
  styles: `
    :host {
      position: absolute;
      right: 4%;
      bottom: 5%;
      left: 4%;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 3px;
      pointer-events: auto;
    }
    .badge {
      max-width: 100%;
      overflow: hidden;
      padding: 2px var(--space-2);
      border-radius: 999px;
      background: rgb(20 18 15 / 0.85);
      color: var(--color-text);
      font-size: 0.7rem;
      font-weight: 700;
      text-overflow: ellipsis;
      white-space: nowrap;
      box-shadow: 0 1px 4px rgb(0 0 0 / 0.6);
    }
    .badge.synergy {
      background: var(--color-accent);
      color: var(--color-bg);
    }
  `,
})
export class CardBadges {
  readonly badges = input.required<readonly Badge[]>();
}
