import type { TailoredResume } from '../../schemas/resume.schema';

/**
 * Every layout takes exactly this and nothing else. A layout never sees the
 * job, the profile row, the preset or the model — it is a pure function of the
 * finished document, which is what makes swapping one free.
 */
export interface TemplateProps {
  resume: TailoredResume;
  name: string;
  contact: string;
}
