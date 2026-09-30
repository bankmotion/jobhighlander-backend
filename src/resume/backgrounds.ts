/**
 * Decorative page backgrounds for a rendered resume.
 *
 * Five rules shape everything here, and all five come from how the PDF is
 * actually produced:
 *
 * 1. SELF-CONTAINED. `htmlToPdf` loads the document with `domcontentloaded`
 *    and no network, so an external image would render as a blank gap rather
 *    than fail loudly. Every pattern is an inline SVG or an inline image.
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
 * 4. THE SAME IN EVERY VIEWER. A CSS gradient is NOT sent to the PDF as a
 *    gradient. Chromium writes it as a shading with a soft mask, which its own
 *    viewer draws correctly and pdf.js does not: pdf.js 4 paints the whole page
 *    pink, pdf.js 6 drops the pattern. pdf.js is Firefox's viewer and the
 *    preview in a great many web portals, so a resume sent with such a
 *    background could open pink on a recruiter's screen. Gradients are
 *    therefore only ever a way to DESCRIBE a pattern here. Anything described
 *    with one is marked `raster` and goes out as a pre-rendered image, which
 *    every viewer draws alike. Plain vector shapes are safe and stay vector.
 *
 * 5. THE PAGE MARGINS BELONG TO THE PAGE, NOT TO THE LAYER. The fixed layer
 *    covers the text area only; the top and bottom margin of every sheet stay
 *    the colour of the page box. On white that is invisible. A tinted or dark
 *    background would print with a white band at the head and foot of each
 *    page, so its colour is ALSO set on `@page`, which takes a solid colour and
 *    nothing else. That is why `base` is a plain colour, and why a pattern on a
 *    coloured page fades out before it reaches the margin (see `fade`).
 *
 * ATS extraction is unaffected: these add no text and no elements to the
 * document flow, so a parser reading the PDF sees exactly what it saw before.
 * That is why a background is offered even on presets marked `atsSafe`.
 *
 * To add one: write the SVG (or gradient), add a registry entry, and if it is
 * marked `raster`, run `npx tsx src/scripts/gen-raster.ts`. The picker and the
 * request validator both read this list, so there is nothing else to update.
 */

import { RASTER } from './backgrounds.raster';

export type BackgroundCategory =
  | 'plain'
  | 'tint'
  | 'dots'
  | 'geometric'
  | 'lines'
  | 'accent'
  | 'dark';

/** How a background that cannot go out as vector is pre-rendered. */
export interface RasterSpec {
  /** PNG for line work and dots, which must stay crisp. JPEG for soft glows. */
  format: 'png' | 'jpeg';
}

export interface BackgroundDef {
  key: string;
  /** Shown in the picker. */
  name: string;
  /** One line under the name, so the choice is not made blind from a thumbnail. */
  description: string;
  /** Groups the picker. Plain sorts first. */
  category: BackgroundCategory;
  /**
   * The pattern layer, as CSS. Empty for a page that is only a colour.
   *
   * This is the SOURCE of the pattern. When `raster` is set it is what
   * gen-raster.ts renders, and the image is what reaches the document.
   */
  css: string;
  /** The page colour under the pattern. White when absent. Solid colours only. */
  base?: string;
  /** A dark page. The templates' text and rules are switched to light. */
  dark?: boolean;
  /** Present when the pattern must be delivered as an image. See rule 4 above. */
  raster?: RasterSpec;
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
 * A pattern described with CSS gradients.
 *
 * The most compact way to WRITE straight lines, bands and soft glows, and
 * never the way they are delivered: every entry built with this is marked
 * `raster`. A gradient printed directly came out small (+3 KB) and correct in
 * Chromium's own viewer, which is why it was used that way at first, and pink
 * or missing in pdf.js, which is why it no longer is.
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
 * Declaring the repetition as an SVG `<pattern>` instead gives one image with
 * the tiling resolved inside it, which is the right shape for a source
 * drawing. It did NOT make the printed file small: Chromium still expands the
 * pattern when it prints. So every entry built with this is marked `raster`
 * and is delivered as one pre-rendered image.
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

/** `#rrggbb` as an rgba() with the given alpha. */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * A top layer that eases a pattern back to the page colour at the head and
 * foot of the text area.
 *
 * The margins above and below are painted by the page box in the flat `base`
 * colour. A pattern running at full strength up to that line would stop dead
 * against it, and every page would show a band at the top and bottom. Faded,
 * the pattern has already reached the base colour when it meets the margin,
 * and there is no line to see.
 *
 * Written as the base colour at zero alpha rather than `transparent`, so the
 * ramp never passes through a grey on its way out.
 */
function fade(base: string): string {
  return `linear-gradient(to bottom, ${base} 0, ${rgba(base, 0)} 9%, ${rgba(base, 0)} 91%, ${base} 100%)`;
}

/** The page colour, on the document and on the page box, so margins match. */
function pageColour(base: string): string {
  return `
  @page { background-color: ${base}; }
  html, body {
    background: ${base} !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
`;
}

/**
 * Light text for a dark page.
 *
 * Every template hard-codes dark text, dark rules and a dark accent, each in
 * its own places. Overriding them one by one would need a rule per template
 * and would miss the next template added. So everything inside the page is
 * set light in one sweep, then the secondary details are stepped down and the
 * bold runs stepped up, which restores the hierarchy the greys gave on white.
 *
 * Backgrounds the templates paint themselves (the sidebar in one, the heading
 * band in another) are left alone: they are tinted from the accent and sit
 * naturally on a dark page.
 */
const LIGHT_TEXT = `
  .page, .page * {
    color: #eef1f5 !important;
    border-color: rgba(255, 255, 255, 0.38) !important;
  }
  .page .contact, .page .headline, .page .period, .page .loc, .page .org, .page .impact {
    color: #c3cbd6 !important;
  }
  .page strong, .page b { color: #ffffff !important; }
`;

// Neutrals used throughout. Written as plain hex; `uri()` escapes them.
const INK = '#a9b6c8'; //   line work
const DOT = '#93a3ba'; //   filled shapes

// Page colours. Named because each is used twice: as the page's `base` and
// inside the pattern that has to fade back to it.
const WHITE = '#ffffff';
const CREAM = '#fbf7ee';
const ICE = '#f0f5fb';
const CHARCOAL = '#15181d';
const NAVY = '#0e1a2b';
const SLATE = '#1f242c';
const CARBON = '#111316';
const NIGHT = '#0f1419';
const EMBER = '#1a1412';

/** An existing drawing in other colours, for use on a dark page. */
const recolour = (svg: string, ink: string, dot: string = ink): string =>
  svg.split(INK).join(ink).split(DOT).join(dot);

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
    raster: { format: 'png' },
  },
  {
    key: 'dot-grid',
    name: 'Dot Grid',
    description: 'An even dot grid, like plotting paper.',
    category: 'dots',
    css: layer(tile(DOT_GRID, 20, 20, 0.5625)),
    raster: { format: 'png' },
  },
  {
    key: 'halftone',
    name: 'Halftone',
    description: 'Print-style dots, densest at the top-left and fading out.',
    category: 'dots',
    css: layer(full(HALFTONE, 0.49)),
    raster: { format: 'png' },
  },
  {
    key: 'confetti',
    name: 'Confetti',
    description: 'Small scattered marks. Playful — best for creative roles.',
    category: 'dots',
    css: layer(tile(CONFETTI, 120, 120, 0.49)),
    raster: { format: 'png' },
  },

  // geometric
  {
    key: 'hexagon',
    name: 'Hexagon',
    description: 'A light honeycomb lattice across the whole page.',
    category: 'geometric',
    css: layer(tile(HEXAGON, 56, 48, 0.5625)),
    raster: { format: 'png' },
  },
  {
    key: 'triangles',
    name: 'Triangles',
    description: 'A zig-zag mesh of thin triangles.',
    category: 'geometric',
    css: layer(grad(`repeating-linear-gradient(60deg, #bcc7d6 0 0.7px, transparent 0.7px 34px),
      repeating-linear-gradient(-60deg, #bcc7d6 0 0.7px, transparent 0.7px 34px),
      repeating-linear-gradient(0deg, #bcc7d6 0 0.7px, transparent 0.7px 30px)`, 0.7)),
    raster: { format: 'png' },
  },
  {
    key: 'diamond',
    name: 'Diamond',
    description: 'A clean diamond lattice.',
    category: 'geometric',
    css: layer(grad(`repeating-linear-gradient(45deg, #bcc7d6 0 0.7px, transparent 0.7px 28px),
      repeating-linear-gradient(-45deg, #bcc7d6 0 0.7px, transparent 0.7px 28px)`, 0.7)),
    raster: { format: 'png' },
  },
  {
    key: 'isometric',
    name: 'Isometric',
    description: 'Stacked cubes in isometric projection.',
    category: 'geometric',
    css: layer(grad(`repeating-linear-gradient(30deg, #bcc7d6 0 0.7px, transparent 0.7px 30px),
      repeating-linear-gradient(-30deg, #bcc7d6 0 0.7px, transparent 0.7px 30px),
      repeating-linear-gradient(90deg, #bcc7d6 0 0.7px, transparent 0.7px 52px)`, 0.7)),
    raster: { format: 'png' },
  },
  {
    key: 'circuit',
    name: 'Circuit',
    description: 'Board traces and junctions. Suits engineering roles.',
    category: 'geometric',
    css: layer(tile(CIRCUIT, 90, 90, 0.49)),
    raster: { format: 'png' },
  },
  {
    key: 'scales',
    name: 'Scales',
    description: 'Overlapping arcs in a fish-scale lattice.',
    category: 'geometric',
    css: layer(tile(SCALES, 40, 20, 0.49)),
    raster: { format: 'png' },
  },

  // lines
  {
    key: 'diagonal',
    name: 'Diagonal Lines',
    description: 'Fine 45-degree stripes.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(45deg, #bcc7d6 0 1px, transparent 1px 16px)`, 0.65)),
    raster: { format: 'png' },
  },
  {
    key: 'graph-paper',
    name: 'Graph Paper',
    description: 'A fine grid with heavier rules every fifth line.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(0deg, #bcc7d6 0 0.5px, transparent 0.5px 8px),
      repeating-linear-gradient(90deg, #bcc7d6 0 0.5px, transparent 0.5px 8px)`, 0.7)),
    raster: { format: 'png' },
  },
  {
    key: 'crosshatch',
    name: 'Crosshatch',
    description: 'A tight woven texture. Reads as paper stock.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(45deg, #bcc7d6 0 0.6px, transparent 0.6px 12px),
      repeating-linear-gradient(-45deg, #bcc7d6 0 0.6px, transparent 0.6px 12px)`, 0.6)),
    raster: { format: 'png' },
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
    css: layer(tile(WAVES, 80, 28, 0.4225)),
    raster: { format: 'png' },
  },
  {
    key: 'pinstripe',
    name: 'Pinstripe',
    description: 'Narrow vertical rules. The most conservative of the textures.',
    category: 'lines',
    css: layer(grad(`repeating-linear-gradient(90deg, #bcc7d6 0 1px, transparent 1px 10px)`, 0.6)),
    raster: { format: 'png' },
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
    raster: { format: 'jpeg' },
  },
  // tint -- a soft page colour and nothing else. No layer, no image: the colour
  // sits on the page box, so it costs nothing and reaches every edge.
  {
    key: 'tint-cream',
    name: 'Cream Paper',
    description: 'A warm off-white, like good stationery.',
    category: 'tint',
    css: '',
    base: CREAM,
  },
  {
    key: 'tint-ice',
    name: 'Ice Blue',
    description: 'A cool, barely-there blue.',
    category: 'tint',
    css: '',
    base: ICE,
  },
  {
    key: 'tint-sage',
    name: 'Sage',
    description: 'A soft grey-green.',
    category: 'tint',
    css: '',
    base: '#f1f6f0',
  },
  {
    key: 'tint-blush',
    name: 'Blush',
    description: 'A faint warm pink.',
    category: 'tint',
    css: '',
    base: '#fbf2f1',
  },
  {
    key: 'tint-stone',
    name: 'Warm Grey',
    description: 'A neutral stone grey. The quietest of the tints.',
    category: 'tint',
    css: '',
    base: '#f4f3f0',
  },
  {
    key: 'tint-lavender',
    name: 'Lavender',
    description: 'A pale violet wash.',
    category: 'tint',
    css: '',
    base: '#f5f3fb',
  },

  // more light patterns
  {
    key: 'notebook',
    name: 'Notebook',
    description: 'Ruled lines and a margin line, like a page from a notebook.',
    category: 'lines',
    css: layer(
      grad(`${fade(WHITE)},
      linear-gradient(90deg, transparent 40px, rgba(226, 150, 150, 0.55) 40px 41px, transparent 41px),
      repeating-linear-gradient(0deg, rgba(150, 176, 214, 0.55) 0 1px, transparent 1px 26px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'blueprint',
    name: 'Blueprint',
    description: 'A blue drafting grid on a pale blue page.',
    category: 'lines',
    base: ICE,
    css: layer(
      grad(`${fade(ICE)},
      repeating-linear-gradient(0deg, rgba(74, 118, 184, 0.20) 0 1px, transparent 1px 50px),
      repeating-linear-gradient(90deg, rgba(74, 118, 184, 0.20) 0 1px, transparent 1px 50px),
      repeating-linear-gradient(0deg, rgba(74, 118, 184, 0.09) 0 1px, transparent 1px 10px),
      repeating-linear-gradient(90deg, rgba(74, 118, 184, 0.09) 0 1px, transparent 1px 10px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'linen',
    name: 'Linen',
    description: 'A fine woven texture on warm paper.',
    category: 'lines',
    base: CREAM,
    css: layer(
      grad(`${fade(CREAM)},
      repeating-linear-gradient(0deg, rgba(120, 100, 70, 0.05) 0 1px, transparent 1px 3px),
      repeating-linear-gradient(90deg, rgba(120, 100, 70, 0.05) 0 1px, transparent 1px 3px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'soft-stripes',
    name: 'Soft Stripes',
    description: 'Wide, very pale vertical bands.',
    category: 'lines',
    css: layer(
      grad(`${fade(WHITE)},
      repeating-linear-gradient(90deg, rgba(147, 163, 186, 0.11) 0 34px, transparent 34px 68px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'diagonal-bands',
    name: 'Diagonal Bands',
    description: 'Wide, very pale bands running corner to corner.',
    category: 'lines',
    css: layer(
      grad(`${fade(WHITE)},
      repeating-linear-gradient(135deg, rgba(147, 163, 186, 0.10) 0 30px, transparent 30px 60px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'plaid',
    name: 'Plaid',
    description: 'Pale bands crossing both ways.',
    category: 'geometric',
    css: layer(
      grad(`${fade(WHITE)},
      repeating-linear-gradient(0deg, rgba(147, 163, 186, 0.08) 0 38px, transparent 38px 76px),
      repeating-linear-gradient(90deg, rgba(147, 163, 186, 0.08) 0 38px, transparent 38px 76px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'dot-paper',
    name: 'Dot Paper',
    description: 'A dot grid on warm paper, like a designer\'s notepad.',
    category: 'dots',
    base: CREAM,
    css: layer(
      grad(
        `${fade(CREAM)},
      radial-gradient(circle at 3px 3px, rgba(120, 100, 70, 0.34) 1.1px, transparent 1.7px)`,
        1,
        '100% 100%, 18px 18px',
      ),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'warm-glow',
    name: 'Warm Glow',
    description: 'A soft peach light behind the upper half of the page.',
    category: 'accent',
    css: layer(
      grad(`radial-gradient(62% 42% at 50% 30%, rgba(255, 186, 130, 0.30), rgba(255, 186, 130, 0) 72%)`),
    ),
    raster: { format: 'jpeg' },
  },
  {
    key: 'blue-mist',
    name: 'Blue Mist',
    description: 'Two cool, pale clouds of blue.',
    category: 'accent',
    css: layer(
      grad(`radial-gradient(52% 34% at 24% 30%, rgba(110, 165, 235, 0.24), rgba(110, 165, 235, 0) 72%),
      radial-gradient(48% 32% at 78% 66%, rgba(140, 195, 240, 0.20), rgba(140, 195, 240, 0) 72%)`),
    ),
    raster: { format: 'jpeg' },
  },
  {
    key: 'pastel-aurora',
    name: 'Pastel Aurora',
    description: 'Mint, lilac and peach, each a faint wash.',
    category: 'accent',
    css: layer(
      grad(`radial-gradient(46% 30% at 22% 26%, rgba(120, 214, 180, 0.22), rgba(120, 214, 180, 0) 72%),
      radial-gradient(46% 30% at 80% 44%, rgba(176, 150, 240, 0.20), rgba(176, 150, 240, 0) 72%),
      radial-gradient(46% 30% at 40% 74%, rgba(255, 190, 150, 0.20), rgba(255, 190, 150, 0) 72%)`),
    ),
    raster: { format: 'jpeg' },
  },

  // dark -- a dark page with the text switched to light. Made for a file that
  // is read on a screen: printed, each page is mostly ink.
  {
    key: 'dark-charcoal',
    name: 'Charcoal',
    description: 'A plain dark grey page with light text.',
    category: 'dark',
    css: '',
    base: CHARCOAL,
    dark: true,
  },
  {
    key: 'dark-navy',
    name: 'Midnight Navy',
    description: 'A plain deep navy page with light text.',
    category: 'dark',
    css: '',
    base: NAVY,
    dark: true,
  },
  {
    key: 'dark-slate',
    name: 'Slate',
    description: 'A plain blue-grey slate page with light text.',
    category: 'dark',
    css: '',
    base: SLATE,
    dark: true,
  },
  {
    key: 'dark-forest',
    name: 'Deep Forest',
    description: 'A plain dark green page with light text.',
    category: 'dark',
    css: '',
    base: '#0f1f1b',
    dark: true,
  },
  {
    key: 'dark-plum',
    name: 'Plum',
    description: 'A plain dark violet page with light text.',
    category: 'dark',
    css: '',
    base: '#1d1526',
    dark: true,
  },
  {
    key: 'dark-grid',
    name: 'Dark Grid',
    description: 'Charcoal with a faint grid. Light text.',
    category: 'dark',
    base: CHARCOAL,
    dark: true,
    css: layer(
      grad(`${fade(CHARCOAL)},
      repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.055) 0 1px, transparent 1px 24px),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.055) 0 1px, transparent 1px 24px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'dark-diagonal',
    name: 'Dark Diagonal',
    description: 'Navy with fine diagonal lines. Light text.',
    category: 'dark',
    base: NAVY,
    dark: true,
    css: layer(
      grad(`${fade(NAVY)},
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 14px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'dark-dots',
    name: 'Dark Dots',
    description: 'Slate with a dot grid. Light text.',
    category: 'dark',
    base: SLATE,
    dark: true,
    css: layer(
      grad(
        `${fade(SLATE)},
      radial-gradient(circle at 3px 3px, rgba(255, 255, 255, 0.16) 1.1px, transparent 1.7px)`,
        1,
        '100% 100%, 20px 20px',
      ),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'dark-carbon',
    name: 'Carbon',
    description: 'Near-black with a tight diagonal weave. Light text.',
    category: 'dark',
    base: CARBON,
    dark: true,
    css: layer(
      grad(`${fade(CARBON)},
      repeating-linear-gradient(45deg, rgba(255, 255, 255, 0.035) 0 2px, transparent 2px 6px),
      repeating-linear-gradient(-45deg, rgba(255, 255, 255, 0.035) 0 2px, transparent 2px 6px)`),
    ),
    raster: { format: 'png' },
  },
  {
    key: 'dark-glow',
    name: 'Midnight Glow',
    description: 'Navy with a soft blue light in the upper half. Light text.',
    category: 'dark',
    base: NAVY,
    dark: true,
    css: layer(
      grad(`radial-gradient(66% 42% at 66% 28%, rgba(64, 132, 255, 0.30), rgba(64, 132, 255, 0) 72%)`),
    ),
    raster: { format: 'jpeg' },
  },
  {
    key: 'dark-aurora',
    name: 'Aurora',
    description: 'Near-black with teal and violet lights. Light text.',
    category: 'dark',
    base: NIGHT,
    dark: true,
    css: layer(
      grad(`radial-gradient(50% 32% at 22% 30%, rgba(40, 200, 170, 0.24), rgba(40, 200, 170, 0) 72%),
      radial-gradient(50% 32% at 80% 58%, rgba(140, 100, 255, 0.24), rgba(140, 100, 255, 0) 72%)`),
    ),
    raster: { format: 'jpeg' },
  },
  {
    key: 'dark-ember',
    name: 'Ember',
    description: 'Warm near-black with an amber light low on the page. Light text.',
    category: 'dark',
    base: EMBER,
    dark: true,
    css: layer(
      grad(`radial-gradient(62% 38% at 62% 70%, rgba(255, 140, 60, 0.22), rgba(255, 140, 60, 0) 72%)`),
    ),
    raster: { format: 'jpeg' },
  },
  {
    key: 'dark-contours',
    name: 'Night Contours',
    description: 'Charcoal with pale contour lines. Light text.',
    category: 'dark',
    base: CHARCOAL,
    dark: true,
    // Plain strokes, so it stays vector: nothing here that a viewer can get wrong.
    css: layer(full(recolour(TOPOGRAPHY, '#a9bbd6'), 0.8)),
  },
  {
    key: 'dark-constellation',
    name: 'Constellation',
    description: 'Navy with a small network of points and lines. Light text.',
    category: 'dark',
    base: NAVY,
    dark: true,
    // Set in from the corner, not hung off it: the layer ends where the page
    // margin begins, and a drawing that ran past that edge would be cut off.
    css: layer(corner(recolour(PARTICLE_DOTS, '#8ea8d0', '#b9cdee'), '18px 26px', 380, 380, 0.55)),
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
 * The CSS a document is rendered with.
 *
 * Assembled here, at the last moment, from four independent parts: the page
 * colour, the light-text switch, and the pattern either as its pre-rendered
 * image or, for the plain vector drawings, as it was written.
 *
 * The image replaces the WHOLE layer, not just the picture inside it. The
 * image is captured with the layer's opacity and its fade already applied, so
 * keeping the original declaration around it would apply the opacity twice.
 * (It once did. The odd opacities on the older patterns, 0.5625 and the like,
 * are the squares that kept their appearance when that was put right.)
 *
 * A background marked `raster` with no image yet falls back to its source CSS.
 * That still renders, and still carries the viewer problem rule 4 describes,
 * so gen-raster.ts is what makes this path unreachable in practice.
 */
export function backgroundCss(key: string | null | undefined): string {
  const def = getBackground(key);
  const parts: string[] = [];
  if (def.base) parts.push(pageColour(def.base));
  if (def.dark) parts.push(LIGHT_TEXT);

  const image = def.raster ? RASTER[def.key] : undefined;
  if (image) {
    parts.push(
      layer(`background-image: url("${image}");
    background-repeat: no-repeat;
    background-position: center;
    background-size: 100% 100%;`),
    );
  } else if (def.css) {
    parts.push(def.css);
  }
  return parts.join('\n');
}
