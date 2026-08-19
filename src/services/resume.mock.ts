import type { TailoredResume } from '../schemas/resume.schema';

interface MockSources {
  jobTitle: string;
  jobCompany: string | null;
  employment: { company: string | null; location: string | null; period: string }[];
  education: { university: string | null; degree: string | null; period: string }[];
  hasNotes: boolean;
}

/**
 * A canned resume shaped exactly like the real thing, built from the caller's
 * actual job and profile rows so the UI renders real names and dates.
 *
 * Dev-only: exercised when AI_MOCK=1 and NODE_ENV !== 'production'. It exists
 * because the API path cannot be demonstrated without credits, and a UI that
 * has never rendered a populated response is a UI nobody has tested.
 */
export function mockResume(src: MockSources): TailoredResume {
  const inferred = !src.hasNotes;

  const experience = src.employment.map((e, i) => ({
    company: e.company ?? '',
    period: e.period,
    location: e.location ?? '',
    // Most recent stint reads as the most senior — the same heuristic the real
    // prompt is told to apply.
    title: i === 0 ? 'Senior Data Engineer' : 'Data Engineer',
    titleInferred: inferred,
    bullets: [
      {
        text: `Built and operated production data pipelines in Python and SQL at ${e.company ?? 'this employer'}.`,
        inferred,
      },
      {
        text: `Stood up new data sources end to end — schema discovery, transformation, and integration downstream.`,
        inferred,
      },
      {
        text: `Owned reliability and data quality for the pipelines in scope, including alerting and on-call response.`,
        inferred,
      },
    ],
  }));

  return {
    headline: 'Senior AI Data Engineer · Python · SQL · LLM Systems · Data Platform',
    summary: `Data engineer with experience across ${src.employment
      .map((e) => e.company)
      .filter(Boolean)
      .join(', ')}, building production pipelines and LLM-backed internal tooling. Aimed at the ${src.jobTitle} role${
      src.jobCompany ? ` at ${src.jobCompany}` : ''
    }.`,
    skills: [
      'Python',
      'SQL',
      'Airflow',
      'Spark',
      'Agent orchestration',
      'Retrieval pipelines (RAG)',
      'Evaluation harnesses',
      'dbt',
      'Snowflake / BigQuery',
      'Kafka',
      'AWS / GCP',
    ].map((name) => ({ name, inferred })),
    experience,
    education: src.education.map((e) => ({
      institution: e.university ?? '',
      degree: e.degree ?? '',
      period: e.period,
    })),
    gaps: [
      'Posting centres on marketing data — CDP, segmentation, campaign analytics. Nothing in this career history touches marketing data.',
      'Asks for conversational analytics alongside a BI team — no evidence of BI partnership.',
    ],
    reviewNotes: [
      'THIS IS MOCK OUTPUT — AI_MOCK=1 is set, so no model was called.',
      'Verify every title: all were drafted from company and career arc, not from anything you supplied.',
      'Every bullet is invented. Replace with what you actually did before sending.',
      'Check your dates for unexplained gaps between roles.',
    ],
  };
}
