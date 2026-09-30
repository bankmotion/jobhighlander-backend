import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { logger } from '../services/logger.service';

/**
 * Fonts shipped INSIDE the document, as base64 `@font-face` rules.
 *
 * A font stack in CSS only names fonts; whether the text is actually set in
 * one depends on what is installed where the PDF is rendered. That is the
 * server, and the server is a Linux box with none of the fonts a designer
 * would name. A template asking for Calibri rendered there in an Arial
 * lookalike: wider letters, different line breaks, and a third page holding
 * four lines of a resume that fits on two.
 *
 * Embedding removes the dependency. The document carries its own font, so it
 * looks the same on the server, on a laptop and in a test, and nothing has to
 * be installed anywhere. It also stays self-contained, which `htmlToPdf`
 * relies on: there is still no network request.
 *
 * Carlito, not Calibri. Calibri is Microsoft's and may not be bundled or
 * copied to a server. Carlito is the open-licence font drawn to replace it,
 * with identical character widths, so text set in one breaks exactly where it
 * would in the other. The Word export is a different matter and still names
 * Calibri, because Word brings the real one (see `wordFonts`).
 */
const PACKAGES = {
  Carlito: { pkg: '@fontsource/carlito', slug: 'carlito' },
} as const;

export type EmbeddedFamily = keyof typeof PACKAGES;

/**
 * Latin, extended Latin and Vietnamese. Each rule carries the unicode range it
 * covers, so a character outside all three falls through to the next font in
 * the stack, glyph by glyph, rather than rendering as a box.
 */
const SUBSETS = ['latin', 'latin-ext', 'vietnamese'] as const;

const FACES = [
  { weight: 400, style: 'normal' },
  { weight: 400, style: 'italic' },
  { weight: 700, style: 'normal' },
  { weight: 700, style: 'italic' },
] as const;

const built = new Map<EmbeddedFamily, string>();

function build(family: EmbeddedFamily): string {
  const { pkg, slug } = PACKAGES[family];
  // Through package.json rather than the file itself: the one path every
  // package lets a caller resolve, whatever its export map says.
  const root = dirname(require.resolve(`${pkg}/package.json`));
  // The ranges come from the package's own stylesheet, so they are the ranges
  // the files were actually cut to and cannot drift from them.
  const sheet = readFileSync(join(root, '400.css'), 'utf-8');

  const rules: string[] = [];
  for (const subset of SUBSETS) {
    const marker = sheet.indexOf(`/* ${slug}-${subset}-400-normal */`);
    const at = marker < 0 ? -1 : sheet.indexOf('unicode-range:', marker);
    if (at < 0) throw new Error(`no unicode range for ${slug}-${subset}`);
    const range = sheet.slice(at + 'unicode-range:'.length, sheet.indexOf(';', at)).trim();

    for (const { weight, style } of FACES) {
      const file = join(root, 'files', `${slug}-${subset}-${weight}-${style}.woff2`);
      const data = readFileSync(file).toString('base64');
      rules.push(
        // `block`, not `swap`: a page printed mid-swap would be set in the
        // fallback, which is the exact outcome this module exists to prevent.
        `@font-face{font-family:"${family}";font-style:${style};font-weight:${weight};` +
          `font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");` +
          `unicode-range:${range};}`,
      );
    }
  }
  return rules.join('\n');
}

/**
 * The `@font-face` rules for these families, or an empty string for none.
 *
 * Built once per process and kept: the files never change while the server
 * runs, and reading and encoding twelve of them on every render would be
 * wasted work on the hot path.
 *
 * A family that cannot be read is logged and skipped, never thrown. The
 * document then falls back down its font stack, which is a worse-looking
 * resume, and that is still better than no resume.
 */
export function fontFaceCss(families: readonly EmbeddedFamily[] | undefined): string {
  if (!families?.length) return '';
  const out: string[] = [];
  for (const family of families) {
    let css = built.get(family);
    if (css === undefined) {
      try {
        css = build(family);
      } catch (err) {
        logger.warn('Embedded font could not be loaded, falling back to the font stack', {
          family,
          err: String(err),
        });
        css = '';
      }
      built.set(family, css);
    }
    if (css) out.push(css);
  }
  return out.join('\n');
}
