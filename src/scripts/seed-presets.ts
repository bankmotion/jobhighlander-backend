import { presetService } from '../services/preset.service';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

async function main() {
  const n = await presetService.seed();
  const all = await presetService.list();
  logger.info(`Seeded ${n} presets; ${all.length} active`);
  for (const p of all) {
    logger.info(`  ${p.key.padEnd(18)} ${p.category}/${p.layout}  ${p.accent}  ${p.fontPair}  ${p.density}`);
  }
  await prisma.$disconnect();
}
main().catch(async (e) => {
  logger.error(String(e));
  await prisma.$disconnect();
  process.exit(1);
});
