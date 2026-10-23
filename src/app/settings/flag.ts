import { Component, input } from '@angular/core';

export type FlagCode = 'gb' | 'de' | 'fr' | 'it' | 'es' | 'br' | 'jp' | 'kr' | 'ru' | 'cn' | 'tw';

// Flags are content imagery, so their colors are intentionally not design tokens.
@Component({
  selector: 'app-flag',
  template: `
    <svg viewBox="0 0 20 15" aria-hidden="true">
      @switch (code()) {
        @case ('gb') {
          <rect width="20" height="15" fill="#012169" />
          <path d="M0 0l20 15M20 0L0 15" stroke="#fff" stroke-width="3" />
          <path d="M0 0l20 15M20 0L0 15" stroke="#c8102e" stroke-width="1" />
          <path d="M10 0v15M0 7.5h20" stroke="#fff" stroke-width="5" />
          <path d="M10 0v15M0 7.5h20" stroke="#c8102e" stroke-width="3" />
        }
        @case ('de') {
          <rect width="20" height="5" fill="#000" />
          <rect y="5" width="20" height="5" fill="#dd0000" />
          <rect y="10" width="20" height="5" fill="#ffce00" />
        }
        @case ('fr') {
          <rect width="7" height="15" fill="#0055a4" />
          <rect x="7" width="6" height="15" fill="#fff" />
          <rect x="13" width="7" height="15" fill="#ef4135" />
        }
        @case ('it') {
          <rect width="7" height="15" fill="#009246" />
          <rect x="7" width="6" height="15" fill="#fff" />
          <rect x="13" width="7" height="15" fill="#ce2b37" />
        }
        @case ('es') {
          <rect width="20" height="15" fill="#aa151b" />
          <rect y="3.75" width="20" height="7.5" fill="#f1bf00" />
        }
        @case ('br') {
          <rect width="20" height="15" fill="#009c3b" />
          <path d="M2 7.5L10 1.8l8 5.7-8 5.7z" fill="#ffdf00" />
          <circle cx="10" cy="7.5" r="3.3" fill="#002776" />
        }
        @case ('jp') {
          <rect width="20" height="15" fill="#fff" />
          <circle cx="10" cy="7.5" r="4.2" fill="#bc002d" />
        }
        @case ('kr') {
          <rect width="20" height="15" fill="#fff" />
          <path d="M6.5 7.5a3.5 3.5 0 0 1 7 0z" fill="#cd2e3a" />
          <path d="M6.5 7.5a3.5 3.5 0 0 0 7 0z" fill="#0047a0" />
          <path d="M2.2 4.2l2-2.4M16 2l2 2.4M2.2 10.8l2 2.4M16 13l2-2.4" stroke="#000" stroke-width="1.2" />
        }
        @case ('ru') {
          <rect width="20" height="5" fill="#fff" />
          <rect y="5" width="20" height="5" fill="#0039a6" />
          <rect y="10" width="20" height="5" fill="#d52b1e" />
        }
        @case ('cn') {
          <rect width="20" height="15" fill="#ee1c25" />
          <polygon [attr.points]="star(4, 4, 2.4)" fill="#ffff00" />
          <polygon [attr.points]="star(8, 1.6, 0.8)" fill="#ffff00" />
          <polygon [attr.points]="star(9.6, 3.4, 0.8)" fill="#ffff00" />
          <polygon [attr.points]="star(9.6, 5.8, 0.8)" fill="#ffff00" />
          <polygon [attr.points]="star(8, 7.6, 0.8)" fill="#ffff00" />
        }
        @case ('tw') {
          <rect width="20" height="15" fill="#fe0000" />
          <rect width="10" height="7.5" fill="#000095" />
          <circle cx="5" cy="3.75" r="2" fill="#fff" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 20px;
      height: 15px;
      border-radius: var(--radius-sm);
      overflow: hidden;
      box-shadow: 0 0 0 var(--line-width) var(--color-flag-frame);
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class Flag {
  readonly code = input.required<FlagCode>();

  protected star(cx: number, cy: number, r: number): string {
    const points: string[] = [];
    for (let i = 0; i < 10; i++) {
      const radius = i % 2 === 0 ? r : r * 0.4;
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`);
    }
    return points.join(' ');
  }
}
