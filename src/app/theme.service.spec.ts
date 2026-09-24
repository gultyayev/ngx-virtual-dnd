import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';

const STORAGE_KEY = 'vdnd-theme';

describe('ThemeService', () => {
  const root = document.documentElement;

  const createService = (): ThemeService => TestBed.inject(ThemeService);

  let parentFrame: HTMLIFrameElement | null = null;

  /** Simulate running inside an iframe: window.parent becomes another window. */
  const embed = (): Window => {
    parentFrame = document.createElement('iframe');
    document.body.appendChild(parentFrame);
    const parent = parentFrame.contentWindow as Window;
    jest.spyOn(window, 'parent', 'get').mockReturnValue(parent);
    return parent;
  };

  const postMessage = (data: unknown, source: MessageEventSource | null): void => {
    window.dispatchEvent(new MessageEvent('message', { data, source }));
  };

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    parentFrame?.remove();
    parentFrame = null;
  });

  it('applies the stored mode on boot', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');

    const service = createService();

    expect(service.mode()).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('cycles modes and persists the choice', () => {
    localStorage.setItem(STORAGE_KEY, 'light');
    const service = createService();

    service.cycle();

    expect(service.mode()).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  describe('embedded (docs live examples)', () => {
    it('applies ?theme=dark without persisting it', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      window.history.replaceState({}, '', '/examples/quick-start?theme=dark');

      const service = createService();

      expect(service.mode()).toBe('dark');
      expect(root.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('ignores an unknown ?theme value', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      window.history.replaceState({}, '', '/examples/quick-start?theme=purple');

      const service = createService();

      expect(service.mode()).toBe('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('announces readiness to the embedding page', () => {
      const parent = embed();
      const post = jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);

      createService();

      expect(post).toHaveBeenCalledWith({ type: 'vdnd-theme-ready' }, '*');
    });

    it('does not announce readiness when not embedded', () => {
      const post = jest.spyOn(window, 'postMessage').mockImplementation(() => undefined);

      createService();

      expect(post).not.toHaveBeenCalled();
    });

    it('follows theme messages from the parent window without persisting them', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      const parent = embed();
      jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);
      const service = createService();

      postMessage({ type: 'vdnd-theme', theme: 'dark' }, parent);

      expect(service.mode()).toBe('dark');
      expect(root.getAttribute('data-theme')).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    });

    it('ignores messages that do not come from the parent window', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      const parent = embed();
      jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);
      const service = createService();

      postMessage({ type: 'vdnd-theme', theme: 'dark' }, null);
      postMessage({ type: 'vdnd-theme', theme: 'dark' }, window);

      expect(service.mode()).toBe('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('ignores theme messages when the page is not embedded', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      const service = createService();

      // Top-level page: window.parent === window, so its own messages must not apply.
      postMessage({ type: 'vdnd-theme', theme: 'dark' }, window);

      expect(service.mode()).toBe('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    });

    it('stops listening once the service is destroyed', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      const parent = embed();
      jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);
      const service = createService();

      TestBed.resetTestingModule();
      postMessage({ type: 'vdnd-theme', theme: 'dark' }, parent);

      expect(service.mode()).toBe('light');
    });

    it('ignores malformed theme messages', () => {
      localStorage.setItem(STORAGE_KEY, 'light');
      const parent = embed();
      jest.spyOn(parent, 'postMessage').mockImplementation(() => undefined);
      const service = createService();

      postMessage({ type: 'vdnd-theme', theme: 'purple' }, parent);
      postMessage({ type: 'other', theme: 'dark' }, parent);
      postMessage('dark', parent);

      expect(service.mode()).toBe('light');
      expect(root.getAttribute('data-theme')).toBe('light');
    });
  });
});
