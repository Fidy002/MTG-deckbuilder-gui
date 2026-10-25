import { Injectable, signal } from '@angular/core';

export interface Ember {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  delay: number;
}

export interface HoverPreview {
  image: string;
  name: string;
  warning?: string;
  left: number;
  top: number;
}

const HOVER_DELAY_MS = 500;
const PREVIEW_WIDTH = 320;
const PREVIEW_GAP = 16;
const VIEWPORT_MARGIN = 8;
const CARD_ASPECT = 488 / 680;

const EMBER_COUNT = 12;
const EMBER_LIFETIME_MS = 300;
const EMBER_MAX_DELAY_MS = 60;

@Injectable({ providedIn: 'root' })
export class CardHoverOverlay {
  readonly embers = signal<Ember[]>([]);
  readonly preview = signal<HoverPreview | undefined>(undefined);
  readonly previewWidth = PREVIEW_WIDTH;

  private previewTimer?: ReturnType<typeof setTimeout>;
  private pointerY = 0;
  private nextEmberId = 0;

  trackPointer(event: MouseEvent): void {
    this.pointerY = event.clientY;
  }

  enter(
    card: HTMLElement,
    hitArea: HTMLElement,
    event: MouseEvent,
    previewImage: string | undefined,
    name: string,
    warning?: string,
  ): void {
    this.hide();
    this.trackPointer(event);
    this.spawnEmbers(hitArea.getBoundingClientRect());
    this.schedulePreview(card, previewImage, name, warning);
  }

  schedulePreview(card: HTMLElement, previewImage: string | undefined, name: string, warning?: string): void {
    this.hide();
    if (!previewImage) {
      return;
    }
    this.previewTimer = setTimeout(() => {
      const rect = card.getBoundingClientRect();
      const height = PREVIEW_WIDTH / CARD_ASPECT;
      const left =
        rect.left + rect.width / 2 > window.innerWidth / 2
          ? rect.left - PREVIEW_GAP - PREVIEW_WIDTH
          : rect.right + PREVIEW_GAP;
      const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
      const top = Math.max(VIEWPORT_MARGIN, Math.min(this.pointerY - height / 2, maxTop));
      this.preview.set({ image: previewImage, name, warning, left, top });
    }, HOVER_DELAY_MS);
  }

  hide(): void {
    clearTimeout(this.previewTimer);
    this.preview.set(undefined);
  }

  spawnEmbers(area: DOMRect): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const includeBottom = area.height > area.width;
    const random = (min: number, max: number) => min + Math.random() * (max - min);
    const created = Array.from({ length: EMBER_COUNT }, (): Ember => {
      const sides = includeBottom ? ['top', 'left', 'right', 'bottom'] : ['top', 'left', 'right'];
      const side = sides[Math.floor(Math.random() * sides.length)];
      const base = { id: this.nextEmberId++, size: random(2, 4), delay: random(0, EMBER_MAX_DELAY_MS) };
      switch (side) {
        case 'top':
          return { ...base, x: random(area.left, area.right), y: area.top, dx: random(-8, 8), dy: random(-26, -12) };
        case 'bottom':
          return { ...base, x: random(area.left, area.right), y: area.bottom, dx: random(-8, 8), dy: random(-10, -2) };
        case 'left':
          return { ...base, x: area.left, y: random(area.top, area.bottom), dx: random(-24, -10), dy: random(-14, 0) };
        default:
          return { ...base, x: area.right, y: random(area.top, area.bottom), dx: random(10, 24), dy: random(-14, 0) };
      }
    });
    this.embers.update((embers) => [...embers, ...created]);
    const ids = new Set(created.map((e) => e.id));
    setTimeout(
      () => this.embers.update((embers) => embers.filter((e) => !ids.has(e.id))),
      EMBER_LIFETIME_MS + EMBER_MAX_DELAY_MS + 50,
    );
  }
}
