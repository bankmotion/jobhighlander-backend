/**
 * One-time: raise every historical `ai_usage` row to the new cost markup.
 *
 * Rows recorded before the markup existed were priced at the vendor's list
 * price and carry `multiplier_bp = 10000`. This lifts them to the markup this
 * deployment now charges — 1.2x for Claude, 2x for OpenAI by default.
 *
 *   npm run backfill:ai-markup              # dry run, changes nothing
 *   npm run backfill:ai-markup -- --apply   # commit
 *   npm run backfill:ai-markup -- --apply --claude 1.2 --openai 2
 *
 * DRY RUN IS THE DEFAULT AND THAT IS DELIBERATE. This rewrites money records
 * in place with no undo, so the numbers are printed for review first and only
 * move when someone asks for it in a second command.
 *
 * Safe to re-run: it refuses a provider that already carries a `backfilledAt`
 * stamp, and it only touches rows still sitting at list price and created
 * before this run started. Both guards have to fail before anything could be
 * marked up twice.
 */
import { AI_PROVIDERS, PROVIDER_LABEL, providerOf, type AiProvider } from '../lib/ai';
import { LIST_PRICE_BP } from '../lib/pricing';
import { prisma } from '../lib/prisma';
import { isValidMultiplier, MAX_MULTIPLIER, MIN_MULTIPLIER } from '../services/aiRate.service';
import { logger } from '../services/logger.service';

/** Defaults are the markups this change was asked for. */
const DEFAULTS: Record<AiProvider, number> = { claude: 1.2, openai: 2 };

/**
 * Which stored `model` strings belong to a provider, as a SQL prefix.
 *
 * Matched in SQL rather than by reading every row into Node: the table is the
 * one that grows without bound, and the update has to be a single statement to
 * be atomic. Kept beside `providerOf` in lib/ai.ts — if a provider's model
 * naming ever stops matching this, the two must move together.
 */
const MODEL_PREFIX: Record<AiProvider, string> = { claude: 'claude%', openai: 'gpt%' };

const usd = (micro: bigint | number): string => `$${(Number(micro) / 1_000_000).toFixed(4)}`;

function readFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Does the SQL prefix pick up every model the app would call this provider's? */
const prefixMatches = (provider: AiProvider, model: string): boolean =>
  model.toLowerCase().startsWith(MODEL_PREFIX[provider].replace('%', ''));

/**
 * Compare the two ways of deciding who owns a model, over the models really in
 * the table. Reports rather than assumes, and answers false if anything would
 * be skipped or claimed by the wrong provider.
 */
async function reconcileModelMatching(): Promise<boolean> {
  const models = (await prisma.aiUsage.groupBy({ by: ['model'], _count: { _all: true } })).map(
    (r) => ({ model: r.model, count: r._count._all }),
  );

  let ok = true;
  for (const { model, count } of models) {
    const provider = providerOf(model);
    if (!provider) {
      // Not a row this markup applies to. Worth saying out loud — it stays at
      // list price and its cost will not match the rate card.
      logger.warn(`  ${model.padEnd(22)} ${String(count).padStart(6)} row(s)  no known provider — left at list price`);
      continue;
    }
    if (!prefixMatches(provider, model)) {
      logger.error(
        `  ${model.padEnd(22)} ${String(count).padStart(6)} row(s)  is ${provider} but "${MODEL_PREFIX[provider]}" would miss it`,
      );
      ok = false;
      continue;
    }
    // Nothing else may claim it, or two passes would mark the same row up twice.
    for (const other of AI_PROVIDERS) {
      if (other !== provider && prefixMatches(other, model)) {
        logger.error(`  ${model}: matched by both ${provider} and ${other} patterns`);
        ok = false;
      }
    }
    logger.info(`  ${model.padEnd(22)} ${String(count).padStart(6)} row(s)  -> ${provider}`);
  }
  return ok;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const targets = {} as Record<AiProvider, number>;
  for (const p of AI_PROVIDERS) {
    const raw = readFlag(p);
    const value = raw === undefined ? DEFAULTS[p] : Number(raw);
    if (!isValidMultiplier(value)) {
      logger.error(`--${p} must be a number between ${MIN_MULTIPLIER} and ${MAX_MULTIPLIER}`);
      process.exitCode = 1;
      return;
    }
    targets[p] = value;
  }

  // Everything created from here on is priced by the app at the new markup, so
  // the update must not reach forward past this instant and double-charge a
  // call that lands while the script runs.
  const startedAt = new Date();

  logger.info(apply ? 'APPLYING markup to historical AI usage' : 'DRY RUN — nothing will change');

  // The app classifies a model with `providerOf` (a regex); this script selects
  // with a SQL prefix. Those are two descriptions of one rule, and a row the
  // regex claims but the prefix misses would keep list pricing forever while
  // every report insisted it had been marked up. Check them against the models
  // actually present before moving any money.
  if (!(await reconcileModelMatching())) {
    logger.error('Refusing to run: some recorded models would not be matched. Fix MODEL_PREFIX first.');
    process.exitCode = 1;
    return;
  }

  for (const provider of AI_PROVIDERS) {
    const multiplier = targets[provider];
    const bp = Math.round(multiplier * LIST_PRICE_BP);
    const label = PROVIDER_LABEL[provider];

    const existing = await prisma.aiProviderRate.findUnique({ where: { provider } });
    if (existing?.backfilledAt) {
      logger.warn(
        `${label}: already backfilled at ${existing.backfilledAt.toISOString()} — skipping. ` +
          'Historical rows keep the markup they were given; delete backfilled_at to force a re-run.',
      );
      continue;
    }

    // Exactly the rows the UPDATE below will touch, so the preview cannot
    // disagree with what gets written.
    const where = {
      model: { startsWith: provider === 'claude' ? 'claude' : 'gpt' },
      multiplierBp: LIST_PRICE_BP,
      createdAt: { lt: startedAt },
    } as const;

    const [count, sum] = await Promise.all([
      prisma.aiUsage.count({ where }),
      prisma.aiUsage.aggregate({ where, _sum: { costMicroUsd: true } }),
    ]);
    const before = sum._sum.costMicroUsd ?? 0;
    const after = Math.round((before * bp) / LIST_PRICE_BP);

    logger.info(
      `${label.padEnd(7)} x${multiplier}  ${String(count).padStart(6)} row(s)  ` +
        `${usd(before)} -> ${usd(after)}  (+${usd(after - before)})`,
    );

    if (!apply) continue;

    // Raw SQL because the new value is derived from the column itself, which
    // Prisma's typed update cannot express. Rounded in SQL to match
    // `priceUsage`, so a backfilled row and a freshly recorded one agree.
    const updated = await prisma.$executeRaw`
      UPDATE ai_usage
         SET cost_micro_usd = ROUND(cost_micro_usd * ${bp} / ${LIST_PRICE_BP}),
             multiplier_bp  = ${bp}
       WHERE model LIKE ${MODEL_PREFIX[provider]}
         AND multiplier_bp = ${LIST_PRICE_BP}
         AND created_at < ${startedAt}`;

    // Written in the same breath as the rows it describes: the stamp is what
    // stops a second run, so it must not be possible to update rows and then
    // fail to record that they were updated.
    await prisma.aiProviderRate.upsert({
      where: { provider },
      create: { provider, multiplierBp: bp, backfilledAt: startedAt, updatedByEmail: 'backfill script' },
      update: { multiplierBp: bp, backfilledAt: startedAt, updatedByEmail: 'backfill script' },
    });

    logger.info(`${label}: ${updated} row(s) updated, markup set to x${multiplier} for future calls`);
  }

  if (!apply) {
    logger.info('Re-run with --apply to commit these changes.');
  }
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
