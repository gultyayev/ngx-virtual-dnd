import { usePageData } from '@rspress/core/runtime';
import { Link } from '@rspress/core/theme-original';
import { IconArrowRight } from './icons';

/**
 * The 404 page on Night: a mono kicker, the title (`type-title-1`), a lead in --ink-muted and
 * two actions (primary and secondary buttons). Replaces Rspress's NotFoundLayout, whose
 * uppercase title and outlined pill button are not part of the system.
 */
export function NotFoundLayout() {
  const { siteData } = usePageData();
  // As in Rspress's own 404: a path under the default language's prefix (/en/…) goes to the
  // page without it.
  const defaultLang = siteData.lang;
  if (defaultLang && typeof window !== 'undefined') {
    const prefix = new RegExp(`/${defaultLang}(\\/|$)`);
    if (prefix.test(location.pathname)) {
      window.location.replace(location.pathname.replace(prefix, '/'));
      return null;
    }
  }

  return (
    <div className="vdnd-not-found">
      <p className="vdnd-not-found__code">404</p>
      <h1 className="vdnd-not-found__title">Page not found</h1>
      <p className="vdnd-not-found__lead">
        There is no page at this address. It may have moved, or the link may be wrong.
      </p>
      <div className="vdnd-not-found__actions">
        <Link href="/" className="vdnd-home-button vdnd-home-button--brand">
          Go to the home page
          <IconArrowRight size={16} />
        </Link>
        <Link href="/guide/start/introduction" className="vdnd-home-button vdnd-home-button--alt">
          Read the guide
        </Link>
      </div>
    </div>
  );
}
