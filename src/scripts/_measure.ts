import { chromium } from 'playwright';
import { prisma } from '../lib/prisma';
import { renderResumeHtml } from '../resume/render';
import { presetService } from '../services/preset.service';
import { PAGE_PX } from '../resume/templates/registry';

const PAD = 54; // regular density
const USABLE = PAGE_PX.letter.height - PAD * 2; // printable height per sheet

const PROBE = `JSON.stringify(
  Array.from(document.querySelectorAll('section, h2, .entry')).map(function (el) {
    var r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className || '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').slice(0, 42),
      top: Math.round(r.top),
      height: Math.round(r.height),
      bottom: Math.round(r.bottom)
    };
  })
)`;

async function main() {
  const row = await prisma.resume.findUnique({
    where: { id: 44 },
    select: { data: true, templateKey: true, profileId: true },
  });
  if (!row) throw new Error('resume 44 missing');

  const profile = await prisma.profile.findUnique({
    where: { id: row.profileId },
    select: { firstName: true, lastName: true, email: true, phone: true, location: true, linkedin: true },
  });
  const preset = await presetService.get(row.templateKey);

  const html = renderResumeHtml({
    resume: row.data as never,
    name: [profile!.firstName, profile!.lastName].filter(Boolean).join(' '),
    contact: [profile!.email, profile!.phone, profile!.location, profile!.linkedin].filter(Boolean).join(' | '),
    preset,
    pageSize: 'letter',
  });

  const browser = await chromium
    .launch({ channel: 'chrome', args: ['--no-sandbox'] })
    .catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'domcontentloaded' });
  await page.emulateMedia({ media: 'print' });

  const blocks = JSON.parse(await page.evaluate(PROBE)) as {
    tag: string;
    cls: string;
    text: string;
    top: number;
    height: number;
    bottom: number;
  }[];

  console.log(`usable height per sheet: ${USABLE}px (letter ${PAGE_PX.letter.height} - 2x${PAD})\n`);
  for (const b of blocks) {
    const startPage = Math.floor(b.top / USABLE) + 1;
    const endPage = Math.floor((b.bottom - 1) / USABLE) + 1;
    const spans = startPage !== endPage ? `  SPANS ${startPage}->${endPage}` : '';
    const tall = b.cls === 'entry' && b.height > USABLE * 0.55 ? '  <-- TALLER THAN HALF A PAGE' : '';
    console.log(
      `${b.tag.padEnd(7)} ${String(b.cls).padEnd(12)} top=${String(b.top).padStart(5)} h=${String(
        b.height,
      ).padStart(4)} p${startPage}${spans}${tall}  ${b.text}`,
    );
  }

  await browser.close();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(String(e).slice(0, 400));
  await prisma.$disconnect();
  process.exit(1);
});
