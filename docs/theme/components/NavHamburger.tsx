import { SocialLinks } from '@rspress/core/theme-original';
import {
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
// The replaced component's parts and styles.
import type { NavItemsSlots } from '@rspress/core/dist/theme/components/Nav/index.js';
import { NavVersions } from '@rspress/core/dist/theme/components/Nav/NavMenu.js';
import { useNavScreen } from '@rspress/core/dist/theme/components/NavHamburger/useNavScreen.js';
import '@rspress/core/dist/theme/components/NavHamburger/index.css';
import {
  NavScreen,
  NavScreenDivider,
} from '@rspress/core/dist/theme/components/NavScreen/index.js';
import { NavScreenAppearance } from '@rspress/core/dist/theme/components/NavScreen/NavScreenAppearance.js';
import { NavScreenLangs } from '@rspress/core/dist/theme/components/NavScreen/NavScreenLangs.js';
import { NightIconMenu } from './icons';

const MENU_ID = 'vdnd-nav-more';
/** Rspress's delay before a dropdown closes when the pointer leaves it. */
const CLOSE_DELAY_MS = 150;

/**
 * Rspress's nav hamburger, with the tablet menu (769–1280px: the theme switch and GitHub, which
 * the bar shows from 1281px) rebuilt beside its button instead of inside it: a button must not
 * contain controls (React warns, and screen readers skip them). It opens on hover as before, and
 * from the keyboard: the button toggles it (aria-expanded), Escape closes it, and focus leaving
 * it closes it. Phones (≤768px) keep Rspress's full-screen menu.
 */
export function NavHamburger(props: NavItemsSlots) {
  const { isScreenOpen, toggleScreen } = useNavScreen();
  const [isMenuOpen, setMenuOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const hovered = useRef(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Rspress's portal target for the phone menu (rendered only while it is open, on the client).
  const modalContainer = isScreenOpen ? document.getElementById('__rspress_modal_container') : null;

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const openMenu = (): void => {
    window.clearTimeout(closeTimer.current);
    setMenuOpen(true);
  };
  const onMenuPointerEnter = (): void => {
    hovered.current = true;
    openMenu();
  };
  const onMenuPointerLeave = (): void => {
    hovered.current = false;
    closeTimer.current = window.setTimeout(() => setMenuOpen(false), CLOSE_DELAY_MS);
  };
  // A pointer click keeps the hover-opened menu open; Enter or Space (no clicks) toggles it.
  const onMenuButtonClick = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.detail > 0) openMenu();
    else setMenuOpen((open) => !open);
  };
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || !isMenuOpen) return;
    setMenuOpen(false);
    menuButton.current?.focus();
  };
  // Focus leaving the menu closes it, unless the pointer is on it (Safari doesn't focus a clicked
  // button, so a click inside would otherwise read as focus leaving).
  const onMenuBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (hovered.current || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setMenuOpen(false);
  };

  return (
    <>
      {modalContainer &&
        createPortal(
          <NavScreen {...props} isScreenOpen={isScreenOpen} toggleScreen={toggleScreen} />,
          modalContainer,
        )}
      <button
        type="button"
        aria-label="Site menu"
        aria-expanded={isScreenOpen}
        className={`rp-nav-hamburger rp-nav-hamburger__sm${isScreenOpen ? ' rp-nav-hamburger--active' : ''}`}
        onClick={toggleScreen}
      >
        <NightIconMenu width={20} height={20} />
      </button>
      <div
        className="vdnd-nav-more"
        onMouseEnter={onMenuPointerEnter}
        onMouseLeave={onMenuPointerLeave}
        onKeyDown={onMenuKeyDown}
        onBlur={onMenuBlur}
      >
        <button
          ref={menuButton}
          type="button"
          aria-label="More"
          aria-expanded={isMenuOpen}
          aria-controls={MENU_ID}
          className={`rp-nav-hamburger rp-nav-hamburger__md${isMenuOpen ? ' rp-nav-hamburger--active' : ''}`}
          onClick={onMenuButtonClick}
        >
          <NightIconMenu />
        </button>
        <div
          id={MENU_ID}
          className={`rp-hover-group rp-hover-group--right${isMenuOpen ? '' : ' rp-hover-group--hidden'}`}
        >
          <div className="rp-nav-hamburger__md__hover-group">
            <NavScreenAppearance />
            <NavVersions />
            <NavScreenLangs />
            <NavScreenDivider />
            <SocialLinks />
          </div>
        </div>
      </div>
    </>
  );
}
