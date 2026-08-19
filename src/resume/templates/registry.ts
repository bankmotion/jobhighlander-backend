import type { ComponentType } from 'react';
import { ClassicLayout, CLASSIC_CSS } from '../layouts/classic';
import { ModernLayout, MODERN_CSS } from '../layouts/modern';
import { ProfessionalLayout, PROFESSIONAL_CSS } from '../layouts/professional';
import { CreativeLayout, CREATIVE_CSS } from '../layouts/creative';
import type { TemplateProps } from '../layouts/types';

export type { TemplateProps };

export type PageSize = 'letter' | 'a4';

/** Page geometry at 96 DPI — the resolution Chrome lays out at. */
export const PAGE_PX: Record<PageSize, { width: number; height: number; css: string }> = {
  letter: { width: 816, height: 1056, css: 'letter' }, //  8.5 x 11 in
  a4: { width: 794, height: 1123, css: 'A4' }, //         210 x 297 mm
};

/**
 * The compiled layouts. This map is the whole reason preset rows are safe to
 * store: a preset names a layout by KEY, and anything not in this map falls
 * back to the default. A database row can never introduce a new renderer.
 */
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

/** Shape a preset takes once resolved, whether it came from the DB or the seed. */
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

/**
 * Fallback used when the presets table is empty or a referenced key is gone.
 * Keeping one in code means a fresh clone renders before it is seeded, and a
 * deleted row never leaves a profile unable to produce a resume.
 */
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
