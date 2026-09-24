import { DestroyRef, inject, Injectable, signal } from '@angular/core';

export type ThemeMode = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'vdnd-theme';
const FIXED_SCHEME = 'porcelain';
const FIXED_DENSITY = 'comfortable';

/**
 * Manages the demo app's light/dark theme.
 *
 * Applies `data-theme` / `data-scheme` / `data-density` to the document root so the
 * shared design tokens in `src/styles/tokens.css` resolve. The accent (teal), light scheme
 * (porcelain) and density (comfortable) are fixed — only the light/dark mode is
 * user-toggleable via the top bar.
 *
 * Embedded use (docs live examples, rendered in an iframe by the docs' `<LiveDemo>`):
 * - a `?theme=light|dark` query param sets the initial mode;
 * - on boot the page posts `{ type: 'vdnd-theme-ready' }` to its parent, which replies
 *   with the current docs theme (covers a parent whose theme settled after the iframe URL
 *   was chosen);
 * - `{ type: 'vdnd-theme', theme }` messages from the parent keep it in sync with the docs
 *   theme toggle.
 * None of this is persisted, so embedding never overwrites the visitor's own demo preference
 * (docs and demo share an origin on GitHub Pages). Messages only change the theme, so any
 * embedding page may send them; they are ignored when the page is not framed.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** The user's selected mode: auto follows the OS preference. */
  readonly mode = signal<ThemeMode>('auto');

  readonly #media =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  readonly #destroyRef = inject(DestroyRef);

  constructor() {
    const stored = this.#read();
    if (stored) {
      this.mode.set(stored);
    }

    const embedded = this.#readQueryTheme();
    if (embedded) {
      this.mode.set(embedded);
    }

    this.#listenToEmbeddingPage();

    this.#media?.addEventListener('change', () => {
      if (this.mode() === 'auto') {
        this.#apply();
      }
    });

    const root = document.documentElement;
    root.setAttribute('data-scheme', FIXED_SCHEME);
    root.setAttribute('data-density', FIXED_DENSITY);
    this.#apply();
  }

  /** The concrete theme currently rendered (auto resolved to light/dark). */
  resolved(): 'light' | 'dark' {
    const mode = this.mode();
    if (mode === 'auto') {
      return this.#media?.matches ? 'dark' : 'light';
    }
    return mode;
  }

  /** Cycle auto → light → dark → auto. */
  cycle(): void {
    const next: Record<ThemeMode, ThemeMode> = { auto: 'light', light: 'dark', dark: 'auto' };
    this.mode.set(next[this.mode()]);
    this.#write(this.mode());
    this.#apply();
  }

  #listenToEmbeddingPage(): void {
    if (typeof window === 'undefined' || window.parent === window) return;

    const onMessage = (event: MessageEvent<unknown>): void => {
      // Only the embedding page may drive the theme.
      if (event.source !== window.parent) return;
      const theme = parseThemeMessage(event.data);
      if (theme) {
        this.mode.set(theme);
        this.#apply();
      }
    };
    window.addEventListener('message', onMessage);
    this.#destroyRef.onDestroy(() => window.removeEventListener('message', onMessage));

    // No payload beyond the type, so any target origin is safe.
    window.parent.postMessage({ type: 'vdnd-theme-ready' }, '*');
  }

  #apply(): void {
    document.documentElement.setAttribute('data-theme', this.resolved());
  }

  #readQueryTheme(): 'light' | 'dark' | null {
    if (typeof window === 'undefined') return null;
    const value = new URLSearchParams(window.location.search).get('theme');
    return value === 'light' || value === 'dark' ? value : null;
  }

  #read(): ThemeMode | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'light' || value === 'dark' || value === 'auto' ? value : null;
    } catch {
      return null;
    }
  }

  #write(value: ThemeMode): void {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Ignore storage failures (private mode, etc.) — theme still applies in-memory.
    }
  }
}

function parseThemeMessage(data: unknown): 'light' | 'dark' | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, theme } = data as { type?: unknown; theme?: unknown };
  if (type !== 'vdnd-theme') return null;
  return theme === 'light' || theme === 'dark' ? theme : null;
}
