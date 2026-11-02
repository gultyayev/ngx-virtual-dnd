import type { ReactNode, SVGProps } from 'react';

/**
 * Night's icon set (its bundle.js), copied path for path: stroke icons on a 24px grid, 1.75px
 * stroke, round caps and joins, in currentColor.
 */
function StrokeIcon({
  size = 16,
  children,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

export const IconArrowRight = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </StrokeIcon>
);

export const IconExternal = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M7 17L17 7M9 7h8v8" />
  </StrokeIcon>
);

export const IconCopy = (props: IconProps) => (
  <StrokeIcon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </StrokeIcon>
);

export const IconCheck = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </StrokeIcon>
);

export const IconFile = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </StrokeIcon>
);

export const IconBulb = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" />
  </StrokeIcon>
);

/** Night's `alert`: warnings. */
export const IconWarning = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M12 3.5l9.5 16.5h-19z" />
    <path d="M12 10v4M12 17h.01" />
  </StrokeIcon>
);

/** Night's `octagon`: danger. */
export const IconDanger = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z" />
    <path d="M12 8v5M12 16h.01" />
  </StrokeIcon>
);

export const IconInfo = (props: IconProps) => (
  <StrokeIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </StrokeIcon>
);

/** Feature icons on the home page, picked by a feature's `glyph` in index.mdx. */
export const FEATURE_ICONS: Record<string, (props: IconProps) => ReactNode> = {
  viewport: (props) => (
    <StrokeIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M7 9.5h9M9.5 14.5h9" />
    </StrokeIcon>
  ),
  heights: (props) => (
    <StrokeIcon {...props}>
      <rect x="4" y="3.5" width="16" height="5" rx="1.5" />
      <rect x="4" y="11" width="16" height="9.5" rx="1.5" />
    </StrokeIcon>
  ),
  columns: (props) => (
    <StrokeIcon {...props}>
      <rect x="3" y="4" width="7.5" height="16" rx="2" />
      <rect x="13.5" y="4" width="7.5" height="10" rx="2" />
    </StrokeIcon>
  ),
  keyboard: (props) => (
    <StrokeIcon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" />
    </StrokeIcon>
  ),
  signal: (props) => (
    <StrokeIcon {...props}>
      <path d="M3 12h4l3-7 4 14 3-7h4" />
    </StrokeIcon>
  ),
  book: (props) => (
    <StrokeIcon {...props}>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5z" />
      <path d="M5 18.5A1.5 1.5 0 0 0 6.5 20H19" />
      <path d="M9 7.5h6" />
    </StrokeIcon>
  ),
};

/** The six-dot grip (filled dots, like the demo's). */
export const IconGrip = (props: IconProps) => {
  const { size = 16, ...rest } = props;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  );
};

/*
 * Replacements for Rspress's built-in icons (re-exported by name from theme/index.tsx), so the
 * nav, search, outline actions and code buttons use Night's set instead of filled glyphs. They
 * take the props Rspress passes (class names, sizes); 1em defaults follow the surrounding text.
 */
type RspressIconProps = SVGProps<SVGSVGElement>;

/** Takes Rspress's sizes and class names; the stroke style is fixed (Rspress passes
 * `fill="currentColor"` to some icons, which would fill these). */
function NightIcon({ children, ...props }: RspressIconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      aria-hidden="true"
      focusable="false"
      {...props}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const NightIconMoon = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M20.5 13.4A8.5 8.5 0 1 1 10.6 3.5a6.6 6.6 0 0 0 9.9 9.9z" />
  </NightIcon>
);

export const NightIconSun = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2.5 12h2M19.5 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </NightIcon>
);

export const NightIconGithub = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5a3 3 0 0 0-.9-2.4c2.9-.3 6-1.4 6-6.5a5 5 0 0 0-1.4-3.5 4.7 4.7 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.4 12.4 0 0 0-6.5 0C6 1.8 4.9 2.1 4.9 2.1a4.7 4.7 0 0 0-.1 3.5A5 5 0 0 0 3.4 9.1c0 5.1 3.1 6.2 6 6.5a3 3 0 0 0-.9 2.4V21" />
  </NightIcon>
);

export const NightIconSearch = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </NightIcon>
);

export const NightIconCopy = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </NightIcon>
);

export const NightIconCheck = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </NightIcon>
);

export const NightIconPencil = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
    <path d="M13.5 6.5l4 4" />
  </NightIcon>
);

export const NightIconMessage = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </NightIcon>
);

export const NightIconExternal = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M7 17L17 7M9 7h8v8" />
  </NightIcon>
);

export const NightIconFile = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </NightIcon>
);

/** A heading result in search: a hash, drawn like the set. */
export const NightIconHash = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M9.5 4L8 20M16 4l-1.5 16M4.5 9h15M3.5 15h15" />
  </NightIcon>
);

/** A text result in search: a file with lines. */
export const NightIconFileText = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </NightIcon>
);

/** Enter (open the current result). */
export const NightIconEnter = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M19 5v7a3 3 0 0 1-3 3H6M10 11l-4 4 4 4" />
  </NightIcon>
);

/** Chevrons: Night's `chevron` (down) and the same turned right. */
export const NightIconChevronDown = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M6 9l6 6 6-6" />
  </NightIcon>
);

export const NightIconChevronRight = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M9 6l6 6-6 6" />
  </NightIcon>
);

/** Menu and close, as the demo's top bar draws them. */
export const NightIconMenu = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </NightIcon>
);

export const NightIconClose = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </NightIcon>
);

/** Code wrapping off (lines run on) and on (lines fold back). */
export const NightIconWrap = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M4 6h16M4 12h16M4 18h8" />
  </NightIcon>
);

export const NightIconWrapped = (props: RspressIconProps) => (
  <NightIcon {...props}>
    <path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M4 18h5M15 16l-2 2 2 2" />
  </NightIcon>
);
