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
  return <OriginalLayout afterNavTitle={<VersionBadge />} />;
}
