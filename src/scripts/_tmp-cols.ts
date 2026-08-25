import { prisma } from '../lib/prisma';
async function main() {
  for (const t of ['jobs', 'jobs_temp']) {
    const c = await prisma.$queryRawUnsafe<any[]>(`SHOW COLUMNS FROM ${t} LIKE 'site'`);
    console.log(t, JSON.stringify({ Null: c[0].Null, Default: c[0].Default, Extra: c[0].Extra }));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
