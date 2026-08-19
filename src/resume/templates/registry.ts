import type { ComponentType } from 'react';
import { ClassicAts, CLASSIC_ATS_CSS, type TemplateProps } from './classic-ats';

export type PageSize = 'letter' | 'a4';

/** Page geometry at 96 DPI — the resolution Chrome lays out at. */
export const PAGE_PX: Record<PageSize, { width: number; height: number; css: string }> = {
  letter: { width: 816, height: 1056, css: 'letter' }, //  8.5 x 11 in
  a4: { width: 794, height: 1123, css: 'A4' }, //         210 x 297 mm
};

export interface ResumeTemplate {
  key: string;
  name: string;
  /**
   * Whether the layout survives applicant-tracking-system text extraction.
   * Measured, not claimed — and never presented to a user as a guarantee,
   * since real ATS stacks use several parsers that disagree with each other.
   */
  atsSafe: boolean;
  Component: ComponentType<TemplateProps>;
  css: string;
}

export const TEMPLATES = {
  'classic-ats': {
    key: 'classic-ats',
    name: 'Classic ATS',
    atsSafe: true,
    Component: ClassicAts,
    css: CLASSIC_ATS_CSS,
  },
} satisfies Record<string, ResumeTemplate>;

export type TemplateKey = keyof typeof TEMPLATES;
export const DEFAULT_TEMPLATE: TemplateKey = 'classic-ats';

export function getTemplate(key: string | undefined): ResumeTemplate {
  return TEMPLATES[(key ?? DEFAULT_TEMPLATE) as TemplateKey] ?? TEMPLATES[DEFAULT_TEMPLATE];
}
