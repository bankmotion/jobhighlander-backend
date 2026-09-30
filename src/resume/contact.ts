/**
 * Split the contact line into its plain details and its links.
 *
 * `profileIdentity` hands every layout one string, joined with " | ". Most
 * layouts print it as it comes. A layout that centres its header reads badly
 * with a long profile URL trailing the email on the same line, so it sets the
 * links on a line of their own, and this is what tells the two apart.
 *
 * Shared between the page layout and the Word export so the two documents
 * cannot disagree about which part is a link.
 */
export function splitContact(contact: string): { details: string; links: string[] } {
  const parts = contact
    .split(' | ')
    .map((p) => p.trim())
    .filter(Boolean);
  const isLink = (p: string) =>
    // An email at a link-like domain is still an email.
    !p.includes('@') && (/^(https?:\/\/|www\.)/i.test(p) || /\b(linkedin|github)\.com\b/i.test(p));
  return {
    details: parts.filter((p) => !isLink(p)).join(' | '),
    links: parts.filter(isLink),
  };
}
