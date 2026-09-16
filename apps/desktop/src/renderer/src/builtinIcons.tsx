import type { ReactNode } from 'react';

/** 内置图标：24x24 线性图标，统一用 stroke 绘制，便于跟随主题色 */
const GLYPHS: Record<string, ReactNode> = {
  'stand-up': (
    <>
      <circle cx="12" cy="4.6" r="2.1" />
      <path d="M12 7.4v6.2M12 9.2 8.4 11.6M12 9.2l3.6 2.4M12 13.6 9.2 20M12 13.6l2.8 6.4" />
    </>
  ),
  water: (
    <>
      <path d="M6.4 7h11.2l-1.1 12.2a1.4 1.4 0 0 1-1.4 1.3H8.9a1.4 1.4 0 0 1-1.4-1.3z" />
      <path d="M8 12.4c1.2-1 2.4-1 3.6 0s2.4 1 3.6 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2.4 12S6 6.2 12 6.2 21.6 12 21.6 12 18 17.8 12 17.8 2.4 12 2.4 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  tomato: (
    <>
      <circle cx="12" cy="13.6" r="6.8" />
      <path d="M9.2 6.6c1.2-2 4.4-2 5.6 0M12 6.8V9" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.4 2.2" />
    </>
  ),
  pill: (
    <>
      <path d="M9 15.4 15.4 9a3.4 3.4 0 0 1 4.8 4.8L13.8 20.2A3.4 3.4 0 0 1 9 15.4z" />
      <path d="M12.2 12.2 16 16" />
    </>
  ),
};

export interface BuiltinIconOption {
  name: string;
  label: string;
}

export const BUILTIN_ICONS: BuiltinIconOption[] = [
  { name: 'stand-up', label: '站立' },
  { name: 'water', label: '喝水' },
  { name: 'eye', label: '护眼' },
  { name: 'tomato', label: '番茄钟' },
  { name: 'clock', label: '时钟' },
  { name: 'pill', label: '服药' },
];

export function BuiltinIcon({
  name,
  size = 22,
  color = 'currentColor',
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  const glyph = GLYPHS[name] ?? GLYPHS.clock;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {glyph}
    </svg>
  );
}
