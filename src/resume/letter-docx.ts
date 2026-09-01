import { BorderStyle, Document, Packer, Paragraph, TextRun } from 'docx';
import { halfPt, hex, PAGE_TWIPS, px, wordFonts } from './docx';
import type { PageSize, Preset } from './templates/registry';
import { resolveTokens } from './tokens';

export interface LetterDocxInput {
  body: string;
  name: string;
  contact: string;
  preset?: Preset | null;
  pageSize?: PageSize;
}

// The Word twin of `renderCoverLetterHtml`. Same header rule, same accent, same
// page inset, so the two formats are the same document rather than two designs
// that happen to share text.
//
// The twips helpers are imported rather than re-derived: a second copy of the
// 1440/96 conversion would drift from the resume's the first time either moved.
export async function renderCoverLetterDocx({
  body,
  name,
  contact,
  preset,
  pageSize = 'letter',
}: LetterDocxInput): Promise<Buffer> {
  const t = resolveTokens(preset ?? {});
  const fonts = wordFonts(t);
  const page = PAGE_TWIPS[pageSize] ?? PAGE_TWIPS.letter;
  const pad = px(t.density.pad);
  const accent = hex(t.accent);

  const children: Paragraph[] = [
    new Paragraph({
      spacing: { after: px(6) },
      children: [
        new TextRun({ text: name, bold: true, font: fonts.display, size: halfPt(20), color: accent }),
      ],
    }),
  ];

  if (contact) {
    children.push(
      new Paragraph({
        spacing: { after: px(8) },
        children: [
          new TextRun({ text: contact, font: fonts.body, size: halfPt(t.density.fontSize - 1), color: '444444' }),
        ],
      }),
    );
  }

  // The accent rule under the header. Word has no free-standing horizontal
  // line, so it is an empty paragraph carrying a bottom border — the same trick
  // the resume's section headings use.
  children.push(
    new Paragraph({
      spacing: { after: px(20) },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 1 } },
      children: [],
    }),
  );

  // Blank lines separate blocks; a single newline inside one is a real break
  // ("Hiring Manager" over the company). Word has no <br>, so an inner newline
  // becomes its own tightly-spaced paragraph rather than being collapsed away.
  for (const block of body.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split('\n');
    lines.forEach((line, i) => {
      const last = i === lines.length - 1;
      children.push(
        new Paragraph({
          spacing: {
            after: last ? px(t.density.entryGap) : 0,
            line: Math.round((t.density.lineHeight + 0.15) * 240),
          },
          children: [new TextRun({ text: line, font: fonts.body, size: halfPt(t.density.fontSize) })],
        }),
      );
    });
  }

  const doc = new Document({
    creator: 'JobHighLander',
    title: `${name} — Cover letter`,
    styles: {
      default: {
        document: {
          run: { font: fonts.body, size: halfPt(t.density.fontSize), color: '111111' },
          paragraph: { spacing: { line: Math.round(t.density.lineHeight * 240) } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height },
            margin: { top: pad, bottom: pad, left: pad, right: pad },
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
