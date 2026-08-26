import type { TemplateProps } from './types';
import { Rich } from '../rich';
import { groupSkills } from '../skills';

/**
 * Creative — a coloured sidebar carrying contact, skills and education, beside
 * a main column of summary and experience.
 *
 * THIS LAYOUT IS NOT ATS-SAFE, and its presets are flagged accordingly.
 *
 * The reason is measured, not folklore: PDF text extraction follows page
 * GEOMETRY, not DOM order. Rendering the main column first in the markup and
 * positioning it second with flex `order` was tested — extraction still returned
 * the sidebar first. There is no markup arrangement that fixes it, so a parser
 * reads skills and education before any employment history.
 *
 * It is built with flex rather than a table deliberately. Both reorder, but a
 * table additionally interleaves cells row-by-row and tears section headings
 * away from their content — flex at least keeps each column intact.
 *
 * Use for a design or marketing role sent directly to a human. Not for a portal.
 */
export function CreativeLayout({ resume, name, contact }: TemplateProps) {
  return (
    <div className="page">
      <aside className="side">
        <h1>{name}</h1>
        {resume.headline && <p className="headline">{resume.headline}</p>}

        {contact && (
          <div className="block">
            <h2>Contact</h2>
            <p className="contact">{contact.split(' | ').join('\n')}</p>
          </div>
        )}

        {resume.skills.length > 0 && (
          <div className="block">
            <h2>Skills</h2>
            {/* The sidebar is narrow, so each group gets its own heading and
                its own short list rather than one long undifferentiated run. */}
            {groupSkills(resume.skills).map((g) => (
              <div key={g.category} className="skill-group">
                <strong>{g.category}</strong>
                <ul className="plain">
                  {g.names.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {resume.education.length > 0 && (
          <div className="block">
            <h2>Education</h2>
            {resume.education.map((ed, i) => (
              <div key={i} className="edu">
                <span className="deg">{ed.degree}</span>
                {ed.institution && <span className="inst">{ed.institution}</span>}
                {ed.location && <span className="inst">{ed.location}</span>}
                {ed.period && <span className="per">{ed.period}</span>}
              </div>
            ))}
          </div>
        )}
      </aside>

      <main className="main">
        {resume.summary && (
          <section>
            <h2>Profile</h2>
            <p><Rich text={resume.summary} /></p>
          </section>
        )}

        {resume.experience.length > 0 && (
          <section>
            <h2>Experience</h2>
            {resume.experience.map((e, i) => (
              <article key={`${e.company}-${i}`} className="entry">
                <span className="role">{e.title}</span>
                <p className="org">
                  {e.company}
                  {e.location ? ` · ${e.location}` : ''} — {e.period}
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
      </main>
    </div>
  );
}

export const CREATIVE_CSS = `
  @page { size: {{PAGE}}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }

  body {
    font-family: var(--font-body);
    font-size: var(--size-body);
    line-height: var(--line-height);
    color: #1a1a1a;
  }

  /* Flex, never a table — see the note on the component. */
  .page { width: {{WIDTH}}px; min-height: {{HEIGHT}}px; display: flex; }

  .side {
    width: 34%;
    background: var(--accent);
    color: #fff;
    padding: var(--pad) calc(var(--pad) * 0.55);
  }

  .side h1 {
    font-family: var(--font-display);
    font-size: 19pt;
    font-weight: 700;
    margin: 0 0 4px;
    line-height: 1.15;
  }

  .side .headline { margin: 0; font-size: 9.5pt; opacity: 0.9; }

  .block { margin-top: 20px; }

  .side h2 {
    font-family: var(--font-display);
    font-size: 9pt;
    font-weight: 700;
    text-transform: uppercase;
    margin: 0 0 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(255,255,255,0.35);
  }

  /* Newlines in the contact string, preserved rather than joined with a glyph. */
  .contact { margin: 0; font-size: 8.5pt; white-space: pre-line; word-break: break-word; }

  .plain { list-style: none; margin: 0; padding: 0; font-size: 9pt; }
  .plain li { margin-bottom: 3px; }

  .edu { display: flex; flex-direction: column; margin-bottom: 8px; font-size: 9pt; }
  .edu .deg  { font-weight: 700; }
  .edu .inst { opacity: 0.9; }
  .edu .per  { opacity: 0.75; font-size: 8.5pt; }

  .main { width: 66%; padding: var(--pad) calc(var(--pad) * 0.75); }

  .main h2 {
    font-family: var(--font-display);
    font-size: 11pt;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 7px;
    break-after: avoid;
    page-break-after: avoid;
  }

  .main section { margin-bottom: var(--section-gap); }
  .main section > p { margin: 0; }

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


  .role { font-weight: 700; font-size: 11pt; }
  .org  { margin: 1px 0 0; font-size: 9pt; color: #555; }

  ul { margin: 5px 0 0; padding-left: 16px; }
  li { margin-bottom: 3px; }
  /* The judgement line. Set apart from the bullets by colour and size,
     not by a rule or a box, so extraction still reads it as a sentence. */
  .impact { margin: 4px 0 0; font-size: 9.5pt; color: #444; }

  /* ── paged output ────────────────────────────────────────────────────────
     Same fix as the single-column layouts: the vertical inset moves to @page so
     it repeats on every sheet, because padding applies once to a box rather
     than to each page the box flows across. See classic.tsx for the full note.

     Two differences this layout forces:

     .page keeps a min-height — one printable page, not one SHEET — so the
     accent column still fills the page instead of stopping mid-sheet on a short
     resume.

     The cost, accepted deliberately: the accent column no longer bleeds to the
     top and bottom edges of the paper, because the @page margin is not paintable
     by the document. A repeating top inset and a full-bleed sidebar cannot both
     exist in print CSS, and text that starts hard against the paper edge on
     page 2 is the worse of the two. */
  @media print {
    @page { margin: {{PAD}}px 0; }
    .page { min-height: calc({{HEIGHT}}px - {{PAD}}px * 2); }
    .side, .main { padding-top: 0; padding-bottom: 0; }
  }
`;
