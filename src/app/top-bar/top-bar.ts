import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { IsActiveMatchOptions, RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../theme.service';

interface NavTab {
  readonly label: string;
  readonly link: string;
  readonly match: IsActiveMatchOptions;
}

/**
 * Matches a tab by its path alone. The query is ignored: the docs open the demo with
 * `?theme=light|dark`, which must not change the current tab.
 */
const matchPath = (paths: IsActiveMatchOptions['paths']): IsActiveMatchOptions => ({
  paths,
  queryParams: 'ignored',
  matrixParams: 'ignored',
  fragment: 'ignored',
});

/**
 * Shared top navigation bar used across all demo pages: brand, page tabs and a
 * light/dark theme toggle. Host element is the sticky bar itself. On mobile
 * viewports the tabs collapse into a hamburger toggle that opens a dropdown sheet.
 */
@Component({
  selector: 'app-top-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive],
  host: {
    '(document:keydown.escape)': 'closeMenu()',
    '(document:click)': 'onDocumentClick($event)',
  },
  template: `
    <div class="topbar-in">
      <a class="brand" routerLink="/" aria-label="ngx-virtual-dnd home">
        <!-- Viewport mark: rows inside a frame, faint virtual rows outside, one row dragged across the edge -->
        <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
          <rect class="m-ghost" x="5" y="1" width="14" height="2" rx="1" />
          <rect class="m-row" x="5" y="8.75" width="14" height="2.5" rx="1.1" />
          <rect class="m-held" x="8" y="12.75" width="14" height="2.5" rx="1.1" />
          <rect class="m-ghost" x="5" y="21" width="14" height="2" rx="1" />
          <rect class="m-frame" x="2" y="5.5" width="20" height="13" rx="3" />
        </svg>
        <span class="wordmark">ngx-virtual-dnd</span>
      </a>
      <nav class="nav">
        @for (tab of tabs; track tab.link) {
          <a
            class="nav-tab"
            [routerLink]="tab.link"
            routerLinkActive="is-active"
            [routerLinkActiveOptions]="tab.match"
            >{{ tab.label }}</a
          >
        }
        <a class="nav-tab" [href]="docsUrl"
          >Docs
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </a>
      </nav>
      <span class="nav-sep" aria-hidden="true"></span>
      <button
        type="button"
        class="icon-btn"
        (click)="theme.cycle()"
        [title]="'Theme: ' + theme.mode()"
        [attr.aria-label]="'Theme: ' + theme.mode()"
      >
        @switch (icon()) {
          @case ('auto') {
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3" y="4" width="18" height="12" rx="2" />
              <path d="M8 20h8M12 16v4" />
            </svg>
          }
          @case ('dark') {
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.6 6.6 0 0 0 9.9 9.9z" />
            </svg>
          }
          @default {
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path
                d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
              />
            </svg>
          }
        }
      </button>
      <button
        type="button"
        class="icon-btn nav-toggle"
        [class.is-open]="menuOpen()"
        (click)="toggleMenu()"
        [attr.aria-label]="menuOpen() ? 'Close menu' : 'Open menu'"
        [attr.aria-expanded]="menuOpen()"
      >
        @if (menuOpen()) {
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        } @else {
          <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        }
      </button>
    </div>
    @if (menuOpen()) {
      <!--
        Teleported to <body> so the dropdown escapes ancestor clipping: on the task
        pages the bar sits inside an ion-toolbar (contain: content) and the host's own
        backdrop-filter both create clipping containing blocks a nested overlay can't
        escape. Angular change detection still tracks it via the logical view tree.
      -->
      <div #menuOverlay class="nav-menu">
        <div class="nav-sheet-backdrop"></div>
        <nav #navSheet class="nav-sheet">
          @for (tab of tabs; track tab.link) {
            <a
              class="nav-sheet-item"
              [routerLink]="tab.link"
              routerLinkActive="is-active"
              #rla="routerLinkActive"
              [routerLinkActiveOptions]="tab.match"
              (click)="closeMenu()"
            >
              {{ tab.label }}
              @if (rla.isActive) {
                <span class="nav-sheet-dot"></span>
              }
            </a>
          }
          <a class="nav-sheet-item" [href]="docsUrl"
            >Docs
            <svg class="ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        </nav>
      </div>
    }
  `,
  styleUrl: './top-bar.scss',
})
export class TopBarComponent {
  readonly theme = inject(ThemeService);
  readonly #host = inject(ElementRef<HTMLElement>);

  // viewChild queries can't use ES private fields (Angular limitation).
  private readonly menuOverlay = viewChild<ElementRef<HTMLElement>>('menuOverlay');
  private readonly navSheet = viewChild<ElementRef<HTMLElement>>('navSheet');

  /** Icon reflects the selected mode (auto shows a monitor). */
  readonly icon = computed(() => this.theme.mode());

  /** Whether the mobile dropdown nav sheet is open. */
  readonly menuOpen = signal(false);

  protected readonly tabs: readonly NavTab[] = [
    { label: 'Main demo', link: '/', match: matchPath('exact') },
    { label: 'Page scroll', link: '/page-scroll', match: matchPath('subset') },
    { label: 'Dynamic height', link: '/dynamic-height', match: matchPath('subset') },
  ];

  /** Absolute so it resolves the same from any demo route and from local dev. */
  protected readonly docsUrl = 'https://gultyayev.github.io/ngx-virtual-dnd/';

  constructor() {
    // Move the open sheet to <body>, out of any clipping/containing-block ancestor.
    effect(() => {
      const overlay = this.menuOverlay()?.nativeElement;
      if (overlay && overlay.parentElement !== document.body) {
        document.body.appendChild(overlay);
      }
    });
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  /**
   * Dismiss the open sheet when the user clicks the dim backdrop or anywhere
   * outside the sheet. Clicks on the bar (toggle/theme) and inside the sheet are
   * ignored here — those manage their own state. Keyboard users dismiss via Escape.
   * The sheet is teleported to <body>, so it is matched explicitly rather than via
   * the host element.
   */
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const target = event.target as Node | null;
    if (!target) return;
    if (this.#host.nativeElement.contains(target)) return;
    if (this.navSheet()?.nativeElement.contains(target)) return;
    this.closeMenu();
  }
}
