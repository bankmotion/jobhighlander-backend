import { PAGE_PX, FALLBACK_PRESET, type PageSize, type Preset } from './templates/registry';
import { resolveTokens, tokensToCss } from './tokens';

export interface LetterRenderInput {
  // The assembled letter from `assembleLetter` — date, recipient, salutation,
  // paragraphs and sign-off, already in reading order.
  body: string;
  name: string;
  contact: string;
  preset?: Preset | null;
  pageSize?: PageSize;
}

// ONE cover letter design, deliberately.
//
// It is not a fifth resume layout: a letter is a header and a column of prose,
// and the four resume layouts differ in things a letter does not have (a
// sidebar, a skills grid, entry density). What it DOES take from the chosen
// resume preset is the type, the accent and the page inset, so a letter sent
// with a resume reads as the same stationery rather than a different document
// that happens to be attached.
export function renderCoverLetterHtml({
  body,
  name,
  contact,
  preset,
  pageSize = 'letter',
}: LetterRenderInput): string {
  const p = preset ?? FALLBACK_PRESET;
  const page = PAGE_PX[pageSize] ?? PAGE_PX.letter;
  const resolved = resolveTokens(p);
  const tokens = tokensToCss(resolved);

  // Same reasoning as the resume layouts: `@page` sits outside the document
  // tree, so var(--pad) never resolves there and the browser drops the
  // declaration silently. The padding has to be interpolated as a literal.
  const css = LETTER_CSS.replace(/\{\{PAGE\}\}/g, page.css)
    .replace(/\{\{WIDTH\}\}/g, String(page.width))
    .replace(/\{\{HEIGHT\}\}/g, String(page.height))
    .replace(/\{\{PAD\}\}/g, String(resolved.density.pad));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(name || 'Cover letter')}</title>
<style>:root{${tokens}}</style>
<style>${css}</style>
</head>
<body><div class="page">
  <header>
    <h1>${escapeHtml(name)}</h1>
    ${contact ? `<p class="contact">${escapeHtml(contact)}</p>` : ''}
  </header>
  <section class="letter">${renderBody(body)}</section>
</div></body>
</html>`;
}

// The stored letter is plain text: blank lines separate blocks, and a single
// newline inside a block is a real line break ("Hiring Manager\nAcme Corp").
// Both have to survive, so blocks become paragraphs and inner newlines become
// <br> rather than collapsing into one run-on line.
function renderBody(body: string): string {
  return body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${block.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('\n');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const LETTER_CSS = `
  @page { size: {{PAGE}}; margin: 0; }

  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    font-family: var(--font-body);
    font-size: var(--size-body);
    line-height: var(--line-height);
    color: #111;
  }

  .page {
    width: {{WIDTH}}px;
    min-height: {{HEIGHT}}px;
    padding: var(--pad);
  }

  header {
    margin-bottom: 26px;
    padding-bottom: 10px;
    border-bottom: 2px solid var(--accent);
  }

  h1 {
    font-family: var(--font-display);
    font-size: 20pt;
    line-height: 1.15;
    margin: 0;
    color: var(--accent);
  }

  .contact {
    margin: 6px 0 0;
    font-size: calc(var(--size-body) - 1pt);
    color: #444;
  }

  /* A letter is read as prose, so it gets a slightly looser leading than the
     resume's scannable entries. */
  .letter { line-height: calc(var(--line-height) + 0.15); }

  .letter p { margin: 0 0 var(--entry-gap); }
  .letter p:last-child { margin-bottom: 0; }

  /* Never strand the salutation or the sign-off alone on a page. */
  .letter p { orphans: 2; widows: 2; }

  @media print {
    @page { margin: {{PAD}}px 0; }
    .page { min-height: 0; padding-top: 0; padding-bottom: 0; }
  }
`;
