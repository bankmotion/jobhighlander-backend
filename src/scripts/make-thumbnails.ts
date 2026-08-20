import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { chromium } from 'playwright';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';
import { presetService } from '../services/preset.service';
import { renderResumeHtml } from '../resume/render';
import { PAGE_PX } from '../resume/templates/registry';
import type { TailoredResume } from '../schemas/resume.schema';

/**
 * Pre-render one thumbnail per preset.
 *
 * Build-time, not on-demand: a picker showing 25 presets would otherwise mean 25
 * Chromium pages per page load. These are written into the frontend's `public/`
 * so Next serves them as ordinary static files.
 *
 *   npx tsx src/scripts/make-thumbnails.ts
 */

const OUT = join(__dirname, '../../../frontend/public/template-thumbs');

/**
 * One fictional candidate across every thumbnail. If each preview showed
 * different content, users would compare the writing instead of the design —
 * which is the one thing a template picker must not do.
 */
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
      bullets: [
        'Led the migration of the billing service off a shared monolith, cutting p99 latency from 1.8s to 240ms.',
        'Designed the event pipeline now carrying 40M messages a day with at-least-once delivery guarantees.',
        'Introduced load-shedding and circuit breaking that ended a recurring class of cascading outage.',
      ].map((text) => ({ text, inferred: false })),
    },
    {
      company: 'Vertex Labs', period: 'Jun 2018 – Feb 2021', location: 'Austin, TX',
      title: 'Backend Engineer', titleInferred: false,
      bullets: [
        'Built the public API used by 300+ integration partners, including versioning and deprecation policy.',
        'Reduced infrastructure spend 34% by right-sizing workloads and moving batch jobs to spot capacity.',
      ].map((text) => ({ text, inferred: false })),
    },
  ],
  education: [
    { institution: 'University of Illinois', degree: 'BSc Computer Science', period: '2014 – 2018' },
  ],
  gaps: [],
  reviewNotes: [],
};

async function main() {
  const presets = await presetService.list();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium
    .launch({ channel: 'chrome', args: ['--no-sandbox'] })
    .catch(() => chromium.launch({ args: ['--no-sandbox'] }));

  const page = await browser.newPage({
    viewport: { width: PAGE_PX.letter.width, height: PAGE_PX.letter.height },
    // 2x so the thumbnail stays sharp on a retina display when scaled down.
    deviceScaleFactor: 2,
  });

  for (const preset of presets) {
    const html = renderResumeHtml({
      resume: SAMPLE,
      name: 'Alex Morgan',
      contact: 'alex.morgan@example.com | (555) 010-4477 | Denver, CO',
      preset,
      pageSize: 'letter',
    });
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const shot = await page.screenshot({ type: 'webp', quality: 82 });
    const file = join(OUT, `${preset.key}.webp`);
    await writeFile(file, shot);
    logger.info(`  ${preset.key.padEnd(18)} -> ${file} (${Math.round(shot.length / 1024)}kb)`);
  }

  await browser.close();
  await prisma.$disconnect();
  logger.info(`Wrote ${presets.length} thumbnails to ${OUT}`);
}

main().catch(async (e) => {
  logger.error(String(e));
  await prisma.$disconnect();
  process.exit(1);
});
