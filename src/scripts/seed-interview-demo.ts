import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Seed a realistic interview timeline onto one (profile, job) pairing, so the
 * dashboard can be looked at with something on it.
 *
 * `npm run seed:interview-demo -- [jobId] [profileId] [email]`
 * defaults: 12486  1  pavelvulfin@gmail.com
 *
 * DESTRUCTIVE FOR THAT ONE PAIRING: an existing timeline is deleted and
 * rebuilt, so the script can be re-run to get back to a known state. It touches
 * nothing else — not the application mark, not other profiles, not other jobs.
 *
 * The data is chosen to exercise every visual state the timeline can render:
 * a passed step, a cancelled one, a step wearing TWO badges, a step holding TWO
 * panels, a step with no date at all, two different source time zones, and both
 * past and upcoming sittings.
 */

const [jobIdArg, profileIdArg, emailArg] = process.argv.slice(2);
const JOB_ID = Number(jobIdArg ?? 12486);
const PROFILE_ID = Number(profileIdArg ?? 1);
const EMAIL = emailArg ?? 'pavelvulfin@gmail.com';

/**
 * A wall clock in a named zone as the UTC instant it denotes.
 *
 * Same two-pass correction as `frontend/lib/tz.ts` — the first guess uses the
 * offset at the guessed instant, which is an hour out on a DST changeover day,
 * so the offset is re-read at the corrected instant. Duplicated rather than
 * shared because the two live in different packages and this is nine lines.
 */
function zoned(wall: string, timeZone: string): Date {
  const [, y, mo, d, hh, mm] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
    .exec(wall)!
    .map(Number);
  const offset = (utcMs: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utcMs));
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0');
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - utcMs;
  };
  const guess = Date.UTC(y, mo - 1, d, hh, mm);
  const o1 = offset(guess);
  let utc = guess - o1;
  const o2 = offset(utc);
  if (o2 !== o1) utc = guess - o2;
  return new Date(utc);
}

const ET = 'America/New_York';
const PT = 'America/Los_Angeles';

/** The shape the script writes. `stages` are stage-type KEYS, resolved below. */
const PLAN: {
  stages: string[];
  title: string | null;
  result: 'pending' | 'passed' | 'failed' | 'cancelled';
  panels: {
    title?: string;
    note?: string;
    meetingUrl?: string;
    at?: [wall: string, zone: string];
    durationMin?: number;
  }[];
}[] = [
  {
    stages: ['recruiter_screen'],
    title: 'Recruiter screen — Dana Whitfield',
    result: 'passed',
    panels: [
      {
        title: 'Intro call',
        at: ['2026-08-24T10:00', ET],
        durationMin: 30,
        meetingUrl: 'https://meet.google.com/xyz-demo-abc',
        note:
          'Went well. Confirmed fully remote, US hours with flexibility.\n' +
          'Comp band quoted: $135k–$160k + clearance bonus.\n' +
          'She flagged that the security clearance paperwork starts only after the offer.\n' +
          'Next: hands them to the engineering team for a technical screen.',
      },
    ],
  },
  {
    stages: ['take_home'],
    title: 'Take-home — waived',
    result: 'cancelled',
    panels: [
      {
        title: 'Not required',
        note:
          'They waived the take-home after reviewing the GitHub portfolio.\n' +
          'Going straight to the live technical instead.',
      },
    ],
  },
  {
    // Two badges on one step: the point of allowing more than one.
    stages: ['tech', 'live_coding'],
    title: 'Technical round',
    result: 'passed',
    panels: [
      {
        title: 'Part 1 — Systems & networking Q&A (Sarah Kim)',
        at: ['2026-08-25T09:00', ET],
        durationMin: 45,
        meetingUrl: 'https://leidos.zoom.us/j/demo-98765',
        note:
          'TLS handshake walkthrough, SIEM pipeline design, incident triage scenarios.\n' +
          'Asked a lot about log volume at scale — worth reviewing Splunk vs ELK trade-offs.',
      },
      {
        title: 'Part 2 — Live coding (CoderPad)',
        at: ['2026-08-25T10:00', ET],
        durationMin: 45,
        meetingUrl: 'https://coderpad.io/demo-session',
        note:
          'Python. Parse an auth log, detect brute-force patterns, then extend it to a sliding window.\n' +
          'Finished both parts with time left. Interviewer said feedback in ~2 days.',
      },
    ],
  },
  {
    // A different source zone from every other panel — this is the one that
    // shows the dual-timezone stamp actually doing its job.
    stages: ['system_design'],
    title: 'Architecture deep-dive',
    result: 'pending',
    panels: [
      {
        title: 'System design — West Coast team',
        at: ['2026-08-27T11:00', PT],
        durationMin: 60,
        meetingUrl: 'https://leidos.zoom.us/j/demo-11223',
        note:
          'Prep: design a multi-tenant log ingestion pipeline with retention tiers.\n' +
          'They said to expect questions on FedRAMP boundaries.',
      },
    ],
  },
  {
    stages: ['culture', 'hiring_manager'],
    title: 'Team fit + manager',
    result: 'pending',
    panels: [
      {
        title: 'Culture conversation',
        at: ['2026-08-31T09:30', ET],
        durationMin: 30,
        note: 'With two engineers from the platform team. STAR stories — prep the incident one.',
      },
      {
        title: 'Hiring manager wrap-up',
        at: ['2026-08-31T10:15', ET],
        durationMin: 30,
        meetingUrl: 'https://meet.google.com/demo-mgr-call',
        note: 'Marcus Hale, Director of Cyber Engineering. Ask about on-call rotation and team size.',
      },
    ],
  },
  {
    // No date anywhere — the rail shows no marker rather than inventing one.
    stages: ['offer'],
    title: null,
    result: 'pending',
    panels: [
      {
        title: 'Offer & clearance paperwork',
        note:
          'Nothing scheduled yet. Dana said the offer call comes within a week of the final round,\n' +
          'and that the clearance process runs 6–10 weeks after signing.',
      },
    ],
  },
];

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) throw new Error(`No user with email ${EMAIL}`);

  const profile = await prisma.profile.findUnique({
    where: { id: PROFILE_ID },
    select: { id: true, ownerId: true, firstName: true, lastName: true },
  });
  if (!profile) throw new Error(`No profile ${PROFILE_ID}`);

  const job = await prisma.job.findUnique({
    where: { id: JOB_ID },
    select: { id: true, title: true, company: true },
  });
  if (!job) throw new Error(`No job ${JOB_ID}`);

  // The applied mark is the precondition the real endpoint enforces, so the
  // seed creates it rather than bypassing it — otherwise the demo row would be
  // in a state the app itself cannot produce.
  const application = await prisma.jobApplication.upsert({
    where: { profileId_jobId: { profileId: PROFILE_ID, jobId: JOB_ID } },
    update: {},
    create: {
      profileId: PROFILE_ID,
      jobId: JOB_ID,
      jobTitle: job.title,
      jobCompany: job.company,
      markedById: user.id,
    },
    select: { id: true, jobTitle: true, jobCompany: true, appliedAt: true },
  });

  const types = await prisma.interviewStageType.findMany({ select: { id: true, key: true } });
  const byKey = new Map(types.map((t) => [t.key, t.id]));
  const missing = [...new Set(PLAN.flatMap((s) => s.stages))].filter((k) => !byKey.has(k));
  if (missing.length) throw new Error(`Missing stage types: ${missing.join(', ')} — run seed:stage-types`);

  // Rebuild from scratch so re-running lands on a known state. Cascades take
  // the steps, badges and panels with it.
  const existing = await prisma.interview.findUnique({
    where: { profileId_jobId: { profileId: PROFILE_ID, jobId: JOB_ID } },
    select: { id: true },
  });
  if (existing) {
    await prisma.interview.delete({ where: { id: existing.id } });
    logger.info(`Removed existing timeline #${existing.id}`);
  }

  const interview = await prisma.interview.create({
    data: {
      profileId: PROFILE_ID,
      jobId: JOB_ID,
      jobTitle: application.jobTitle,
      jobCompany: application.jobCompany,
      status: 'active',
      openedById: user.id,
      steps: {
        create: PLAN.map((step, i) => ({
          title: step.title,
          result: step.result,
          sortOrder: i,
          stages: {
            create: step.stages.map((key, j) => ({ stageTypeId: byKey.get(key)!, sortOrder: j })),
          },
          panels: {
            create: step.panels.map((p, j) => ({
              title: p.title ?? null,
              note: p.note ?? null,
              meetingUrl: p.meetingUrl ?? null,
              scheduledAt: p.at ? zoned(p.at[0], p.at[1]) : null,
              timezone: p.at ? p.at[1] : null,
              durationMin: p.durationMin ?? null,
              sortOrder: j,
            })),
          },
        })),
      },
    },
    select: {
      id: true,
      steps: {
        orderBy: { sortOrder: 'asc' },
        select: {
          sortOrder: true,
          title: true,
          result: true,
          stages: { select: { stageType: { select: { name: true } } } },
          panels: {
            orderBy: { sortOrder: 'asc' },
            select: { title: true, scheduledAt: true, timezone: true },
          },
        },
      },
    },
  });

  const who = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  logger.info(`Timeline #${interview.id} — ${job.title} @ ${job.company} for ${who} (profile ${PROFILE_ID})`);
  logger.info(`Applied ${application.appliedAt.toISOString().slice(0, 10)} · opened by ${EMAIL}`);
  for (const s of interview.steps) {
    const badges = s.stages.map((x) => x.stageType.name).join(' + ') || '(none)';
    logger.info(`  ${s.sortOrder}. [${badges}] ${s.title ?? ''} — ${s.result}`);
    for (const p of s.panels) {
      const when = p.scheduledAt
        ? `${p.scheduledAt.toISOString().slice(0, 16).replace('T', ' ')}Z (${p.timezone})`
        : 'no time set';
      logger.info(`       · ${p.title} — ${when}`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  logger.error(String(e));
  await prisma.$disconnect();
  process.exit(1);
});
