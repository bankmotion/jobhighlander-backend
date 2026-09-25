/**
 * Decorative page backgrounds for a rendered resume.
 *
 * Three rules shape everything here, and all three come from how the PDF is
 * actually produced:
 *
 * 1. SELF-CONTAINED. `htmlToPdf` loads the document with `domcontentloaded`
 *    and no network, so an external image would render as a blank gap rather
 *    than fail loudly. Every pattern is an inline SVG data URI or a CSS
 *    gradient.
 *
 * 2. PAINTED ON EVERY PAGE. The layouts are one continuous flow that Chromium
 *    paginates, not one element per page, so there is nothing per-page to hang
 *    a background on. A `position: fixed` layer repeats on every printed page,
 *    which is the one technique that survives pagination.
 *
 * 3. BEHIND THE TEXT, NEVER THROUGH IT. The layer sits at `z-index: 0` with the
 *    content raised above it, and every pattern is drawn in light neutral grey
 *    so it reads as paper texture rather than as content. Neutral rather than
 *    accent-coloured on purpose: a data URI cannot read `var(--accent)`, and a
 *    pattern baked in one preset's colour clashes with the other three.
 *
 * ATS extraction is unaffected: these add no text and no elements to the
 * document flow, so a parser reading the PDF sees exactly what it saw before.
 * That is why a background is offered even on presets marked `atsSafe`.
 *
 * To add one: write the SVG (or gradient), add a registry entry. The picker
 * and the request validator both read this list, so there is nothing else to
 * update.
 */

import { RASTER } from './backgrounds.raster';

export type BackgroundCategory = 'plain' | 'dots' | 'geometric' | 'lines' | 'accent';

export interface BackgroundDef {
  key: string;
  /** Shown in the picker. */
  name: string;
  /** One line under the name, so the choice is not made blind from a thumbnail. */
  description: string;
  /** Groups the picker. Plain sorts first. */
  category: BackgroundCategory;
  /** CSS appended after the layout's own rules. Empty for `none`. */
  css: string;
}

/**
 * Wrap a pattern in the fixed layer that makes it repeat across pages.
 *
 * `print-color-adjust: exact` is not optional. Chromium drops backgrounds it
 * judges to be non-essential when printing even with `printBackground: true`,
 * and the result is a preview that shows the pattern and a PDF that does not.
 */
function layer(background: string): string {
  return `
  /* The decorative layer. Fixed, so Chromium repeats it on every page. */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    z-index: 0;
    pointer-events: none;
    ${background}
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Raise the content above the layer. Without this the pattern is painted
     over the text rather than under it. */
  .page { position: relative; z-index: 1; }
`;
}

/**
 * Turn an SVG source into a data URI safe to sit inside `url("...")`.
 *
 * Both halves matter, and skipping either fails the same silent way -- the
 * declaration is dropped and the page renders plain white, with no error
 * anywhere:
 *
 *  - WHITESPACE IS COLLAPSED. These SVGs are written multi-line to stay
 *    readable, and a CSS string cannot contain a raw newline.
 *  - `<`, `>`, `#` AND `"` ARE ENCODED. A bare `"` closes the url() early, and
 *    a bare `#` starts a fragment, truncating the document mid-tag. `#` also
 *    covers the internal `url(#id)` references the gradients and masks use.
 *
 * Verified by rendering: before this, all 21 SVG backgrounds produced a PDF
 * byte-identical to the plain one.
 */
function uri(svg: string): string {
  const compact = svg.replace(/\s+/g, ' ').trim();
  const escaped = compact
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${escaped}`;
}

/**
 * A pattern built from repeating CSS gradients.
 *
 * Strongly preferred over an SVG tile wherever the shape allows it, for one
 * measured reason: Chromium flattens a repeated SVG into one drawing operation
 * per repetition when it prints, while a repeating gradient stays a single
 * fill. On the same three-page resume that is +3 KB against +1,500 KB, and the
 * two are visually indistinguishable.
 *
 * Straight lines at any angle work. Dots do not -- a radial-gradient field
 * measured +345 KB, because every dot is again its own operation.
 */
function grad(image: string, opacity = 1, size?: string): string {
  return `background-image: ${image};
    ${size ? `background-size: ${size};` : ''}
    opacity: ${opacity};`;
}

/** The drawing inside an `<svg>` wrapper, so it can be re-wrapped. */
const inner = (svg: string): string =>
  svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

/**
 * A repeating tile, tiled INSIDE one page-sized SVG.
 *
 * The obvious spelling is CSS `background-repeat: repeat` on a small tile, and
 * it is a trap. Chromium emits a separate draw for every repetition when it
 * prints, so a 56x48 tile over three Letter pages became roughly a thousand
 * draws: the hexagon PDF measured 1.4 MB against 71 KB for the plain page, on
 * a file people attach to job applications.
 *
 * Declaring the repetition as an SVG `<pattern>` instead means one image and
 * one draw, with the tiling resolved inside it. Identical output, and the same
 * PDF came back at a few KB over plain.
 */
function tile(svg: string, w: number, h: number, opacity = 1): string {
  const sheet = `<svg xmlns='http://www.w3.org/2000/svg' width='816' height='1056' viewBox='0 0 816 1056'>
<defs><pattern id='t' width='${w}' height='${h}' patternUnits='userSpaceOnUse'>${inner(svg)}</pattern></defs>
<rect width='816' height='1056' fill='url(#t)'/></svg>`;
  return `background-image: url("${uri(sheet)}");
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 100%;
    opacity: ${opacity};`;
}

/** A single SVG stretched over the whole page. */
function full(svg: string, opacity = 1): string {
  return `background-image: url("${uri(svg)}");
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 100%;
    opacity: ${opacity};`;
}

/** A single SVG pinned to one corner at a fixed size. */
function corner(svg: string, position: string, w: number, h: number, opacity = 1): string {
  return `background-image: url("${uri(svg)}");
    background-repeat: no-repeat;
    background-position: ${position};
    background-size: ${w}px ${h}px;
    opacity: ${opacity};`;
}

// Neutrals used throughout. Written as plain hex; `uri()` escapes them.
const INK = '#a9b6c8'; //   line work
const DOT = '#93a3ba'; //   filled shapes

/* ------------------------------------------------------------------ dots -- */

const PARTICLE_DOTS = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='420' viewBox='0 0 420 420'>
<g stroke='${INK}' stroke-width='0.7' fill='none' opacity='0.55'>
<path d='M40 60 L150 30 L250 95 L360 55'/><path d='M40 60 L95 165 L150 30'/>
<path d='M95 165 L250 95 L205 210 L95 165'/><path d='M205 210 L330 180 L360 55'/>
<path d='M205 210 L120 310 L30 265'/><path d='M120 310 L260 330 L330 180'/>
<path d='M260 330 L370 390'/><path d='M30 265 L95 165'/>
</g>
<g fill='${DOT}' opacity='0.75'>
<circle cx='40' cy='60' r='3.2'/><circle cx='150' cy='30' r='2.4'/>
<circle cx='250' cy='95' r='3.6'/><circle cx='360' cy='55' r='2.6'/>
<circle cx='95' cy='165' r='2.8'/><circle cx='205' cy='210' r='3.4'/>
<circle cx='330' cy='180' r='2.5'/><circle cx='120' cy='310' r='3'/>
<circle cx='30' cy='265' r='2.3'/><circle cx='260' cy='330' r='2.9'/>
<circle cx='370' cy='390' r='2.2'/>
</g></svg>`;

/**
 * A dot field that fades out as it crosses the page.
 *
 * The fade is baked into the SVG with a gradient-driven opacity mask rather
 * than applied in CSS. `mask-image` is the obvious way to write this and it is
 * unreliable through Chromium's print path — the fade silently becomes a hard
 * edge. Inside the SVG it is just geometry, and it renders identically.
 */
const DOT_FLOW = `<svg xmlns='http://www.w3.org/2000/svg' width='816' height='1056' viewBox='0 0 816 1056' preserveAspectRatio='none'>
<defs><pattern id='d' width='18' height='18' patternUnits='userSpaceOnUse'>
<circle cx='2.2' cy='2.2' r='1.5' fill='${DOT}'/></pattern>
<linearGradient id='f' x1='0' y1='0' x2='1' y2='1'>
<stop offset='0' stop-color='white' stop-opacity='0.85'/>
<stop offset='0.45' stop-color='white' stop-opacity='0.18'/>
<stop offset='1' stop-color='white' stop-opacity='0'/></linearGradient>
<mask id='m'><rect width='816' height='1056' fill='url(#f)'/></mask></defs>
<rect width='816' height='1056' fill='url(#d)' mask='url(#m)'/></svg>`;

const DOT_GRID = `<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 20 20'>
<circle cx='2' cy='2' r='1.4' fill='${DOT}'/></svg>`;

const HALFTONE = `<svg xmlns='http://www.w3.org/2000/svg' width='816' height='1056' viewBox='0 0 816 1056' preserveAspectRatio='none'>
<defs><radialGradient id='g' cx='0.08' cy='0.06' r='1'>
<stop offset='0' stop-color='white' stop-opacity='0.9'/>
<stop offset='0.55' stop-color='white' stop-opacity='0.25'/>
<stop offset='1' stop-color='white' stop-opacity='0'/></radialGradient>
<pattern id='p' width='24' height='24' patternUnits='userSpaceOnUse'>
<circle cx='4' cy='4' r='3.2' fill='${DOT}'/></pattern>
<mask id='m'><rect width='816' height='1056' fill='url(#g)'/></mask></defs>
<rect width='816' height='1056' fill='url(#p)' mask='url(#m)'/></svg>`;

const CONFETTI = `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'>
<g stroke='${INK}' stroke-width='1.1' fill='none' opacity='0.7'>
<path d='M16 12 v10 M11 17 h10'/><path d='M92 30 v9 M87.5 34.5 h9'/>
<path d='M50 86 v9 M45.5 90.5 h9'/>
<circle cx='74' cy='74' r='4'/><circle cx='28' cy='56' r='3'/><circle cx='104' cy='100' r='3.4'/>
<path d='M96 62 l6 10 h-12 z'/><path d='M34 104 l5 8 h-10 z'/>
</g></svg>`;

/* ------------------------------------------------------------- geometric -- */

const HEXAGON = `<svg xmlns='http://www.w3.org/2000/svg' width='56' height='48' viewBox='0 0 56 48'>
<g fill='none' stroke='${INK}' stroke-width='0.9' opacity='0.5'>
<path d='M14 0 L28 8 L28 24 L14 32 L0 24 L0 8 Z'/>
<path d='M42 0 L56 8 L56 24 L42 32 L28 24 L28 8 Z'/>
<path d='M28 24 L42 32 L42 48 L28 56 L14 48 L14 32 Z'/>
</g></svg>`;

const CIRCUIT = `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'>
<g fill='none' stroke='${INK}' stroke-width='0.9' opacity='0.6'>
<path d='M0 20 h26 v-14 M26 20 v24 h30 M56 44 h34'/>
<path d='M0 68 h18 v14 M18 68 v-22 h26'/>
<path d='M62 0 v18 h28 M62 18 v26 M44 90 v-20 h26 v20'/>
</g>
<g fill='${DOT}' opacity='0.7'>
<circle cx='26' cy='20' r='2.4'/><circle cx='56' cy='44' r='2.4'/><circle cx='18' cy='68' r='2.4'/>
<circle cx='62' cy='18' r='2.4'/><circle cx='70' cy='70' r='2.4'/><circle cx='44' cy='46' r='2.2'/>
</g></svg>`;

const SCALES = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='20' viewBox='0 0 40 20'>
<g fill='none' stroke='${INK}' stroke-width='0.8' opacity='0.5'>
<path d='M0 20 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0'/>
<path d='M-20 10 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0 a10 10 0 0 1 20 0'/>
</g></svg>`;

/* ----------------------------------------------------------------- lines -- */

const TOPOGRAPHY = `<svg xmlns='http://www.w3.org/2000/svg' width='816' height='1056' viewBox='0 0 816 1056' preserveAspectRatio='none'>
<g fill='none' stroke='${INK}' stroke-width='0.9' opacity='0.45'>
<path d='M-40 180 C 140 90, 300 250, 470 150 S 760 60, 880 160'/>
<path d='M-40 250 C 150 165, 310 320, 480 225 S 770 140, 880 235'/>
<path d='M-40 325 C 160 245, 320 395, 490 300 S 780 220, 880 315'/>
<path d='M-40 640 C 120 560, 300 700, 460 610 S 740 530, 880 625'/>
<path d='M-40 715 C 130 640, 310 775, 470 690 S 750 610, 880 700'/>
<path d='M-40 790 C 140 720, 320 850, 480 765 S 760 690, 880 780'/>
<path d='M-40 950 C 150 880, 330 1010, 490 930 S 770 855, 880 940'/>
</g></svg>`;

const WAVES = `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='28' viewBox='0 0 80 28'>
<g fill='none' stroke='${INK}' stroke-width='0.9' opacity='0.5'>
<path d='M0 14 q20 -12 40 0 t40 0'/><path d='M0 28 q20 -12 40 0 t40 0'/>
<path d='M0 0 q20 -12 40 0 t40 0'/></g></svg>`;

/* ---------------------------------------------------------------- accent -- */

const ARC_RINGS = `<svg xmlns='http://www.w3.org/2000/svg' width='360' height='360' viewBox='0 0 360 360'>
<g fill='none' stroke='${INK}' stroke-width='1' opacity='0.5'>
<circle cx='360' cy='0' r='90'/><circle cx='360' cy='0' r='140'/><circle cx='360' cy='0' r='190'/>
<circle cx='360' cy='0' r='240'/><circle cx='360' cy='0' r='300'/>
</g></svg>`;

const BLOB = `<svg xmlns='http://www.w3.org/2000/svg' width='420' height='380' viewBox='0 0 420 380'>
<defs><linearGradient id='b' x1='0' y1='0' x2='1' y2='1'>
<stop offset='0' stop-color='${DOT}' stop-opacity='0.30'/>
<stop offset='1' stop-color='${DOT}' stop-opacity='0.04'/></linearGradient></defs>
<path fill='url(#b)' d='M420 0 C 330 40, 350 150, 250 190 C 150 230, 60 180, 20 260 C -10 330, 90 380, 200 380 L 420 380 Z'/>
</svg>`;

const RULE_EDGE = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='100' viewBox='0 0 40 100' preserveAspectRatio='none'>
<rect x='0' y='0' width='6' height='100' fill='${DOT}' opacity='0.35'/>
<rect x='10' y='0' width='1.6' height='100' fill='${DOT}' opacity='0.25'/></svg>`;

/* -------------------------------------------------------------- registry -- */

export const BACKGROUNDS: readonly BackgroundDef[] = [
  {
    key: 'none',
    name: 'No Background',
    description: 'Plain white. The safest choice for a strict applicant tracking system.',
    category: 'plain',
    css: '',
  },

  // dots
  {
    key: 'particle-dots',
    name: 'Particle Dots',
    description: 'A faint connected-node network, weighted to the corner.',
    category: 'dots',
    css: layer(corner(PARTICLE_DOTS, '-60px -40px', 420, 420, 0.85)),
  },
  {
    key: 'dot-flow',
    name: 'Dot Flow',
    description: 'A dot field fading diagonally across the page.',
    category: 'dots',
    css: layer(full(DOT_FLOW)),
  },
  {
    key: 'dot-grid',
    name: 'Dot Grid',
    description: 'An even dot grid, like plotting paper.',
    category: 'dots',
    css: layer(tile(DOT_GRID, 20, 20, 0.75)),
  },
  {
    key: 'halftone',
    name: 'Halftone',
    description: 'Print-style dots, densest at the top-left and fading out.',
    category: 'dots',
    css: layer(full(HALFTONE, 0.7)),
  },
  {
    key: 'confetti',
    name: 'Confetti',
    description: 'Small scattered marks. Playful — best for creative roles.',
    category: 'dots',
    css: layer(tile(CONFETTI, 120, 120, 0.7)),
  },

  // geometric
  {
    key: 'hexagon',
    name: 'Hexagon',
    description: 'A light honeycomb lattice across the whole page.',
    category: 'geometric',
    css: layer(tile(HEXAGON, 56, 48, 0.75)),
  },
  {
    key: 'triangles',
    name: 'Triangles',
    description: 'A zig-zag mesh of thin triangles.',
    category: 'geometric',
    css: layer(grad(`repeating-linear-gradient(60deg, #bcc7d6 0 0.7px, transparent 0.7px 34px),
      repeating-linear-gradient(-60deg, #bcc7d6 0 0.7px, transparent 0.7px 34px),
      repeating-linear-gradient(0deg, #bcc7d6 0 0.7px, transparent 0.7px 30px)`, 0.7)),
  },
  {
    key: 'diamond',
    name: 'Diamond',
    description: 'A clean diamond lattice.',
    category: 'geometric',
    css: layer(grad(`repeating-linear-gradient(45deg, #bcc7d6 0 0.7px, transparent 0.7px 28px),
      repeating-linear-gradient(-45deg, #bcc7d6 0 0.7px, transparent 0.7px 28px)`, 0.7)),
  },
  {
    key: 'isometric',
    name: 'Isometric',
    description: 'Stacked cubes in isometric projection.',
    category: 'geometric',
    css: layer(grad(`repeating-linear-gradient(30deg, #bcc7d6 0 0.7px, transparent 0.7px 30px),
      repeating-linear-gradient(-30deg, #bcc7d6 0 0.7px, transparent 0.7px 30px),
      repeating-linear-gradient(90deg, #bcc7d6 0 0.7px, transparent 0.7px 52px)`, 0.7)),
  },
  {
    key: 'circuit',
    name: 'Circuit',
    description: 'Board traces and junctions. Suits engineering roles.',
    category: 'geometric',
    css: layer(tile(CIRCUIT, 90, 90, 0.7)),
  },
  {
    key: 'scales',
    name: 'Scales',
    description: 'Overlapping arcs in a fish-scale lattice.',
    category: 'geometric',
    css: layer(tile(SCALES, 40, 20, 0.7)),
  },

  // lines
  {
    key: 'diagonal',
    name: 'Diagonal Lines',
    description: 'Fine 45-degree stripes.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(45deg, #bcc7d6 0 1px, transparent 1px 16px)`, 0.65)),
  },
  {
    key: 'graph-paper',
    name: 'Graph Paper',
    description: 'A fine grid with heavier rules every fifth line.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(0deg, #bcc7d6 0 0.5px, transparent 0.5px 8px),
      repeating-linear-gradient(90deg, #bcc7d6 0 0.5px, transparent 0.5px 8px)`, 0.7)),
  },
  {
    key: 'crosshatch',
    name: 'Crosshatch',
    description: 'A tight woven texture. Reads as paper stock.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(45deg, #bcc7d6 0 0.6px, transparent 0.6px 12px),
      repeating-linear-gradient(-45deg, #bcc7d6 0 0.6px, transparent 0.6px 12px)`, 0.6)),
  },
  {
    key: 'topography',
    name: 'Topography',
    description: 'Contour lines banded across the page, clear through the middle.',
    category: 'lines',
    css: layer(full(TOPOGRAPHY, 0.75)),
  },
  {
    key: 'waves',
    name: 'Waves',
    description: 'Soft horizontal wave lines.',
    category: 'lines',
    css: layer(tile(WAVES, 80, 28, 0.65)),
  },
  {
    key: 'pinstripe',
    name: 'Pinstripe',
    description: 'Narrow vertical rules. The most conservative of the textures.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(90deg, #bcc7d6 0 1px, transparent 1px 10px)`, 0.6)),
  },

  // accent — decoration at an edge rather than across the text
  {
    key: 'arc-rings',
    name: 'Arc Rings',
    description: 'Concentric arcs sweeping out of the top-right corner.',
    category: 'accent',
    css: layer(corner(ARC_RINGS, 'top right', 360, 360, 0.8)),
  },
  {
    key: 'blob',
    name: 'Soft Blob',
    description: 'A single soft gradient shape in the top-right.',
    category: 'accent',
    css: layer(corner(BLOB, 'top right', 420, 380, 0.9)),
  },
  {
    key: 'edge-rule',
    name: 'Edge Rule',
    description: 'A quiet vertical band down the left margin.',
    category: 'accent',
    css: layer(
      `background-image: url("${uri(RULE_EDGE)}");
    background-repeat: no-repeat;
    background-position: left top;
    background-size: 40px 100%;`,
    ),
  },
  {
    key: 'corner-wash',
    name: 'Corner Wash',
    description: 'A soft tint in two corners. No pattern, just depth.',
    category: 'accent',
    css: layer(
      `background-image:
      radial-gradient(760px 520px at 100% 0%, rgba(147,163,186,0.20), rgba(147,163,186,0) 70%),
      radial-gradient(620px 460px at 0% 100%, rgba(147,163,186,0.14), rgba(147,163,186,0) 70%);`,
    ),
  },
] as const;

const BY_KEY = new Map(BACKGROUNDS.map((b) => [b.key, b]));

export type BackgroundKey = string;
export const DEFAULT_BACKGROUND = 'none';

export const isBackground = (key: string): boolean => BY_KEY.has(key);

/** The chosen background, or the plain one for an unknown or absent key. */
export function getBackground(key: string | null | undefined): BackgroundDef {
  return BY_KEY.get(key ?? '') ?? (BY_KEY.get(DEFAULT_BACKGROUND) as BackgroundDef);
}

/**
 * The CSS to render with -- the pre-rendered PNG where one exists.
 *
 * The registry keeps the VECTOR definition as the source of truth, because
 * that is what `gen-raster.ts` re-renders from and what stays editable. The
 * swap happens here, at the last moment, so exactly one thing changes: which
 * image the layer points at.
 *
 * Only the patterns too dense to draw as vectors have a raster. The rest go
 * out as gradients or small SVGs, which are both sharper and smaller.
 */
export function backgroundCss(key: string | null | undefined): string {
  const def = getBackground(key);
  const png = RASTER[def.key];
  if (!png) return def.css;
  return def.css.replace(/url\("data:image\/svg\+xml,[^"]*"\)/, `url("${png}")`);
}
