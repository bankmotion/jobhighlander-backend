
export interface FontPair {
  name: string;
  display: string;
  body: string;
}

export const FONT_PAIRS = {
  'serif-classic': {
    name: 'Georgia / Georgia',
    display: 'Georgia, "Times New Roman", serif',
    body: 'Georgia, "Times New Roman", serif',
  },
  'serif-sans': {
    name: 'Georgia / Helvetica',
    display: 'Georgia, "Times New Roman", serif',
    body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  'sans-modern': {
    name: 'Helvetica / Helvetica',
    display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  'sans-humanist': {
    name: 'Segoe UI / Segoe UI',
    display: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    body: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
  },
  'slab-sans': {
    name: 'Palatino / Helvetica',
    display: '"Palatino Linotype", Palatino, "Book Antiqua", serif',
    body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  },
} as const satisfies Record<string, FontPair>;

export type FontPairKey = keyof typeof FONT_PAIRS;
export const DEFAULT_FONT_PAIR: FontPairKey = 'serif-classic';

export interface Density {
  name: string;
  fontSize: number;
  lineHeight: number;
  pad: number;
  sectionGap: number;
  entryGap: number;
}

export const DENSITIES = {
  compact: { name: 'Compact', fontSize: 9.5, lineHeight: 1.3, pad: 42, sectionGap: 10, entryGap: 7 },
  regular: { name: 'Regular', fontSize: 10.5, lineHeight: 1.4, pad: 54, sectionGap: 14, entryGap: 10 },
  airy: { name: 'Airy', fontSize: 11, lineHeight: 1.5, pad: 66, sectionGap: 18, entryGap: 14 },
} as const satisfies Record<string, Density>;

export type DensityKey = keyof typeof DENSITIES;
export const DEFAULT_DENSITY: DensityKey = 'regular';

export const ACCENTS = {
  ink: '#111111',
  navy: '#1e3a5f',
  pine: '#1f5f5b',
  burgundy: '#6b2131',
  slate: '#3f4a56',
  bronze: '#7a5326',
} as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export interface ResolvedTokens {
  fonts: FontPair;
  density: Density;
  accent: string;
}

export function resolveTokens(preset: {
  fontPair?: string | null;
  density?: string | null;
  accent?: string | null;
}): ResolvedTokens {
  const fonts = FONT_PAIRS[(preset.fontPair ?? '') as FontPairKey] ?? FONT_PAIRS[DEFAULT_FONT_PAIR];
  const density = DENSITIES[(preset.density ?? '') as DensityKey] ?? DENSITIES[DEFAULT_DENSITY];
  // A non-hex accent would be interpolated straight into a stylesheet, so it is
  // validated rather than trusted — the one place a DB row touches CSS.
  const accent = preset.accent && HEX.test(preset.accent) ? preset.accent : ACCENTS.ink;
  return { fonts, density, accent };
}

export function tokensToCss({ fonts, density, accent }: ResolvedTokens): string {
  return `
    --font-display: ${fonts.display};
    --font-body: ${fonts.body};
    --accent: ${accent};
    --size-body: ${density.fontSize}pt;
    --line-height: ${density.lineHeight};
    --pad: ${density.pad}px;
    --section-gap: ${density.sectionGap}px;
    --entry-gap: ${density.entryGap}px;
  `.trim();
}
