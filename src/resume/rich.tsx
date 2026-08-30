import { Fragment } from 'react';

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

export const stripTags = (text: string): string => text.replace(/<\/?b>/g, '');
