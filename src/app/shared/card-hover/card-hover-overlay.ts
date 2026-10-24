import { Component, inject } from '@angular/core';
import { CardHoverOverlay } from './card-hover-overlay.service';

// Rendered once in the app shell: water filter, ember particles and the large preview of the hovered card.
@Component({
  selector: 'app-card-hover-overlay',
  host: { '(window:scroll)': 'overlay.hide()' },
  template: `
    <svg class="filters" aria-hidden="true" focusable="false">
      <filter id="hover-water" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.03 0.045" numOctaves="1" seed="4" result="noise">
          <animate attributeName="baseFrequency" dur="4s" values="0.03 0.045;0.04 0.032;0.03 0.045" repeatCount="indefinite" />
        </feTurbulence>
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" result="wave" />
        <feGaussianBlur in="wave" stdDeviation="2.5" result="soft" />
        <feComponentTransfer in="soft">
          <feFuncA type="linear" slope="1.3" />
        </feComponentTransfer>
      </filter>
      <filter id="hover-water-still" x="-15%" y="-15%" width="130%" height="130%" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.03 0.045" numOctaves="1" seed="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" result="wave" />
        <feGaussianBlur in="wave" stdDeviation="2.5" result="soft" />
        <feComponentTransfer in="soft">
          <feFuncA type="linear" slope="1.3" />
        </feComponentTransfer>
      </filter>
    </svg>

    <div class="embers" aria-hidden="true">
      @for (ember of overlay.embers(); track ember.id) {
        <span
          class="ember"
          [style.left.px]="ember.x"
          [style.top.px]="ember.y"
          [style.--size]="ember.size + 'px'"
          [style.--dx]="ember.dx + 'px'"
          [style.--dy]="ember.dy + 'px'"
          [style.animation-delay.ms]="ember.delay"
        ></span>
      }
    </div>

    @if (overlay.preview(); as preview) {
      <div class="preview" [style.left.px]="preview.left" [style.top.px]="preview.top" [style.width.px]="overlay.previewWidth">
        <img [src]="preview.image" [alt]="preview.name" />
        @if (preview.warning) {
          <p class="warning" role="status">{{ preview.warning }}</p>
        }
      </div>
    }
  `,
  styles: `
    .filters {
      position: absolute;
      width: 0;
      height: 0;
    }

    .embers {
      position: fixed;
      inset: 0;
      z-index: 40;
      pointer-events: none;
    }

    .ember {
      position: absolute;
      width: var(--size);
      height: var(--size);
      margin: calc(var(--size) / -2);
      border-radius: 50%;
      background: var(--color-highlight);
      box-shadow: 0 0 var(--ember-glow) color-mix(in srgb, var(--color-highlight) 70%, transparent);
      opacity: 0;
      animation: ember-rise var(--ember-duration) ease-out forwards;
    }

    @keyframes ember-rise {
      20% {
        opacity: 0.95;
      }
      100% {
        opacity: 0;
        transform: translate(var(--dx), var(--dy)) scale(0.4);
      }
    }

    .preview {
      position: fixed;
      z-index: 50;
      pointer-events: none;

      img {
        display: block;
        width: 100%;
        height: auto;
        aspect-ratio: var(--card-ratio);
        border-radius: var(--radius-card);
        filter: var(--shadow-stack);
      }
    }

    // Lies over the lower part of the preview, so it always stays inside the viewport with it.
    .warning {
      position: absolute;
      inset: auto 6% 5%;
      margin: 0;
      padding: var(--space-2) var(--space-3);
      border: var(--line-width) solid #000;
      border-radius: var(--radius-md);
      background: var(--color-illegal-glow);
      box-shadow: 0 4px 12px rgb(0 0 0 / 0.6);
      font-size: var(--text-sm);
      font-weight: 600;
      line-height: 1.35;
      color: #fff;
      white-space: pre-line;
    }
  `,
})
export class CardHoverOverlayHost {
  protected readonly overlay = inject(CardHoverOverlay);
}
