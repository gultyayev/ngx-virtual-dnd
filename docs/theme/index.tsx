import { Head } from '@rspress/core/runtime';
import { Link, Layout as OriginalLayout } from '@rspress/core/theme-original';
import './index.css';

export * from '@rspress/core/theme-original';
// Named exports replace the wildcard's components of the same name.
export { Callout } from './components/Callout';
export { CodeBlock } from './components/CodeBlock';
export { HomeLayout } from './components/HomeLayout';

declare const process: { env: { VDND_VERSION: string } };

/**
 * The nav lockup: the Night mark inline (its colors come from the tokens through index.css, which
 * an <img> logo can't do) and the wordmark. Same classes as Rspress's NavTitle.
 */
function NavTitle() {
  return (
    <div className="rp-nav__title">
      <Link href="/" className="rp-nav__title__link">
        <svg className="vdnd-mark" viewBox="0 0 24 24" aria-hidden="true">
          <rect className="vdnd-mark__ghost" x="5" y="1" width="14" height="2" rx="1" />
          <rect className="vdnd-mark__row" x="5" y="8.75" width="14" height="2.5" rx="1.1" />
          <rect className="vdnd-mark__held" x="8" y="12.75" width="14" height="2.5" rx="1.1" />
          <rect className="vdnd-mark__ghost" x="5" y="21" width="14" height="2" rx="1" />
          <rect className="vdnd-mark__frame" x="2" y="5.5" width="20" height="13" rx="3" />
        </svg>
        <span>ngx-virtual-dnd</span>
      </Link>
    </div>
  );
}

function VersionBadge() {
  return (
    <a
      className="vdnd-version-badge"
      href="https://www.npmjs.com/package/ngx-virtual-dnd"
      target="_blank"
      rel="noreferrer"
      title="ngx-virtual-dnd on npm"
    >
      v{process.env.VDND_VERSION}
    </a>
  );
}

export function Layout() {
  return (
    <>
      {/* Edge-to-edge: the page draws under the status bar, notch and home indicator, and
          index.css pads the UI with env(safe-area-inset-*). Set here, not in the config's `head`:
          Rspress's head manager dedupes by name and would keep its default viewport tag. */}
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <OriginalLayout navTitle={<NavTitle />} afterNavTitle={<VersionBadge />} />
    </>
  );
}
