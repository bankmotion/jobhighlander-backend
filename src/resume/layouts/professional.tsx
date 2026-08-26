import type { TemplateProps } from './types';
import { Rich } from '../rich';
import { groupSkills } from '../skills';

/**
 * Professional — centred name lockup, a tinted band behind each section
 * heading, and dates in a fixed right-hand column. Reads as executive/consulting
 * rather than engineering.
 *
 * The date column is done with flex, NOT a table: a table layout extracts by
 * interleaving cells row-by-row, which tears each heading away from the content
 * beneath it. Flex degrades to plain reading order instead.
 */
export function ProfessionalLayout({ resume, name, contact }: TemplateProps) {
  return (
    <div className="page">
      <header>
        <h1>{name}</h1>
        {contact && <p className="contact">{contact}</p>}
        {resume.headline && <p className="headline">{resume.headline}</p>}
      </header>

      {resume.summary && (
        <section>
          <h2>Professional Summary</h2>
          <p><Rich text={resume.summary} /></p>
        </section>
      )}

      {resume.skills.length > 0 && (
        <section>
          <h2>Core Competencies</h2>
          {groupSkills(resume.skills).map((g) => (
            <p key={g.category}>
              <strong>{g.category}:</strong> {g.names.join(' | ')}
            </p>
          ))}
        </section>
      )}

      {resume.experience.length > 0 && (
        <section>
          <h2>Professional Experience</h2>
          {resume.experience.map((e, i) => (
            <article key={`${e.company}-${i}`} className="entry">
              <div className="entry-head">
                <div className="left">
                  <span className="role">{e.title}</span>
                  <span className="org">
                    {e.company}
                    {e.location ? `, ${e.location}` : ''}
                  </span>
                </div>
                <span className="period">{e.period}</span>
              </div>
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
                <div className="left">
                  <span className="role">{ed.degree}</span>
                  {ed.institution && <span className="org">{ed.institution}</span>}
                </div>
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

export const PROFESSIONAL_CSS = `
  @page { size: {{PAGE}}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    font-family: var(--font-body);
    font-size: var(--size-body);
    line-height: var(--line-height);
    color: #141414;
  }

  .page { width: {{WIDTH}}px; min-height: {{HEIGHT}}px; padding: var(--pad); }

  header { text-align: center; padding-bottom: 12px; border-bottom: 1px solid #bbb; }

  h1 {
    font-family: var(--font-display);
    font-size: 22pt;
    font-weight: 700;
    margin: 0;
    color: var(--accent);
  }

  .contact  { margin: 5px 0 0; font-size: 9pt; color: #444; }
  .headline { margin: 4px 0 0; font-size: 10.5pt; font-style: italic; color: #333; }

  section { margin-top: var(--section-gap); }

  /* Tinted band. colour-mix keeps the tint derived from the preset accent, so a
     new accent never needs a matching background added by hand. */
  h2 {
    font-family: var(--font-display);
    font-size: 10pt;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    margin: 0 0 7px;
    padding: 4px 8px;
    break-after: avoid;
    page-break-after: avoid;
  }

  section > p { margin: 0; padding: 0 2px; }

  .entry { margin-bottom: var(--entry-gap); padding: 0 2px; break-inside: avoid; page-break-inside: avoid; }
  .entry:last-child { margin-bottom: 0; }

  .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; }
  .left { display: flex; flex-direction: column; min-width: 0; }
  .role { font-weight: 700; }
  .org  { font-size: 9.5pt; color: #444; }
  .period { font-size: 9.5pt; color: #444; white-space: nowrap; text-align: right; }

  ul { margin: 5px 0 0; padding-left: 18px; }
  li { margin-bottom: 2px; }
  /* The judgement line. Set apart from the bullets by colour and size,
     not by a rule or a box, so extraction still reads it as a sentence. */
  .impact { margin: 4px 0 0; font-size: 9.5pt; color: #444; }

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
