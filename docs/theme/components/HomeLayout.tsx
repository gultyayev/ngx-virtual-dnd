import { useFrontmatter } from '@rspress/core/runtime';
import {
  DocContent,
  HomeBackground,
  HomeFooter,
  HomeLayout as OriginalHomeLayout,
  type HomeLayoutProps,
  Link,
} from '@rspress/core/theme-original';
import type { Feature, Hero } from '@rspress/core';
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from 'react';
import { useCopyText } from './useCopyText';
import {
  FEATURE_ICONS,
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconExternal,
  IconGrip,
} from './icons';

/** Keys this theme reads from index.mdx's frontmatter on top of Rspress's `hero`. */
interface HomeHero extends Hero {
  /** Part of `text` drawn in the accent color. */
  highlight?: string;
  /** Pill above the title, linking to the release it announces. */
  announcement?: { badge: string; text: string; link: string };
  /** Install command with a copy button, under the actions. */
  install?: string;
}

interface HomeFeature extends Feature {
  /** Key into FEATURE_ICONS. */
  glyph?: string;
}

function isExternal(link: string): boolean {
  return /^https?:\/\//.test(link);
}

function HeroTitle({ text, highlight }: { text: string; highlight?: string }) {
  const at = highlight ? text.indexOf(highlight) : -1;
  if (!highlight || at < 0) return <h1 className="vdnd-home-hero__title">{text}</h1>;
  return (
    <h1 className="vdnd-home-hero__title">
      {text.slice(0, at)}
      <span className="vdnd-home-hero__highlight">{highlight}</span>
      {text.slice(at + highlight.length)}
    </h1>
  );
}

function InstallCommand({ command }: { command: string }) {
  const [copied, copy] = useCopyText();
  return (
    <div className="vdnd-home-install">
      <span className="vdnd-home-install__prompt" aria-hidden="true">
        $
      </span>
      <code className="vdnd-home-install__command">{command}</code>
      <button
        type="button"
        className="vdnd-home-install__copy"
        aria-label={copied ? 'Copied' : 'Copy install command'}
        onClick={() => copy(command)}
      >
        {copied ? <IconCheck /> : <IconCopy />}
      </button>
    </div>
  );
}

/** Rendered rows of the hero list; the dragged row (Task 43) is the preview. */
const HERO_ROWS = [41, 42, 44, 45];
/** Slot index at rest: Task 43's own place, mid-drag. */
const HERO_REST = 2;
/** The four scripted moves (slot indexes), one every --dur-scene. */
const HERO_MOVES = [HERO_REST + 1, HERO_REST + 2, HERO_REST + 1, HERO_REST];
/** --dur-scene. */
const HERO_STEP_MS = 800;

/**
 * The hero's scripted drag (Night's `mountBacklog`): four moves of the slot, 800ms apart, when
 * the art scrolls into view; replayed on hover; stopped (back at rest) when the tab hides; never
 * under reduced motion. Rows sit on `--i` indexes and CSS moves them with transform only.
 */
function useBacklogScript(root: RefObject<HTMLElement | null>): {
  slot: number;
  live: boolean;
} {
  const [slot, setSlot] = useState(HERO_REST);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timers: number[] = [];
    let busy = false;
    let seen = false;

    const stop = (): void => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers = [];
      busy = false;
      setSlot(HERO_REST);
    };

    const play = (): void => {
      if (busy || reducedMotion.matches || document.hidden) return;
      busy = true;
      setLive(true);
      HERO_MOVES.forEach((index, step) => {
        timers.push(
          window.setTimeout(
            () => setSlot(Math.min(index, HERO_ROWS.length)),
            HERO_STEP_MS * (step + 1),
          ),
        );
      });
      timers.push(
        window.setTimeout(
          () => {
            busy = false;
          },
          HERO_STEP_MS * (HERO_MOVES.length + 1),
        ),
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (seen || !entries.some((entry) => entry.isIntersecting)) return;
        seen = true;
        play();
      },
      { threshold: 0.5 },
    );
    observer.observe(el);

    const onVisibilityChange = (): void => {
      if (document.hidden) stop();
    };
    const onPointerEnter = (): void => {
      if (seen) play();
    };
    const onReducedMotionChange = (): void => {
      if (reducedMotion.matches) stop();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    el.addEventListener('pointerenter', onPointerEnter);
    reducedMotion.addEventListener('change', onReducedMotionChange);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      el.removeEventListener('pointerenter', onPointerEnter);
      reducedMotion.removeEventListener('change', onReducedMotionChange);
    };
  }, [root]);

  return { slot, live };
}

/**
 * The Backlog art: a virtual list mid-drag. Rendered rows in the panel, virtual rows outside
 * it, Task 43 lifted over its slot. Decorative (`aria-hidden`).
 */
function HeroIllustration() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { slot, live } = useBacklogScript(rootRef);
  const index = (style: number): CSSProperties => ({ '--i': style }) as CSSProperties;
  const virtualRow = (n: number) => (
    <div key={n} className="vdnd-hero-art__virtual">
      Task {n}
      <span className="vdnd-hero-art__virtual-tag">virtual</span>
    </div>
  );
  return (
    <div
      ref={rootRef}
      className={`vdnd-hero-art${live ? ' vdnd-hero-art--live' : ''}`}
      aria-hidden="true"
    >
      <div className="vdnd-hero-art__stage">
        <div className="vdnd-hero-art__virtuals vdnd-hero-art__virtuals--top">
          {[39, 40].map(virtualRow)}
        </div>
        <div className="vdnd-hero-art__list">
          <div className="vdnd-hero-art__head">
            <span className="vdnd-hero-art__name">Backlog</span>
            <span className="vdnd-hero-art__count">1,000 items</span>
            <span className="vdnd-hero-art__count">
              <i className="vdnd-hero-art__dot" />5 in the DOM
            </span>
          </div>
          <div className="vdnd-hero-art__rows">
            {HERO_ROWS.map((n, k) => (
              <div key={n} className="vdnd-hero-art__row" style={index(k < slot ? k : k + 1)}>
                <IconGrip size={16} />
                <span>Task {n}</span>
              </div>
            ))}
            <div className="vdnd-hero-art__placeholder" style={index(slot)} />
            <div className="vdnd-hero-art__preview" style={index(slot)}>
              <IconGrip size={16} />
              <span>Task 43</span>
              <svg className="vdnd-hero-art__cursor" viewBox="0 0 24 24">
                <path d="M4.5 2.5l14.8 9.1-6.5 1.3 3.7 6.7-2.6 1.4-3.7-6.7-5.1 4.6z" />
              </svg>
            </div>
          </div>
        </div>
        <div className="vdnd-hero-art__virtuals vdnd-hero-art__virtuals--bottom">
          {[46, 47].map(virtualRow)}
        </div>
      </div>
    </div>
  );
}

/**
 * Home page (`pageType: home`): hero with a list illustration, feature cards, then the page's
 * own MDX content (the "Quick look" section in index.mdx) and the footer.
 */
export function HomeLayout(props: HomeLayoutProps) {
  const { frontmatter } = useFrontmatter();
  const hero = (frontmatter.hero ?? {}) as HomeHero;
  const features = (frontmatter.features ?? []) as HomeFeature[];

  // Markdown output (llms.txt, "Copy Markdown"): Rspress's hero and features, then the content.
  if (import.meta.env.SSG_MD) {
    return (
      <>
        <OriginalHomeLayout {...props} />
        <DocContent components={undefined} />
      </>
    );
  }

  return (
    <div className="vdnd-home">
      <HomeBackground />
      {props.beforeHero}
      <section className="vdnd-home-hero">
        <div className="vdnd-home-hero__inner">
          <div className="vdnd-home-hero__text">
            {hero.announcement && (
              <Link className="vdnd-home-announce" href={hero.announcement.link}>
                <span className="vdnd-home-announce__badge">{hero.announcement.badge}</span>
                <span className="vdnd-home-announce__text">{hero.announcement.text}</span>
                <IconArrowRight size={15} />
              </Link>
            )}
            {hero.name && <p className="vdnd-home-hero__name">{hero.name}</p>}
            {hero.text && <HeroTitle text={hero.text} highlight={hero.highlight} />}
            {hero.tagline && <p className="vdnd-home-hero__tagline">{hero.tagline}</p>}
            {props.beforeHeroActions}
            {hero.actions?.length ? (
              <div className="vdnd-home-hero__actions">
                {hero.actions.map((action) => (
                  <Link
                    key={action.link}
                    href={action.link}
                    className={`vdnd-home-button vdnd-home-button--${action.theme}`}
                  >
                    {action.text}
                    {isExternal(action.link) ? (
                      <IconExternal size={16} />
                    ) : (
                      <IconArrowRight size={16} />
                    )}
                  </Link>
                ))}
              </div>
            ) : null}
            {hero.install && <InstallCommand command={hero.install} />}
            {props.afterHeroActions}
          </div>
          <HeroIllustration />
        </div>
      </section>
      {props.afterHero}
      {props.beforeFeatures}
      {features.length > 0 && (
        <section className="vdnd-home-features" aria-label="Features">
          <div className="vdnd-home-features__grid">
            {features.map((feature) => {
              const Icon = feature.glyph ? FEATURE_ICONS[feature.glyph] : undefined;
              return (
                <article key={feature.title} className="vdnd-home-feature">
                  {Icon && (
                    <div className="vdnd-home-feature__icon">
                      <Icon size={20} />
                    </div>
                  )}
                  <h2 className="vdnd-home-feature__title">{feature.title}</h2>
                  <p className="vdnd-home-feature__details">{feature.details}</p>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {props.afterFeatures}
      <section className="vdnd-home-content">
        <div className="vdnd-home-content__inner">
          <DocContent components={undefined} />
        </div>
      </section>
      <HomeFooter />
    </div>
  );
}
