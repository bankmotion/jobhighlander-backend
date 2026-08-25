import { stageTypeService } from '../services/stageType.service';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Seed the starter interview stage badges. Idempotent — only fills in keys that
 * are missing, so re-running it never undoes a rename, recolour or archive.
 *
 * `npm run seed:stage-types`
 */
async function main() {
  const added = await stageTypeService.seed();
  const all = await stageTypeService.list({ includeArchived: true });
  logger.info(`Seeded ${added} stage types; ${all.length} total`);
  for (const t of all) {
    logger.info(
      `  ${String(t.sortOrder).padStart(3)}  ${t.key.padEnd(20)} ${t.name.padEnd(20)} ${t.color}${
        t.archived ? '  (archived)' : ''
      }`,
    );
  }
  await prisma.$disconnect();
}
main().catch(async (e) => {
  logger.error(String(e));
  await prisma.$disconnect();
  process.exit(1);
});
