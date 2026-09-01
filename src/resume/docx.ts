import {
  AlignmentType,
  BorderStyle,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from 'docx';
import type { TailoredResume } from '../schemas/resume.schema';
import { groupSkills } from './skills';
import { PAGE_PX, type PageSize, type Preset } from './templates/registry';
import { resolveTokens, type ResolvedTokens } from './tokens';

const TWIPS_PER_PX = 15; // 1440 / 96
export const px = (n: number) => Math.round(n * TWIPS_PER_PX);
export const halfPt = (n: number) => Math.round(n * 2);

export const PAGE_TWIPS: Record<PageSize, { width: number; height: number }> = {
  letter: { width: px(PAGE_PX.letter.width), height: px(PAGE_PX.letter.height) },
  a4: { width: px(PAGE_PX.a4.width), height: px(PAGE_PX.a4.height) },
};

export function wordFonts(tokens: ResolvedTokens): { display: string; body: string } {
  const pick = (stack: string): string => {
    const first = stack.split(',')[0].replace(/["']/g, '').trim();
    if (/^Helvetica/i.test(first)) return 'Arial';
    return first;
  };
  return { display: pick(tokens.fonts.display), body: pick(tokens.fonts.body) };
}

export const hex = (c: string) => c.replace('#', '').toUpperCase();

export function richRuns(
  text: string,
  base: { font: string; size: number; color?: string; italics?: boolean },
): TextRun[] {
  if (!text) return [];
  if (!text.includes('<b>')) return [new TextRun({ text, ...base })];
  const parts = text.split(/<b>([\s\S]*?)<\/b>/g);
  return parts
    .map((part, i) => (part ? new TextRun({ text: part, ...base, bold: i % 2 === 1 }) : null))
    .filter((r): r is TextRun => r !== null);
}

interface Ctx {
  t: ResolvedTokens;
  fonts: { display: string; body: string };
  contentWidth: number;
  accent: string;
}

function headLine(ctx: Ctx, left: TextRun[], right: string, spacingBefore = 0): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: ctx.contentWidth }],
    spacing: { before: spacingBefore, after: 0 },
    children: [
      ...left,
      ...(right
        ? [
            new TextRun({ text: '\t' }),
            new TextRun({
              text: right,
              font: ctx.fonts.body,
              size: halfPt(9.5),
              color: '555555',
            }),
          ]
        : []),
    ],
  });
}

function body(ctx: Ctx, text: string, opts: { size?: number; color?: string; italics?: boolean; before?: number } = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 0, after: 0, line: Math.round(ctx.t.density.lineHeight * 240) },
    children: richRuns(text, {
      font: ctx.fonts.body,
      size: halfPt(opts.size ?? ctx.t.density.fontSize),
      color: opts.color,
      italics: opts.italics,
    }),
  });
}

function bullet(ctx: Ctx, text: string) {
  return new Paragraph({
    numbering: { reference: 'resume-bullets', level: 0 },
    spacing: { before: 0, after: px(2), line: Math.round(ctx.t.density.lineHeight * 240) },
    children: richRuns(text, { font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) }),
  });
}

function impactLine(ctx: Ctx, text: string) {
  return new Paragraph({
    spacing: { before: px(4), after: 0 },
    children: [
      new TextRun({ text: 'Impact: ', bold: true, font: ctx.fonts.body, size: halfPt(9.5), color: '444444' }),
      ...richRuns(text, { font: ctx.fonts.body, size: halfPt(9.5), color: '444444' }),
    ],
  });
}

type HeadingStyle = 'rule' | 'plain' | 'band';

function heading(ctx: Ctx, text: string, style: HeadingStyle, size: number): Paragraph {
  const common = {
    spacing: { before: px(ctx.t.density.sectionGap), after: px(6) },
    keepNext: true, // never strand a heading at the foot of a page
    children: [
      new TextRun({
        text: text.toUpperCase(),
        bold: true,
        font: ctx.fonts.display,
        size: halfPt(size),
        color: style === 'band' ? '111111' : hex(ctx.accent),
      }),
    ],
  };
  if (style === 'rule') {
    return new Paragraph({
      ...common,
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(ctx.accent), space: 2 } },
    });
  }
  if (style === 'band') {
    return new Paragraph({
      ...common,
      shading: { type: ShadingType.CLEAR, fill: tint(ctx.accent, 0.88) },
      indent: { left: px(4), right: px(4) },
    });
  }
  return new Paragraph(common);
}

function tint(color: string, amount: number): string {
  const c = hex(color);
  const mix = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `${mix(0)}${mix(2)}${mix(4)}`.toUpperCase();
}

function skillParagraphs(ctx: Ctx, resume: TailoredResume, sep: string): Paragraph[] {
  return groupSkills(resume.skills).map(
    (g) =>
      new Paragraph({
        spacing: { before: 0, after: px(2) },
        children: [
          new TextRun({ text: `${g.category}: `, bold: true, font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) }),
          new TextRun({ text: g.names.join(sep), font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) }),
        ],
      }),
  );
}

function experience(
  ctx: Ctx,
  resume: TailoredResume,
  compose: (e: TailoredResume['experience'][number]) => Paragraph[],
): Paragraph[] {
  const out: Paragraph[] = [];
  resume.experience.forEach((e, i) => {
    if (i > 0) out.push(new Paragraph({ spacing: { before: px(ctx.t.density.entryGap), after: 0 }, children: [] }));
    out.push(...compose(e));
    e.bullets.forEach((b) => out.push(bullet(ctx, b.text)));
    if (e.impact) out.push(impactLine(ctx, e.impact));
  });
  return out;
}

function educationParagraphs(ctx: Ctx, resume: TailoredResume): Paragraph[] {
  const out: Paragraph[] = [];
  resume.education.forEach((ed, i) => {
    const label = `${ed.degree}${ed.institution ? ` — ${ed.institution}` : ''}`;
    out.push(
      headLine(
        ctx,
        [new TextRun({ text: label, bold: true, font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) })],
        ed.period,
        i > 0 ? px(ctx.t.density.entryGap) : 0,
      ),
    );
    if (ed.location) out.push(body(ctx, ed.location, { size: 9.5, color: '444444' }));
  });
  return out;
}

function classicBody(ctx: Ctx, r: TailoredResume, name: string, contact: string): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { after: px(4) },
      children: [new TextRun({ text: name, bold: true, font: ctx.fonts.display, size: halfPt(20) })],
    }),
  ];
  if (contact) out.push(body(ctx, contact, { size: 9.5, color: '333333' }));
  if (r.headline) out.push(body(ctx, r.headline, { size: 9.5, italics: true, before: px(3) }));

  if (r.summary) {
    out.push(heading(ctx, 'Summary', 'rule', 11), body(ctx, r.summary));
  }
  if (r.skills.length) {
    out.push(heading(ctx, 'Skills', 'rule', 11), ...skillParagraphs(ctx, r, ' · '));
  }
  if (r.experience.length) {
    out.push(heading(ctx, 'Experience', 'rule', 11));
    out.push(
      ...experience(ctx, r, (e) => {
        const label = `${e.title}${e.company ? ` — ${e.company}` : ''}`;
        const ps = [
          headLine(ctx, [new TextRun({ text: label, bold: true, font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) })], e.period),
        ];
        if (e.location) ps.push(body(ctx, e.location, { size: 9.5, color: '444444' }));
        return ps;
      }),
    );
  }
  if (r.education.length) {
    out.push(heading(ctx, 'Education', 'rule', 11), ...educationParagraphs(ctx, r));
  }
  return out;
}

function modernBody(ctx: Ctx, r: TailoredResume, name: string, contact: string): Paragraph[] {
  const out: Paragraph[] = [
    // Header rule: the CSS draws a 3px accent border under the whole header, so
    // the border goes on the last header paragraph rather than the name.
    new Paragraph({
      spacing: { after: px(2) },
      children: [new TextRun({ text: name, bold: true, font: ctx.fonts.display, size: halfPt(24) })],
    }),
  ];
  if (r.headline) out.push(body(ctx, r.headline, { size: 10, color: '444444' }));
  out.push(
    new Paragraph({
      spacing: { after: px(10) },
      border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: hex(ctx.accent), space: 6 } },
      children: contact
        ? [new TextRun({ text: contact, font: ctx.fonts.body, size: halfPt(9.5), color: '333333' })]
        : [],
    }),
  );

  if (r.summary) out.push(heading(ctx, 'Summary', 'plain', 9.5), body(ctx, r.summary));
  if (r.experience.length) {
    out.push(heading(ctx, 'Experience', 'plain', 9.5));
    out.push(
      ...experience(ctx, r, (e) => {
        const ps = [
          headLine(ctx, [new TextRun({ text: e.title, bold: true, font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) })], e.period),
        ];
        const org = `${e.company}${e.location ? ` · ${e.location}` : ''}`;
        if (org.trim()) ps.push(body(ctx, org, { size: 9.5, color: '444444' }));
        return ps;
      }),
    );
  }
  // Skills sit AFTER experience in this layout, unlike Classic.
  if (r.skills.length) out.push(heading(ctx, 'Skills', 'plain', 9.5), ...skillParagraphs(ctx, r, '   '));
  if (r.education.length) out.push(heading(ctx, 'Education', 'plain', 9.5), ...educationParagraphs(ctx, r));
  return out;
}

function professionalBody(ctx: Ctx, r: TailoredResume, name: string, contact: string): Paragraph[] {
  const centred = (children: TextRun[], after: number) =>
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after }, children });

  const out: Paragraph[] = [
    centred([new TextRun({ text: name, bold: true, font: ctx.fonts.display, size: halfPt(22) })], px(3)),
  ];
  if (contact) out.push(centred([new TextRun({ text: contact, font: ctx.fonts.body, size: halfPt(9.5), color: '333333' })], px(2)));
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: px(12) },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 6 } },
      children: r.headline
        ? [new TextRun({ text: r.headline, italics: true, font: ctx.fonts.body, size: halfPt(9.5) })]
        : [],
    }),
  );

  if (r.summary) out.push(heading(ctx, 'Professional Summary', 'band', 10), body(ctx, r.summary));
  if (r.skills.length) out.push(heading(ctx, 'Core Competencies', 'band', 10), ...skillParagraphs(ctx, r, ' | '));
  if (r.experience.length) {
    out.push(heading(ctx, 'Professional Experience', 'band', 10));
    out.push(
      ...experience(ctx, r, (e) => {
        // Role and organisation stack on the left, date right — the CSS puts
        // both in a .left block beside a right-aligned .period.
        const ps = [
          headLine(ctx, [new TextRun({ text: e.title, bold: true, font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) })], e.period),
        ];
        const org = `${e.company}${e.location ? `, ${e.location}` : ''}`;
        if (org.trim()) ps.push(body(ctx, org, { size: 9.5, color: '444444' }));
        return ps;
      }),
    );
  }
  if (r.education.length) out.push(heading(ctx, 'Education', 'band', 10), ...educationParagraphs(ctx, r));
  return out;
}

function creativeDoc(ctx: Ctx, r: TailoredResume, name: string, contact: string, pageSize: PageSize) {
  const white = 'FFFFFF';
  const sideWidth = 34;

  const sideHeading = (text: string) =>
    new Paragraph({
      spacing: { before: px(ctx.t.density.sectionGap), after: px(4) },
      keepNext: true,
      children: [new TextRun({ text: text.toUpperCase(), bold: true, font: ctx.fonts.display, size: halfPt(9.5), color: white })],
    });
  const sideText = (text: string, opts: { bold?: boolean; size?: number } = {}) =>
    new Paragraph({
      spacing: { after: px(1) },
      children: [new TextRun({ text, bold: opts.bold, font: ctx.fonts.body, size: halfPt(opts.size ?? 9), color: white })],
    });

  const side: Paragraph[] = [
    new Paragraph({
      spacing: { after: px(3) },
      children: [new TextRun({ text: name, bold: true, font: ctx.fonts.display, size: halfPt(18), color: white })],
    }),
  ];
  if (r.headline) side.push(sideText(r.headline, { size: 9 }));
  if (contact) {
    side.push(sideHeading('Contact'));
    // The CSS breaks the contact run onto separate lines in the narrow column.
    contact.split(' | ').forEach((line) => side.push(sideText(line)));
  }
  if (r.skills.length) {
    side.push(sideHeading('Skills'));
    groupSkills(r.skills).forEach((g) => {
      side.push(sideText(g.category, { bold: true }));
      g.names.forEach((n) => side.push(sideText(`• ${n}`)));
    });
  }
  if (r.education.length) {
    side.push(sideHeading('Education'));
    r.education.forEach((ed) => {
      side.push(sideText(ed.degree, { bold: true }));
      if (ed.institution) side.push(sideText(ed.institution));
      if (ed.location) side.push(sideText(ed.location));
      if (ed.period) side.push(sideText(ed.period));
    });
  }

  const main: Paragraph[] = [];
  if (r.summary) main.push(heading(ctx, 'Profile', 'plain', 11), body(ctx, r.summary));
  if (r.experience.length) {
    main.push(heading(ctx, 'Experience', 'plain', 11));
    main.push(
      ...experience(ctx, r, (e) => {
        const ps = [
          headLine(ctx, [new TextRun({ text: e.title, bold: true, font: ctx.fonts.body, size: halfPt(ctx.t.density.fontSize) })], e.period),
        ];
        const org = `${e.company}${e.location ? ` · ${e.location}` : ''}`;
        if (org.trim()) ps.push(body(ctx, org, { size: 9, color: '555555' }));
        return ps;
      }),
    );
  }

  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'auto' } as const;
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder },
    rows: [
      new TableRow({
        cantSplit: false,
        children: [
          new TableCell({
            width: { size: sideWidth, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.CLEAR, fill: hex(ctx.accent) },
            margins: { top: px(ctx.t.density.pad), bottom: px(ctx.t.density.pad), left: px(18), right: px(18) },
            verticalAlign: VerticalAlign.TOP,
            children: side,
          }),
          new TableCell({
            width: { size: 100 - sideWidth, type: WidthType.PERCENTAGE },
            margins: { top: px(ctx.t.density.pad), bottom: px(ctx.t.density.pad), left: px(22), right: px(18) },
            verticalAlign: VerticalAlign.TOP,
            children: main.length ? main : [new Paragraph({ children: [] })],
          }),
        ],
      }),
    ],
  });

  // Zero page margins: the sidebar is full-bleed, so the inset lives in the
  // cell margins instead. Same reasoning as the CSS putting padding on .side.
  return { children: [table], margin: { top: 0, right: 0, bottom: 0, left: 0 }, pageSize };
}

export interface DocxInput {
  resume: TailoredResume;
  name: string;
  contact: string;
  preset?: Preset | null;
  pageSize?: PageSize;
}

export async function renderResumeDocx({
  resume,
  name,
  contact,
  preset,
  pageSize = 'letter',
}: DocxInput): Promise<Buffer> {
  const t = resolveTokens(preset ?? {});
  const fonts = wordFonts(t);
  const page = PAGE_TWIPS[pageSize] ?? PAGE_TWIPS.letter;
  const pad = px(t.density.pad);
  const layout = preset?.layout ?? 'classic';

  const ctx: Ctx = { t, fonts, accent: t.accent, contentWidth: page.width - pad * 2 };

  let children: (Paragraph | Table)[];
  let margin = { top: pad, right: pad, bottom: pad, left: pad };

  if (layout === 'creative') {
    const c = creativeDoc(ctx, resume, name, contact, pageSize);
    children = c.children;
    margin = c.margin;
  } else if (layout === 'modern') {
    children = modernBody(ctx, resume, name, contact);
  } else if (layout === 'professional') {
    children = professionalBody(ctx, resume, name, contact);
  } else {
    children = classicBody(ctx, resume, name, contact);
  }

  const doc = new Document({
    creator: 'JobHighLander',
    title: `${name} — Resume`,
    styles: {
      default: {
        document: {
          run: { font: fonts.body, size: halfPt(t.density.fontSize), color: '111111' },
          paragraph: { spacing: { line: Math.round(t.density.lineHeight * 240) } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'resume-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: px(18), hanging: px(10) } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.width, height: page.height },
            margin,
          },
        },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
