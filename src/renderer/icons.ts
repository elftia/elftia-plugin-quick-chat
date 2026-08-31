import * as React from 'react';
import type { ReactElement, ReactNode } from 'react';

interface IconProps {
  readonly className?: string;
}

function icon(className: string | undefined, children: readonly ReactNode[]): ReactElement {
  return React.createElement(
    'svg',
    {
      'aria-hidden': true,
      className,
      fill: 'none',
      focusable: false,
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: 2,
      viewBox: '0 0 24 24',
    },
    ...children
  );
}

export function BotIcon({ className }: IconProps): ReactElement {
  const h = React.createElement;
  return icon(className, [
    h('path', { key: 'antenna', d: 'M12 8V4H8' }),
    h('rect', { key: 'body', x: 4, y: 8, width: 16, height: 12, rx: 2 }),
    h('path', { key: 'left-ear', d: 'M2 14h2' }),
    h('path', { key: 'right-ear', d: 'M20 14h2' }),
    h('path', { key: 'right-eye', d: 'M15 13v2' }),
    h('path', { key: 'left-eye', d: 'M9 13v2' }),
  ]);
}

export function UserIcon({ className }: IconProps): ReactElement {
  const h = React.createElement;
  return icon(className, [
    h('path', { key: 'shoulders', d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }),
    h('circle', { key: 'head', cx: 12, cy: 7, r: 4 }),
  ]);
}

export function SendIcon({ className }: IconProps): ReactElement {
  const h = React.createElement;
  return icon(className, [
    h('path', { key: 'arrow', d: 'm5 12 7-7 7 7' }),
    h('path', { key: 'stem', d: 'M12 19V5' }),
  ]);
}

export function StopIcon({ className }: IconProps): ReactElement {
  return icon(className, [
    React.createElement('rect', { key: 'stop', x: 3, y: 3, width: 18, height: 18, rx: 2 }),
  ]);
}

export function CloseIcon({ className }: IconProps): ReactElement {
  const h = React.createElement;
  return icon(className, [
    h('path', { key: 'one', d: 'M18 6 6 18' }),
    h('path', { key: 'two', d: 'm6 6 12 12' }),
  ]);
}

export function RetryIcon({ className }: IconProps): ReactElement {
  const h = React.createElement;
  return icon(className, [
    h('path', { key: 'loop', d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
    h('path', { key: 'arrow', d: 'M3 3v5h5' }),
  ]);
}
