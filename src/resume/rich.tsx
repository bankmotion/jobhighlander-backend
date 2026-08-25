import { Fragment } from 'react';

/**
 * Render model-authored text that may contain <b> emphasis.
 *
 * PARSED, NOT INJECTED. The obvious implementation is
 * `dangerouslySetInnerHTML`, and it is the wrong one: this string comes from a
 * language model working on an attacker-influenceable job description, so any
 * path that hands it to the HTML parser is a script-injection route into a
 * document we then render in a browser to make a PDF. This splits on the one
 * tag we allow and emits React elements, so every other character — including
 * a literal `<script>` — is escaped as text by React itself.
 *
 * <b> is the ONLY tag honoured. Anything else survives as visible text, which
 * is the behaviour that teaches the model to stop emitting it.
 *
 * Emphasis is ATS-safe in a way the other rejected effects are not: bold is a
 * font-weight, so extraction reads the same characters either way. Compare
 * `letter-spacing`, which shatters words, or tables, which reorder them.
 */
export function Rich({ text }: { text: string }) {
  if (!text) return null;
  if (!text.includes('<b>')) return <>{text}</>;

  // Split on the tag pair, keeping the captured inner text. An unclosed <b>
  // simply leaves the remainder unbolded rather than swallowing the document.
  const parts = text.split(/<b>([\s\S]*?)<\/b>/g);

  return (
    <>
      {parts.map((part, i) =>
        // Odd indices are the captured groups, i.e. the bolded runs.
        i % 2 === 1 ? <strong key={i}>{part}</strong> : <Fragment key={i}>{part}</Fragment>,
      )}
    </>
  );
}

/**
 * The same text with the tags removed, for places that cannot carry markup.
 *
 * The cover letter is pasted into an email body as plain text, and a headline
 * is measured for length before it is drawn, so both need the characters
 * without the tags.
 */
export const stripTags = (text: string): string => text.replace(/<\/?b>/g, '');
