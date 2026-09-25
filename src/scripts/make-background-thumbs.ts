import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { chromium } from 'playwright';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';
import { renderResumeHtml } from '../resume/render';
import { PAGE_PX } from '../resume/templates/registry';
import { presetService } from '../services/preset.service';
import { BACKGROUNDS } from '../resume/backgrounds';

/**
 * Thumbnails for the background picker.
 *
 * A sibling of make-thumbnails.ts, and deliberately the same sample resume and
 * the same render path: the two grids sit on one screen, so a difference
 * between them has to mean a difference in the thing being chosen.
 *
 * Every shot uses ONE fixed template. What varies between these images is the
 * background alone -- varying both would make the grid unreadable as a way to
 * choose either.
 *
 * Run:  npx tsx src/scripts/make-background-thumbs.ts
 */
const OUT = join(__dirname, '../../../frontend/public/background-thumbs');

const SAMPLE: TailoredResume = {
  headline: 'Senior Backend Engineer · Go · Kubernetes · AWS',
  summary:
    'Backend engineer with eight years building distributed services at scale. Owns systems end to end, from schema design through on-call, and has led two platform migrations without customer-visible downtime.',
  // Grouped, because the thumbnails are what an admin picks a template from:
  // a preview showing one flat run would misrepresent every real resume.
  skills: (
    [
      ['Languages', ['Go', 'TypeScript', 'SQL']],
      ['Platform', ['Kubernetes', 'AWS', 'Terraform']],
      ['Data', ['PostgreSQL', 'Kafka', 'Redis']],
      ['Practices', ['gRPC', 'CI/CD', 'Observability']],
    ] as const
  ).flatMap(([category, names]) =>
    names.map((name) => ({ name, category, inferred: false })),
  ),
  experience: [
    {
      company: 'Northwind Systems', period: 'Mar 2021 – Present', location: 'Remote',
      title: 'Senior Backend Engineer', titleInferred: false,
      impact: '',
      bullets: [
        'Led the migration of the billing service off a shared monolith, cutting p99 latency from 1.8s to 240ms.',
        'Designed the event pipeline now carrying 40M messages a day with at-least-once delivery guarantees.',
        'Introduced load-shedding and circuit breaking that ended a recurring class of cascading outage.',
      ].map((text) => ({ text, inferred: false })),
    },
    {
      company: 'Vertex Labs', period: 'Jun 2018 – Feb 2021', location: 'Austin, TX',
      title: 'Backend Engineer', titleInferred: false,
      impact: '',
      bullets: [
        'Built the public API used by 300+ integration partners, including versioning and deprecation policy.',
        'Reduced infrastructure spend 34% by right-sizing workloads and moving batch jobs to spot capacity.',
      ].map((text) => ({ text, inferred: false })),
    },
  ],
  education: [
    { location: '', institution: 'University of Illinois', degree: 'BSc Computer Science', period: '2014 – 2018' },
  ],
  gaps: [],
  reviewNotes: [],
};


async function main() {
  await mkdir(OUT, { recursive: true });
  // The profile-agnostic fallback, so the grid does not silently depend on
  // whichever preset happens to be first in the database.
  const preset = await presetService.get('classic-ats');

  const browser = await chromium
    .launch({ channel: 'chrome', args: ['--no-sandbox'] })
    .catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  const page = await browser.newPage({
    viewport: { width: PAGE_PX.letter.width, height: PAGE_PX.letter.height },
    deviceScaleFactor: 2,
  });

  for (const bg of BACKGROUNDS) {
    const html = renderResumeHtml({
      resume: SAMPLE,
      name: 'Alex Morgan',
      contact: 'alex.morgan@example.com | (555) 010-4477 | Denver, CO',
      preset,
      pageSize: 'letter',
      background: bg.key,
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const shot = await page.screenshot({ type: 'webp', quality: 82 });
    const file = join(OUT, `${bg.key}.webp`);
    await writeFile(file, shot);
    logger.info(`  ${bg.key.padEnd(18)} -> ${Math.round(shot.length / 1024)}kb`);
  }

  await browser.close();
  await prisma.$disconnect();
  logger.info(`Wrote ${BACKGROUNDS.length} background thumbnails to ${OUT}`);
}

main().catch(async (err) => {
  logger.error(String(err));
  await prisma.$disconnect();
  process.exit(1);
});
