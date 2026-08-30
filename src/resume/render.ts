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

  // Resolved once: the tokens block needs the whole set, and the paged-media
  // rules need the padding as a LITERAL. `@page` sits outside the document
  // tree, so `var(--pad)` does not resolve inside it and the browser drops the
  // declaration without complaint — which is what left every page after the
  // first with no top inset.
  const resolved = resolveTokens(p);

  const css = layout.css
    .replace(/\{\{PAGE\}\}/g, page.css)
    .replace(/\{\{WIDTH\}\}/g, String(page.width))
    .replace(/\{\{HEIGHT\}\}/g, String(page.height))
    .replace(/\{\{PAD\}\}/g, String(resolved.density.pad));

  // Tokens come first so the layout's own rules can reference them, and are
  // scoped to :root so a layout never has to know which preset produced them.
  const tokens = tokensToCss(resolved);

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
