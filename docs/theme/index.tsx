import { Head } from '@rspress/core/runtime';
import { Layout as OriginalLayout } from '@rspress/core/theme-original';
import './index.css';

export * from '@rspress/core/theme-original';

declare const process: { env: { VDND_VERSION: string } };

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
      <OriginalLayout afterNavTitle={<VersionBadge />} />
    </>
  );
}
