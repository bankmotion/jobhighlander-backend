/**
 * What does the live `jobs.site` enum actually contain, and does every row fit?
 *
 * Read-only. Run before changing anything: a MODIFY that drops a value silently
 * blanks the rows using it under a non-strict sql_mode, so "are there empty
 * strings" is the first question, not the last.
 */
import { prisma } from '../lib/prisma';
import { JobSite } from '@prisma/client';

async function main() {
  const sqlMode = await prisma.$queryRawUnsafe<{ m: string }[]>('SELECT @@SESSION.sql_mode m');
  console.log(`sql_mode: ${sqlMode[0]?.m}\n`);

  for (const table of ['jobs', 'jobs_temp']) {
    const cols = await prisma.$queryRawUnsafe<{ Type: string }[]>(
      `SHOW COLUMNS FROM \`${table}\` LIKE 'site'`,
    ).catch(() => null);
    if (!cols?.length) {
      console.log(`${table}: no site column\n`);
      continue;
    }
    const type = cols[0].Type;
    const inDb = [...type.matchAll(/'([^']*)'/g)].map((m) => m[1]);
    console.log(`${table}.site enum in DATABASE (${inDb.length}):`);
    console.log(`  ${inDb.join(', ')}`);

    const rows = await prisma.$queryRawUnsafe<{ site: string; c: bigint }[]>(
      `SELECT site, COUNT(*) c FROM \`${table}\` GROUP BY site ORDER BY c DESC`,
    );
    console.log(`  rows by value:`);
    for (const r of rows) {
      const label = r.site === '' ? "'' (BLANKED — a dropped enum value)" : r.site;
      console.log(`    ${String(label).padEnd(38)} ${r.c}`);
    }
    console.log();
  }

  const inSchema = Object.values(JobSite) as string[];
  console.log(`JobSite in the PRISMA CLIENT (${inSchema.length}):`);
  console.log(`  ${inSchema.join(', ')}\n`);

  const dbCols = await prisma.$queryRawUnsafe<{ Type: string }[]>(
    "SHOW COLUMNS FROM `jobs` LIKE 'site'",
  );
  const dbValues = [...dbCols[0].Type.matchAll(/'([^']*)'/g)].map((m) => m[1]);

  const onlyInDb = dbValues.filter((v) => !inSchema.includes(v));
  const onlyInSchema = inSchema.filter((v) => !dbValues.includes(v));

  console.log('DRIFT:');
  console.log(`  in database but NOT in the client: ${onlyInDb.join(', ') || '(none)'}`);
  console.log(`     -> every findMany that reads such a row throws`);
  console.log(`  in client but NOT in the database: ${onlyInSchema.join(', ') || '(none)'}`);
  console.log(`     -> writing one of these fails`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
