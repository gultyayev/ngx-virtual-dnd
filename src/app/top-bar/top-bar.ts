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
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../theme.service';

interface NavTab {
  readonly label: string;
  readonly link: string;
  readonly exact: boolean;
}

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
        <span class="brand-mark">
          <!-- Viewport mark: rows inside a frame, faint virtual rows outside, one row dragged across the edge -->
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="5" y="1" width="14" height="2" rx="1" fill="currentColor" opacity="0.3" />
            <rect x="5" y="8.75" width="14" height="2.5" rx="1.1" fill="currentColor" />
            <rect x="8" y="12.75" width="14" height="2.5" rx="1.1" fill="currentColor" />
            <rect x="5" y="21" width="14" height="2" rx="1" fill="currentColor" opacity="0.3" />
            <rect
              x="2"
              y="5.5"
              width="20"
              height="13"
              rx="3"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        </span>
        <span class="wordmark">ngx-virtual-dnd</span>
      </a>
      <nav class="nav">
        @for (tab of tabs; track tab.link) {
          <a
            class="nav-tab"
            [routerLink]="tab.link"
            routerLinkActive="is-active"
            [routerLinkActiveOptions]="{ exact: tab.exact }"
            >{{ tab.label }}</a
          >
        }
        <a class="nav-tab" [href]="docsUrl">Docs</a>
      </nav>
      <button
        type="button"
        class="icon-btn"
        (click)="theme.cycle()"
        [title]="'Theme: ' + theme.mode()"
        [attr.aria-label]="'Theme: ' + theme.mode()"
      >
        @switch (icon()) {
          @case ('auto') {
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="2.5" y="3.5" width="19" height="13" rx="2" />
              <path d="M8 20.5h8M12 16.5v4" />
            </svg>
          }
          @case ('dark') {
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          }
          @default {
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path
                d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
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
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        } @else {
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
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
              [routerLinkActiveOptions]="{ exact: tab.exact }"
              (click)="closeMenu()"
            >
              {{ tab.label }}
              @if (rla.isActive) {
                <span class="nav-sheet-dot"></span>
              }
            </a>
          }
          <a class="nav-sheet-item" [href]="docsUrl">Docs</a>
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
    { label: 'Main demo', link: '/', exact: true },
    { label: 'Page scroll', link: '/page-scroll', exact: false },
    { label: 'Dynamic height', link: '/dynamic-height', exact: false },
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
