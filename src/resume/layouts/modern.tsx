import type { TemplateProps } from './types';
import { Rich } from '../rich';
import { groupSkills } from '../skills';

export function ModernLayout({ resume, name, contact }: TemplateProps) {
  return (
    <div className="page">
      <header>
        <h1>{name}</h1>
        {resume.headline && <p className="headline">{resume.headline}</p>}
        {contact && <p className="contact">{contact}</p>}
      </header>

      {resume.summary && (
        <section>
          <h2>Summary</h2>
          <p><Rich text={resume.summary} /></p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section>
          <h2>Experience</h2>
          {resume.experience.map((e, i) => (
            <article key={`${e.company}-${i}`} className="entry">
              <div className="entry-head">
                <span className="role">{e.title}</span>
                <span className="period">{e.period}</span>
              </div>
              <p className="org">
                {e.company}
                {e.location ? ` · ${e.location}` : ''}
              </p>
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

      {resume.skills.length > 0 && (
        <section>
          <h2>Skills</h2>
          {groupSkills(resume.skills).map((g) => (
            <p className="skills" key={g.category}>
              <strong>{g.category}:</strong> {g.names.join('   ')}
            </p>
          ))}
        </section>
      )}

      {resume.education.length > 0 && (
        <section>
          <h2>Education</h2>
          {resume.education.map((ed, i) => (
            <article key={i} className="entry">
              <div className="entry-head">
                <span className="role">{ed.degree}</span>
                <span className="period">{ed.period}</span>
              </div>
              {(ed.institution || ed.location) && (
                <p className="org">{[ed.institution, ed.location].filter(Boolean).join(' · ')}</p>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

export const MODERN_CSS = `
  @page { size: {{PAGE}}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    font-family: var(--font-body);
    font-size: var(--size-body);
    line-height: var(--line-height);
    color: #1a1a1a;
  }

  .page { width: {{WIDTH}}px; min-height: {{HEIGHT}}px; padding: var(--pad); }

  header { padding-bottom: 10px; border-bottom: 3px solid var(--accent); }

  h1 {
    font-family: var(--font-display);
    font-size: 24pt;
    font-weight: 700;
    margin: 0;
    color: var(--accent);
  }

  .headline { margin: 4px 0 0; font-size: 11pt; color: #333; }
  .contact  { margin: 6px 0 0; font-size: 9pt;  color: #555; }

  section { margin-top: var(--section-gap); }

  /* Uppercase without tracking. Letter-spacing on a heading is the single most
     reliable way to make it extract as "E D U C A T I O N". */
  h2 {
    font-family: var(--font-display);
    font-size: 9.5pt;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 6px;
    break-after: avoid;
    page-break-after: avoid;
  }

  section > p { margin: 0; }

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


  .entry-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .role   { font-weight: 700; font-size: 11pt; }
  .period { font-size: 9pt; color: #555; white-space: nowrap; }
  .org    { margin: 1px 0 0; font-size: 9.5pt; color: #444; }

  ul { margin: 5px 0 0; padding-left: 16px; }
  li { margin-bottom: 3px; }

  /* Wide word-spacing rather than a bullet character: a separator glyph is one
     more thing a parser can mangle, and the gap reads the same. */
  .skills { word-spacing: 6px; }
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
