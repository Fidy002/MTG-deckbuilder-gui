import { Component, DestroyRef, ElementRef, Injectable, Injector, afterNextRender, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ScryfallCard } from '../../scryfall/scryfall.models';
import { ScryfallService } from '../../scryfall/scryfall.service';

const MARQUEE_QUERY = 'is:commander legal:commander';
const MARQUEE_CARDS = 18;
// Each visit shows commanders of a random page (175 cards each) among the most played ones.
const MARQUEE_PAGES = 8;
// How long the pictures take to fade out before others take their place (and to fade in once loaded).
const FADE_MS = 2500;

/** The cards whose art a page wants in the marquee (e.g. the open deck's); the popular commanders otherwise. */
@Injectable({ providedIn: 'root' })
export class MarqueeArt {
  readonly cards = signal<readonly ScryfallCard[] | undefined>(undefined);
}

// The art crops of the cards, shuffled and repeated up to the marquee's length, so even a few cards fill the track.
function marqueeImages(cards: readonly ScryfallCard[]): string[] {
  const unique = [...new Set(cards.flatMap((card) => (card.image_uris ?? card.card_faces?.[0]?.image_uris)?.art_crop ?? []))];
  const shuffled = unique.map((src) => ({ src, key: Math.random() })).sort((a, b) => a.key - b.key).map(({ src }) => src);
  return shuffled.length ? Array.from({ length: MARQUEE_CARDS }, (_, i) => shuffled[i % shuffled.length]) : [];
}

// The new track drifts in step with the oldest one: its animation takes over the same start time.
async function syncDrift(host: HTMLElement): Promise<void> {
  const animations = [...host.querySelectorAll('.track')].flatMap((track) => track.getAnimations());
  const [reference, ...others] = animations;
  if (!reference) {
    return;
  }
  await reference.ready;
  others.forEach((animation) => (animation.startTime = reference.startTime));
}

/** The art of popular commanders drifting slowly from right to left behind the top of the page, faded and desaturated. */
@Component({
  selector: 'app-card-marquee',
  template: `
    <!-- While pictures change, the old track fades out over the new one, both at the same point of the drift. -->
    @for (layer of layers(); track layer.id) {
      <div class="track" [class.leaving]="layer.leaving">
        <!-- The pictures twice in a row: when the track has moved by half, it looks exactly like at the start. -->
        @for (src of layer.images; track $index) {
          <img [src]="src" alt="" width="626" height="457" decoding="async" [class.loaded]="loaded().has(layer.id + '|' + src)" (load)="markLoaded(layer.id + '|' + src)" />
        }
        @for (src of layer.images; track $index) {
          <img [src]="src" alt="" width="626" height="457" decoding="async" [class.loaded]="loaded().has(layer.id + '|' + src)" (load)="markLoaded(layer.id + '|' + src)" />
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: absolute;
      top: 0;
      right: 0;
      left: 0;
      z-index: -1;
      height: 260px;
      overflow: hidden;
      pointer-events: none;
      mask-image:
        linear-gradient(to bottom, black 35%, transparent),
        linear-gradient(to right, transparent, black 15%, black 85%, transparent);
      mask-composite: intersect;
    }

    .track {
      position: absolute;
      top: 0;
      left: 0;
      /* The slant of the edges (as drawn in the masks) and how far neighbours overlap along them. */
      --slant: 50px;
      --overlap: 24px;
      display: flex;
      width: max-content;
      animation: drift 1440s linear infinite;
      will-change: transform;
    }

    /* Trapezoids, every other one upside down: neighbours interlock along their slanted edges, blending softly where they overlap. */
    img {
      width: 356px;
      height: 260px;
      margin-right: calc(-1 * var(--slant) - var(--overlap));
      object-fit: cover;
      mask: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 356 260' preserveAspectRatio='none'><filter id='f' x='-0.2' y='-0.2' width='1.4' height='1.4'><feGaussianBlur stdDeviation='10'/></filter><polygon filter='url(%23f)' fill='white' points='-8,-40 364,-40 298,300 58,300'/></svg>") 0 0 / 100% 100% no-repeat;
      filter: saturate(0.15) brightness(0.55);
      opacity: 0;
      transition: opacity 2.5s ease-in-out;

      &.loaded {
        opacity: 0.3;
      }
    }

    .leaving img {
      opacity: 0;
    }

    img:nth-child(even) {
      mask: url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 356 260' preserveAspectRatio='none'><filter id='f' x='-0.2' y='-0.2' width='1.4' height='1.4'><feGaussianBlur stdDeviation='10'/></filter><polygon filter='url(%23f)' fill='white' points='58,-40 298,-40 364,300 -8,300'/></svg>") 0 0 / 100% 100% no-repeat;
    }

    @keyframes drift {
      to {
        transform: translateX(-50%);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .track {
        animation: none;
      }
    }
  `,
  host: { 'aria-hidden': 'true' },
})
export class CardMarquee {
  private readonly scryfall = inject(ScryfallService);
  private readonly art = inject(MarqueeArt);
  private readonly popular = toSignal(this.scryfall.findPopularCards(MARQUEE_QUERY, 1 + Math.floor(Math.random() * MARQUEE_PAGES)), {
    initialValue: [],
  });
  private readonly wanted = computed(() => marqueeImages(this.art.cards() ?? this.popular()));

  // The shown tracks: the current one, and while pictures change the one fading out.
  protected readonly layers = signal<{ id: number; images: string[]; leaving: boolean }[]>([]);
  // A picture fades in once it has loaded, instead of popping up.
  protected readonly loaded = signal(new Set<string>());

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const injector = inject(Injector);
    let nextId = 0;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    inject(DestroyRef).onDestroy(() => timers.forEach(clearTimeout));
    effect(() => {
      const images = this.wanted();
      untracked(() => {
        const id = nextId++;
        const layer = { id, images, leaving: false };
        this.layers.update((layers) => [...layers.map((l) => ({ ...l, leaving: true })), layer]);
        afterNextRender(() => syncDrift(host), { injector });
        const timer = setTimeout(() => {
          timers.delete(timer);
          this.layers.update((layers) => layers.filter((l) => !l.leaving || l.id > id));
          this.loaded.update((loaded) => new Set([...loaded].filter((key) => this.layers().some((l) => key.startsWith(`${l.id}|`)))));
        }, FADE_MS);
        timers.add(timer);
      });
    });
  }

  protected markLoaded(src: string): void {
    this.loaded.update((loaded) => new Set(loaded).add(src));
  }
}
