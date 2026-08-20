import { promptService, PROMPT_DEFAULTS } from '../services/prompt.service';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

/**
 * Write the shipped prompts into the database.
 *
 *   npx tsx src/scripts/seed-prompts.ts            insert any missing rows
 *   npx tsx src/scripts/seed-prompts.ts --force    reset every row to shipped
 *
 * Idempotent. Without `--force` an existing row is left alone: a super admin's
 * wording outranks the shipped text, and a deploy that silently reverted their
 * edit would be worse than a prompt that is slightly out of date.
 */
async function main() {
  const force = process.argv.includes('--force');
  const { created, reset } = await promptService.seed(force);
  logger.info(`Prompts seeded — ${created} created, ${reset} reset${force ? '' : ' (use --force to reset)'}`);

  for (const p of await promptService.list()) {
    const state = p.customised ? 'customised' : 'shipped default';
    logger.info(`  ${p.key.padEnd(22)} ${String(p.content.length).padStart(5)} chars  ${state}`);
  }
  logger.info(`${Object.keys(PROMPT_DEFAULTS).length} prompt(s) known to the app`);
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
