import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TailoredResume } from '../schemas/resume.schema';
import { getLayout, PAGE_PX, FALLBACK_PRESET, type PageSize, type Preset } from './templates/registry';
import { resolveTokens, tokensToCss } from './tokens';

export interface RenderInput {
  resume: TailoredResume;
  name: string;
  contact: string;
  preset?: Preset | null;
  pageSize?: PageSize;
}

/**
 * Render a resume to a complete, self-contained HTML document.
 *
 * Self-contained matters: the PDF is produced with `setContent`, so there is no
 * origin to resolve a stylesheet, font or image against. Anything not inline
 * silently fails and yields an unstyled document that still looks like a PDF.
 */
export function renderResumeHtml({
  resume,
  name,
  contact,
  preset,
  pageSize = 'letter',
}: RenderInput): string {
  const p = preset ?? FALLBACK_PRESET;
  const layout = getLayout(p.layout);
  const page = PAGE_PX[pageSize] ?? PAGE_PX.letter;

  const css = layout.css
    .replace(/\{\{PAGE\}\}/g, page.css)
    .replace(/\{\{WIDTH\}\}/g, String(page.width))
    .replace(/\{\{HEIGHT\}\}/g, String(page.height));

  // Tokens come first so the layout's own rules can reference them, and are
  // scoped to :root so a layout never has to know which preset produced them.
  const tokens = tokensToCss(resolveTokens(p));

  const body = renderToStaticMarkup(createElement(layout.Component, { resume, name, contact }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(name || 'Resume')}</title>
<style>:root{${tokens}}</style>
<style>${css}</style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}
