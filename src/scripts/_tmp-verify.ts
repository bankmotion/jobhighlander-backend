import { readFileSync } from 'node:fs';
import { prisma } from '../lib/prisma';

const FORM = 'C:/Users/Administrator/Documents/JobHighLander/frontend/app/components/scraper-settings-form.tsx';
const CONFIG = 'C:/Users/Administrator/Documents/JobHighLander/job-seeking/config.py';
const formKeys = () => [...readFileSync(FORM, 'utf8').matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]);
const managedKeys = () => {
  const b = readFileSync(CONFIG, 'utf8').split('DB_MANAGED_KEYS: tuple = (')[1].split(')')[0];
  return [...b.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
};

async function main() {
  const form = formKeys(), managed = managedKeys();
  const db = (await prisma.scraperSetting.findMany()).map((r) => r.key);
  const show = (l: string, x: string[]) => console.log(`${l}: ${x.length ? x.join(', ') : 'NONE ✓'}`);

  console.log(`DB_MANAGED_KEYS=${managed.length}  UI fields=${form.length}  DB rows=${db.length}\n`);
  show('DB-managed but missing from the UI', managed.filter((k) => !form.includes(k)));
  show('In the UI but not DB-managed', form.filter((k) => !managed.includes(k)));
  show('In the DB but not DB-managed', db.filter((k) => !managed.includes(k)));
  show('DB-managed but not seeded', managed.filter((k) => !db.includes(k)));

  console.log('\n--- linkedin coverage ---');
  for (const k of ['enable_linkedin', 'linkedin_search_url', 'linkedin_role_regex', 'linkedin_delay_s']) {
    console.log(`  ${k.padEnd(22)} db=${db.includes(k) ? 'yes' : 'NO'}  ui=${form.includes(k) ? 'yes' : 'NO'}  managed=${managed.includes(k) ? 'yes' : 'NO'}`);
  }

  console.log('\n--- enum drift ---');
  const col = await prisma.$queryRawUnsafe<any[]>("SHOW COLUMNS FROM jobs LIKE 'site'");
  const dbVals = [...col[0].Type.matchAll(/'([a-z]+)'/g)].map((m: any) => m[1]);
  const schemaVals = readFileSync('prisma/schema.prisma', 'utf8').split('enum JobSite {')[1].split('}')[0].trim().split(/\s+/);
  console.log('  mysql column :', dbVals.join(','));
  console.log('  prisma schema:', schemaVals.join(','));
  console.log('  in sync:', JSON.stringify(dbVals) === JSON.stringify(schemaVals) ? 'YES ✓' : 'NO');
  const byS = await prisma.job.groupBy({ by: ['site'], _count: { _all: true } });
  console.log('  groupBy(site) works:', byS.map((s) => `${s.site}=${s._count._all}`).join(' '));
}
main().catch((e) => console.error('FAILED', e.message)).finally(() => prisma.$disconnect());
