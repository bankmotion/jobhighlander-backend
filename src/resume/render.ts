import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TailoredResume } from '../schemas/resume.schema';
import { getTemplate, PAGE_PX, type PageSize } from './templates/registry';

export interface RenderInput {
  resume: TailoredResume;
  name: string;
  contact: string;
  templateKey?: string;
  pageSize?: PageSize;
}

/**
 * Render a resume to a complete, self-contained HTML document.
 *
 * Self-contained matters: the PDF is produced with `setContent`, so there is no
 * origin to resolve a stylesheet, font or image against. Anything not inline
 * silently fails and yields an unstyled document that still looks like a PDF.
 * Only fonts already present on the machine are referenced.
 */
export function renderResumeHtml({
  resume,
  name,
  contact,
  templateKey,
  pageSize = 'letter',
}: RenderInput): string {
  const tpl = getTemplate(templateKey);
  const page = PAGE_PX[pageSize] ?? PAGE_PX.letter;

  const css = tpl.css
    .replace(/\{\{PAGE\}\}/g, page.css)
    .replace(/\{\{WIDTH\}\}/g, String(page.width))
    .replace(/\{\{HEIGHT\}\}/g, String(page.height));

  const body = renderToStaticMarkup(createElement(tpl.Component, { resume, name, contact }));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(name || 'Resume')}</title>
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
