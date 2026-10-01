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

/** A virtual list mid-drag: rendered rows in the card, virtual rows outside it, Task 43 lifted. */
function HeroIllustration() {
  const row = (n: number) => (
    <div key={n} className="vdnd-hero-art__row">
      <IconGrip />
      <span>Task {n}</span>
    </div>
  );
  const virtualRow = (n: number) => (
    <div key={n} className="vdnd-hero-art__virtual">
      <span>Task {n}</span>
      <span className="vdnd-hero-art__virtual-tag">Virtual</span>
    </div>
  );
  return (
    <div className="vdnd-hero-art" aria-hidden="true">
      <div className="vdnd-hero-art__virtuals">{[39, 40].map(virtualRow)}</div>
      <div className="vdnd-hero-art__list">
        <div className="vdnd-hero-art__head">
          <span className="vdnd-hero-art__name">Backlog</span>
          <span className="vdnd-hero-art__count">1,000 items · 5 in the DOM</span>
        </div>
        {[41, 42].map(row)}
        <div className="vdnd-hero-art__placeholder" />
        {[44, 45].map(row)}
      </div>
      <div className="vdnd-hero-art__virtuals">{[46, 47].map(virtualRow)}</div>
      <div className="vdnd-hero-art__preview">
        <IconGrip />
        <span>Task 43</span>
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
                <IconArrowRight size={14} />
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
                      <IconExternal size={14} />
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
