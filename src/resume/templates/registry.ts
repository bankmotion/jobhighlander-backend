import type { ComponentType } from 'react';
import { ClassicLayout, CLASSIC_CSS } from '../layouts/classic';
import { ModernLayout, MODERN_CSS } from '../layouts/modern';
import { ProfessionalLayout, PROFESSIONAL_CSS } from '../layouts/professional';
import { CreativeLayout, CREATIVE_CSS } from '../layouts/creative';
import type { TemplateProps } from '../layouts/types';

export type { TemplateProps };

export type PageSize = 'letter' | 'a4';

export const PAGE_PX: Record<PageSize, { width: number; height: number; css: string }> = {
  letter: { width: 816, height: 1056, css: 'letter' }, //  8.5 x 11 in
  a4: { width: 794, height: 1123, css: 'A4' }, //         210 x 297 mm
};

export const LAYOUTS = {
  classic: { name: 'Classic', Component: ClassicLayout, css: CLASSIC_CSS },
  modern: { name: 'Modern', Component: ModernLayout, css: MODERN_CSS },
  professional: { name: 'Professional', Component: ProfessionalLayout, css: PROFESSIONAL_CSS },
  // Two-column: extraction follows page geometry, so the sidebar is always
  // read before the experience. Presets here must set atsSafe: false.
  creative: { name: 'Creative', Component: CreativeLayout, css: CREATIVE_CSS },
} satisfies Record<string, { name: string; Component: ComponentType<TemplateProps>; css: string }>;

export type LayoutKey = keyof typeof LAYOUTS;
export const DEFAULT_LAYOUT: LayoutKey = 'classic';

export function getLayout(key: string | null | undefined) {
  return LAYOUTS[(key ?? '') as LayoutKey] ?? LAYOUTS[DEFAULT_LAYOUT];
}

export interface Preset {
  key: string;
  name: string;
  category: string;
  layout: string;
  accent: string;
  fontPair: string;
  density: string;
  atsSafe: boolean;
}

export const FALLBACK_PRESET: Preset = {
  key: 'classic-ink',
  name: 'Classic Ink',
  category: 'classic',
  layout: 'classic',
  accent: '#111111',
  fontPair: 'serif-classic',
  density: 'regular',
  atsSafe: true,
};
