import { Callout as OriginalCallout, type CalloutProps } from '@rspress/core/theme-original';
import type { ReactNode } from 'react';
import { IconBulb, IconDanger, IconInfo, IconWarning } from './icons';

const ICONS: Partial<Record<CalloutProps['type'], (props: { size?: number }) => ReactNode>> = {
  tip: IconBulb,
  note: IconInfo,
  info: IconInfo,
  important: IconInfo,
  warning: IconWarning,
  caution: IconWarning,
  danger: IconDanger,
};

/** Rspress's callout (`:::tip` …) with an icon before the title. `details` stays as it is. */
export function Callout({ type, title, children }: CalloutProps) {
  const Icon = ICONS[type];
  if (!Icon || import.meta.env.SSG_MD) {
    return (
      <OriginalCallout type={type} title={title}>
        {children}
      </OriginalCallout>
    );
  }
  return (
    <div className={`rp-callout rp-callout--${type}`}>
      <div className="rp-callout__title">
        <Icon size={16} />
        <span>{title ?? type.charAt(0).toUpperCase() + type.slice(1)}</span>
      </div>
      <div className="rp-callout__content">{children}</div>
    </div>
  );
}

export default Callout;
