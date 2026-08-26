import type { TemplateProps } from './types';
import { Rich } from '../rich';
import { groupSkills } from '../skills';

export type { TemplateProps };

/**
 * Classic ATS — single column, plain text throughout.
 *
 * Every constraint here is one an applicant tracking system actually cares
 * about, measured rather than assumed:
 *  - SINGLE COLUMN. PDF text extraction follows page geometry, not DOM order,
 *    so a sidebar is read before the main column no matter how the markup is
 *    arranged. There is no markup trick that fixes it.
 *  - NO `letter-spacing` on anything. Tracking breaks extraction per-word and
 *    unpredictably — "EDUCATION" shattered into "E D U C AT I O N" at 2px while
 *    "EXPERIENCE" survived 6px. There is no safe value, only zero.
 *  - NO tables. A table layout interleaves cells by row on extraction and tears
 *    headings away from the content beneath them.
 *  - NO icons. Symbol glyphs extract as nothing, so an envelope standing in for
 *    "Email" silently deletes that field from the parsed document.
 *  - Standard section headings, spelled out, so a parser can find them.
 */
export function ClassicLayout({ resume, name, contact }: TemplateProps) {
  return (
    <div className="page">
      <header>
        <h1>{name}</h1>
        {contact && <p className="contact">{contact}</p>}
        {resume.headline && <p className="headline">{resume.headline}</p>}
      </header>

      {resume.summary && (
        <section>
          <h2>Summary</h2>
          <p><Rich text={resume.summary} /></p>
        </section>
      )}

      {resume.skills.length > 0 && (
        <section>
          <h2>Skills</h2>
          {/* One line per group, each a plain comma run: a parser reads it as
              a list, a human scans the headings, and it survives a column of
              any width. Chips would look tidier and extract worse. */}
          {groupSkills(resume.skills).map((g) => (
            <p key={g.category}>
              <strong>{g.category}:</strong> {g.names.join(' · ')}
            </p>
          ))}
        </section>
      )}

      {resume.experience.length > 0 && (
        <section>
          <h2>Experience</h2>
          {resume.experience.map((e, i) => (
            <article key={`${e.company}-${i}`} className="entry">
              <div className="entry-head">
                <span className="role">
                  {e.title}
                  {e.company ? ` — ${e.company}` : ''}
                </span>
                <span className="period">{e.period}</span>
              </div>
              {e.location && <p className="loc">{e.location}</p>}
              {e.bullets.length > 0 && (
                <ul>
                  {e.bullets.map((b, j) => (
                    <li key={j}><Rich text={b.text} /></li>
                  ))}
                </ul>
              )}
              {e.impact && (
                <p className="impact">
                  <strong>Impact:</strong> <Rich text={e.impact} />
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {resume.education.length > 0 && (
        <section>
          <h2>Education</h2>
          {resume.education.map((ed, i) => (
            <article key={i} className="entry">
              <div className="entry-head">
                <span className="role">
                  {ed.degree}
                  {ed.institution ? ` — ${ed.institution}` : ''}
                </span>
                <span className="period">{ed.period}</span>
              </div>
              {ed.location && <p className="loc">{ed.location}</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

/**
 * Print CSS. Inlined into the document rather than linked — the PDF is rendered
 * with `setContent`, so there is no server to fetch a stylesheet from, and a
 * silent 404 would produce an unstyled resume that still looks like a PDF.
 */
export const CLASSIC_CSS = `
  @page { size: {{PAGE}}; margin: 0; }

  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    font-family: var(--font-body);
    font-size: var(--size-body);
    line-height: var(--line-height);
    color: #111;
    /* letter-spacing is deliberately never set anywhere in this file. */
  }

  .page {
    width: {{WIDTH}}px;
    min-height: {{HEIGHT}}px;
    padding: var(--pad);
  }

  header { margin-bottom: 14px; }

  h1 {
    font-family: var(--font-display);
    font-size: 20pt;
    margin: 0 0 4px;
    font-weight: 700;
  }

  .contact, .headline { margin: 0; font-size: 9.5pt; }
  .contact { color: #333; }
  .headline { margin-top: 3px; font-style: italic; }

  section { margin-top: var(--section-gap); }

  h2 {
    font-family: var(--font-display);
    color: var(--accent);
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    margin: 0 0 6px;
    padding-bottom: 2px;
    border-bottom: 1px solid var(--accent);
  }

  section > p { margin: 0; }

  /* Keep a role and its bullets on one page. Splitting an entry across a page
     break is the single most common way a resume reads as broken. */
  /* A role with ten bullets runs to roughly half a page. break-inside: avoid
     does NOT make such a block fit: it moves the whole block to the next sheet
     and leaves the bottom half of this one blank. So an entry is allowed to
     split, and the two rules below decide where it may do so. */
  .entry { margin-bottom: var(--entry-gap); break-inside: auto; page-break-inside: auto; }
  .entry:last-child { margin-bottom: 0; }

  /* Never strand a heading. The title/period line stays with what it
     introduces, and a single bullet never splits across sheets. orphans/widows
     also keep a two-line education entry whole without forbidding breaks
     outright, which is why break-inside: avoid is no longer needed there. */
  .entry-head { break-inside: avoid; page-break-inside: avoid; }
  .entry-head, .loc { break-after: avoid; page-break-after: avoid; }
  li { break-inside: avoid; page-break-inside: avoid; orphans: 2; widows: 2; }


  .entry-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
  }

  .role { font-weight: 700; }
  .period { font-size: 9.5pt; color: #333; white-space: nowrap; }
  .loc { margin: 1px 0 0; font-size: 9.5pt; color: #444; }
  /* The judgement line. Set apart from the bullets by colour and size,
     not by a rule or a box, so extraction still reads it as a sentence. */
  .impact { margin: 4px 0 0; font-size: 9.5pt; color: #444; }

  ul { margin: 4px 0 0; padding-left: 18px; }
  li { margin-bottom: 2px; }

  /* Never orphan a heading at the foot of a page. */
  h2 { break-after: avoid; page-break-after: avoid; }

  /* ── paged output ────────────────────────────────────────────────────────
     THE VERTICAL INSET LIVES ON @page, NOT ON .page's PADDING.

     Padding applies once to a box; it does not repeat on each sheet the box
     flows across. With @page margin:0 that put the inset at the top of
     the FIRST page only, and every page after it began flush against the top
     edge of the sheet.

     A literal px value rather than var(--pad): @page is outside the document
     tree, so custom properties do not resolve inside it and the declaration
     would be dropped silently.

     min-height goes too. @page now owns the sheet, and a box still asking for
     the full page height inside a printable area shortened by two margins would
     push a short resume onto a second, empty page. */
  @media print {
    @page { margin: {{PAD}}px 0; }
    .page { min-height: 0; padding-top: 0; padding-bottom: 0; }
  }
`;
