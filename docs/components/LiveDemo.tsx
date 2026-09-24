import { useDark } from '@rspress/core/runtime';
import { useEffect, useRef, useState } from 'react';

declare const process: { env: { DEMO_URL: string } };

interface LiveDemoProps {
  /** Folder name under src/app/examples/ (the demo route is /examples/<example>). */
  example: string;
  /** Accessible name of the embedded frame. */
  title: string;
  /**
   * Initial frame height in px, used until the example reports its own height. Match the
   * example's desktop height to avoid a layout shift.
   */
  height?: number;
}

/** The theme actually rendered. Rspress sets `html.dark` before hydration. */
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * Embeds a live Angular example from the demo app.
 *
 * Theme sync with the example (ThemeService in the demo):
 * - the frame is rendered client-side only, with `?theme=` set to the theme on screen;
 * - the example posts `{ type: 'vdnd-theme-ready' }` once it boots, and this component
 *   replies with the current theme, so a theme that changed while the frame was loading
 *   is not lost;
 * - later toggles are posted as `{ type: 'vdnd-theme', theme }`, which keeps the example's
 *   state (no reload). Nothing is posted before the frame has loaded.
 *
 * Sizing: the example posts `{ type: 'vdnd-example-size', height }` whenever its height
 * changes (ExamplesShellComponent), and the frame follows it, so there is no inner scrollbar
 * or empty space at any width.
 */
export default function LiveDemo({ example, title, height = 380 }: LiveDemoProps) {
  const dark = useDark();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const loadedRef = useRef(false);
  const [src, setSrc] = useState<string | null>(null);
  const [frameHeight, setFrameHeight] = useState(height);
  // Trailing slash: GitHub Pages serves examples/<slug>/index.html and would redirect otherwise.
  const exampleUrl = `${process.env.DEMO_URL}examples/${example}/`;

  const postTheme = (): void => {
    const frameWindow = frameRef.current?.contentWindow;
    if (!frameWindow || !loadedRef.current || !src) return;
    const targetOrigin = new URL(src, window.location.href).origin;
    frameWindow.postMessage({ type: 'vdnd-theme', theme: currentTheme() }, targetOrigin);
  };

  useEffect(() => {
    loadedRef.current = false;
    setSrc(`${exampleUrl}?theme=${currentTheme()}`);
  }, [exampleUrl]);

  // Reply to the example's ready handshake and follow its reported height.
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>): void => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (data?.type === 'vdnd-example-size') {
        if (typeof data.height === 'number' && data.height > 0) setFrameHeight(data.height);
        return;
      }
      if (data?.type !== 'vdnd-theme-ready') return;
      loadedRef.current = true;
      postTheme();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });

  // Follow the docs theme toggle.
  useEffect(() => {
    postTheme();
    // `dark` is the trigger; the posted value is read from the DOM.
  }, [dark, src]);

  return (
    <figure className="vdnd-live-demo">
      <figcaption className="vdnd-live-demo__bar">
        <span className="vdnd-live-demo__label">Live example</span>
        <a className="vdnd-live-demo__open" href={exampleUrl} target="_blank" rel="noreferrer">
          Open in new tab ↗
        </a>
      </figcaption>
      {src ? (
        <iframe
          ref={frameRef}
          className="vdnd-live-demo__frame"
          src={src}
          title={title}
          loading="lazy"
          style={{ height: frameHeight }}
          onLoad={() => {
            loadedRef.current = true;
            postTheme();
          }}
        />
      ) : (
        <div className="vdnd-live-demo__frame" style={{ height }} />
      )}
    </figure>
  );
}
