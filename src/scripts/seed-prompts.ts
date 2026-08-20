import { promptService, PROMPT_KEYS } from '../services/prompt.service';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Report what the `prompts` table holds, and drop rows for retired keys.
 *
 *   npx tsx src/scripts/seed-prompts.ts
 *
 * THIS NO LONGER SEEDS TEXT. The prompt content lives in the database and got
 * there by migration; there is no constant in the codebase for this script to
 * insert, and re-inserting one would overwrite whatever a super admin has since
 * written. If a prompt is missing, run the migrations (`npm run prisma:deploy`)
 * or write it in Admin > Prompts.
 */
async function main() {
  const pruned = await promptService.pruneRetiredKeys();
  if (pruned) logger.info(`Pruned ${pruned} row(s) for keys the app no longer sends`);

  let missing = 0;
  for (const p of await promptService.list()) {
    if (p.present) {
      logger.info(`  ${p.key.padEnd(22)} ${String(p.content.length).padStart(5)} chars  ok`);
    } else {
      missing++;
      logger.error(`  ${p.key.padEnd(22)} MISSING — generation using this prompt will fail`);
    }
  }
  logger.info(`${Object.keys(PROMPT_KEYS).length} prompt(s) known to the app, ${missing} missing`);
  if (missing) process.exitCode = 1;
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
