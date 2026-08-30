import type { TailoredResume } from '../../schemas/resume.schema';

export interface TemplateProps {
  resume: TailoredResume;
  name: string;
  contact: string;
}
