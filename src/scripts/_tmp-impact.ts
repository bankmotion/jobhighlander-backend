import { jobService } from '../services/job.service';
import { prisma } from '../lib/prisma';

async function try_(label: string, fn: () => Promise<any>) {
  try {
    const r = await fn();
    const detail = r?.pagination ? `${r.pagination.total} total, ${r.items.length} items`
      : Array.isArray(r?.sites) ? `sites: ${r.sites.join(',')}`
      : r?.site ? `site=${r.site}` : '';
    console.log(`OK    ${label}  ${detail}`);
  } catch (e) {
    console.log(`THROW ${label} -> ${(e as Error).message.split('\n').find((l) => l.includes('not found in enum')) ?? (e as Error).message.slice(0, 80)}`);
  }
}

async function main() {
  await try_('jobService.list (remote-only, default view)', () => jobService.list({ remote: true, page: 1, pageSize: 20 }));
  await try_('jobService.list (all jobs)', () => jobService.list({ remote: false, page: 1, pageSize: 20 }));
  await try_('jobService.filters() — sources dropdown', () => (jobService as any).filters());
  await try_('jobService.list filtered to site=linkedin', () => jobService.list({ sites: ['linkedin'], remote: false, page: 1, pageSize: 5 }));
  const one = await prisma.job.findFirst({ where: { site: 'linkedin' }, select: { id: true } });
  await try_(`jobService.getById(${one!.id}) — a LinkedIn job`, () => jobService.getById(one!.id));
}
main().catch((e) => console.error('FAILED', e)).finally(() => prisma.$disconnect());
