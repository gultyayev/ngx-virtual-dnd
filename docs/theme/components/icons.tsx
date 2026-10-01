import type { ReactNode, SVGProps } from 'react';

/** Stroke icons on a 24px grid (design system: stroke-width 2, currentColor). */
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
      strokeWidth={2}
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
    <path d="M7 17L17 7M8 7h9v9" />
  </StrokeIcon>
);

export const IconCopy = (props: IconProps) => (
  <StrokeIcon {...props}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </StrokeIcon>
);

export const IconCheck = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </StrokeIcon>
);

export const IconFile = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </StrokeIcon>
);

export const IconBulb = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M9 18h6M10 22h4" />
    <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
  </StrokeIcon>
);

export const IconWarning = (props: IconProps) => (
  <StrokeIcon {...props}>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </StrokeIcon>
);

export const IconDanger = (props: IconProps) => (
  <StrokeIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5M12 16.5h.01" />
  </StrokeIcon>
);

export const IconInfo = (props: IconProps) => (
  <StrokeIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </StrokeIcon>
);

/** Feature icons on the home page, picked by a feature's `glyph` in index.mdx. */
export const FEATURE_ICONS: Record<string, (props: IconProps) => ReactNode> = {
  'virtual-list': (props) => (
    <StrokeIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="M7 10h10M7 14h6M8 2h8M8 22h8" />
    </StrokeIcon>
  ),
  heights: (props) => (
    <StrokeIcon {...props}>
      <path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4" />
    </StrokeIcon>
  ),
  lists: (props) => (
    <StrokeIcon {...props}>
      <rect x="3" y="4" width="7" height="16" rx="2" />
      <rect x="14" y="4" width="7" height="11" rx="2" />
      <path d="M10 12h4" />
    </StrokeIcon>
  ),
  keyboard: (props) => (
    <StrokeIcon {...props}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </StrokeIcon>
  ),
  signals: (props) => (
    <StrokeIcon {...props}>
      <path d="M2 12h4l3-8 6 16 3-8h4" />
    </StrokeIcon>
  ),
  document: (props) => (
    <StrokeIcon {...props}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M8 13h8M8 17h5" />
    </StrokeIcon>
  ),
};

/** The six-dot drag handle (filled, like the demo's). */
export const IconGrip = (props: IconProps) => {
  const { size = 14, ...rest } = props;
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
      <circle cx="9" cy="6" r="1.7" />
      <circle cx="15" cy="6" r="1.7" />
      <circle cx="9" cy="12" r="1.7" />
      <circle cx="15" cy="12" r="1.7" />
      <circle cx="9" cy="18" r="1.7" />
      <circle cx="15" cy="18" r="1.7" />
    </svg>
  );
};
