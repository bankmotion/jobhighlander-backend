import type { TemplateProps } from './types';
import { Rich } from '../rich';
import { groupSkills } from '../skills';
import { splitContact } from '../contact';

/**
 * Centred header and section titles, each role led by its result.
 *
 * Where it differs from the other single-column layouts, and why each
 * difference is deliberate rather than incidental:
 *
 *  - The summary carries no heading. It sits directly under the header rule,
 *    where a reader takes it as the opening paragraph without being told.
 *  - A role opens with the EMPLOYER and its dates, then the title in bold, then
 *    the impact sentence, and only then the bullets. The other layouts print
 *    impact last under an "Impact:" label; here it is the first thing read
 *    about the role, which is the point of this layout.
 *  - Each role closes with the skills it used, and the full list comes last, as
 *    one bulleted line per category. By then the reader has seen them used, so
 *    the list confirms rather than introduces.
 *
 * Single column, no tables, no icons: extraction reads it top to bottom in the
 * order it is printed, so presets on this layout may set atsSafe.
 */
export function CenteredLayout({ resume, name, contact }: TemplateProps) {
  const { details, links } = splitContact(contact);

  return (
    <div className="page">
      <header>
        <h1>{name}</h1>
        {resume.headline && <p className="headline">{resume.headline}</p>}
        {details && <p className="contact">{details}</p>}
        {links.map((l) => (
          <p key={l} className="contact">{l}</p>
        ))}
      </header>

      {resume.summary && (
        <section className="summary">
          <p><Rich text={resume.summary} /></p>
        </section>
      )}

      {resume.experience.length > 0 && (
        <section>
          <h2>Professional Experience</h2>
          {resume.experience.map((e, i) => (
            <article key={`${e.company}-${i}`} className="entry">
              <div className="entry-head">
                <span className="org">
                  {e.company}
                  {e.location ? <span className="loc">, {e.location}</span> : null}
                </span>
                <span className="period">{e.period}</span>
              </div>
              {e.title && <p className="role">{e.title}</p>}
              {e.impact && (
                <p className="impact"><Rich text={e.impact} /></p>
              )}
              {e.bullets.length > 0 && (
                <ul>
                  {e.bullets.map((b, j) => (
                    <li key={j}><Rich text={b.text} /></li>
                  ))}
                </ul>
              )}
              {/* Absent on a resume written before the field existed, so the
                  line is simply not printed rather than printed empty. */}
              {(e.skills ?? []).length > 0 && (
                <p className="role-skills">
                  <strong>Skills:</strong> {(e.skills ?? []).join(', ')}
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
            <article key={i} className="entry edu">
              <div className="entry-head">
                <span className="org">
                  {ed.institution}
                  {ed.location ? <span className="loc">, {ed.location}</span> : null}
                </span>
                <span className="period">{ed.period}</span>
              </div>
              {ed.degree && <p className="degree">{ed.degree}</p>}
            </article>
          ))}
        </section>
      )}

      {resume.skills.length > 0 && (
        <section>
          <h2>Professional Skills</h2>
          <ul className="skills">
            {groupSkills(resume.skills).map((g) => (
              <li key={g.category}>
                <strong>{g.category}:</strong> {g.names.join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export const CENTERED_CSS = `
  @page { size: {{PAGE}}; margin: 0; }

  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    font-family: var(--font-body);
    font-size: var(--size-body);
    line-height: var(--line-height);
    color: #111;
    /* letter-spacing is deliberately never set anywhere in this file. Tracking
       on a heading is the most reliable way to make it extract as
       "E D U C A T I O N". */
  }

  /* Wider side margins than the other layouts. Centred headings over a full
     measure look adrift; the narrower column is what holds them together. */
  .page {
    width: {{WIDTH}}px;
    min-height: {{HEIGHT}}px;
    padding: var(--pad) calc(var(--pad) + 16px);
  }

  header { text-align: center; padding-bottom: 10px; border-bottom: 1px solid #111; }

  h1 {
    font-family: var(--font-display);
    font-size: 20pt;
    font-weight: 700;
    line-height: 1.2;
    margin: 0;
  }

  .headline {
    margin: 2px 0 0;
    font-family: var(--font-display);
    font-size: 10.5pt;
    font-weight: 700;
    text-transform: uppercase;
    color: #555;
  }

  .contact { margin: 6px 0 0; }
  .contact + .contact { margin-top: 0; }

  section { margin-top: var(--section-gap); }

  /* Justified, and NOT hyphenated. Hyphenation would match the look more
     closely, but it splits words in the extracted text ("reliabili- ty"),
     which is the one thing an automated reader cannot put back together. */
  .summary p { margin: 0; text-align: justify; }

  /* Title, a gap, then the rule: the rule belongs to the content below it, not
     to the title, which is what makes a centred heading read as a divider. */
  h2 {
    font-family: var(--font-display);
    color: var(--accent);
    font-size: 13pt;
    font-weight: 700;
    text-transform: uppercase;
    text-align: center;
    margin: 12px 0 10px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--accent);
    break-after: avoid;
    page-break-after: avoid;
  }

  /* A role with ten bullets runs to roughly half a page. break-inside: avoid
     does NOT make such a block fit: it moves the whole block to the next sheet
     and leaves the bottom half of this one blank. So an entry is allowed to
     split, and the rules below decide where it may do so. */
  .entry { margin-bottom: var(--entry-gap); break-inside: auto; page-break-inside: auto; }
  .entry:last-child { margin-bottom: 0; }

  .entry-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 12px;
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* Employer, title and impact travel together and stay with the first bullet:
     three lines of heading stranded at the foot of a page is worse than one. */
  .entry-head, .role, .impact { break-after: avoid; page-break-after: avoid; }

  .loc { color: #444; }
  .period { white-space: nowrap; }

  .role {
    margin: 1px 0 0;
    font-family: var(--font-display);
    font-weight: 700;
  }

  /* Body size and colour, unlike the other layouts' impact line. There it is a
     footnote to the bullets; here it is the role's opening statement. */
  .impact { margin: 1px 0 0; }

  /* Closes the role: what the bullets above were built with. */
  .role-skills { margin: 1px 0 0; break-before: avoid; page-break-before: avoid; }

  .degree { margin: 1px 0 0; }
  .edu { margin-bottom: 2px; }

  /* Marker inside the text box, so a wrapped line returns to the bullet's own
     edge instead of hanging under the first word. The marker is spelled out
     because the browser's own inside-marker leaves a gap three spaces wide. */
  ul { margin: 3px 0 0; padding-left: 6px; list-style-position: inside; }
  li::marker { content: "• "; }
  li { margin-bottom: 3px; break-inside: avoid; page-break-inside: avoid; orphans: 2; widows: 2; }

  .skills { margin-top: 0; padding-left: 0; }

  /* ── paged output ────────────────────────────────────────────────────────
     THE VERTICAL INSET LIVES ON @page, NOT ON .page's PADDING.

     Padding applies once to a box; it does not repeat on each sheet the box
     flows across. With @page margin:0 that put the inset at the top of the
     FIRST page only, and every page after it began flush against the top edge
     of the sheet.

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
