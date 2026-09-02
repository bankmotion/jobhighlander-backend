/**
 * Put credit on an account from the command line.
 *
 *   npm run grant:credit -- --email someone@example.com --usd 25 --note "opening balance"
 *   npm run grant:credit -- --all --usd 25 --note "migration opening balance"
 *   npm run grant:credit -- --list
 *
 * Exists because the balance gate switches AI off for everyone the moment the
 * migration lands — every existing account starts at zero. This is the one
 * command that opens them back up without clicking through the admin screen.
 *
 * Goes through `billingService.adjust`, so a grant made here is a ledger entry
 * like any other and shows up on the user's statement.
 */
import { billingService, MICRO, toMicro } from '../services/billing.service';
import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';

const flag = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const usd = (micro: number): string => `$${(micro / MICRO).toFixed(2)}`;

async function main(): Promise<void> {
  if (has('list')) {
    const users = await prisma.user.findMany({
      select: { id: true, email: true, role: true, balanceMicroUsd: true },
      orderBy: { balanceMicroUsd: 'asc' },
    });
    for (const u of users) {
      logger.info(`  ${String(u.id).padStart(4)}  ${u.email.padEnd(34)} ${u.role.padEnd(12)} ${usd(u.balanceMicroUsd).padStart(10)}`);
    }
    logger.info(`${users.length} user(s); ${users.filter((u) => u.balanceMicroUsd <= 0).length} cannot currently use AI`);
    return;
  }

  const amount = Number(flag('usd'));
  if (!Number.isFinite(amount) || amount === 0) {
    logger.error('Pass --usd with a non-zero amount (negative is allowed, to take credit back)');
    process.exitCode = 1;
    return;
  }
  const note = flag('note') ?? 'Granted from the command line';

  // A super admin id is recorded as the grantor so the ledger names a person
  // rather than an anonymous process. The lowest-numbered one is the account
  // that bootstrapped the deployment.
  const actor = await prisma.user.findFirst({
    where: { role: 'super_admin' },
    orderBy: { id: 'asc' },
    select: { id: true, email: true },
  });
  if (!actor) {
    logger.error('No super admin exists to attribute this grant to');
    process.exitCode = 1;
    return;
  }

  const email = flag('email');
  const targets = has('all')
    ? await prisma.user.findMany({ select: { id: true, email: true } })
    : email
      ? await prisma.user.findMany({ where: { email }, select: { id: true, email: true } })
      : [];

  if (targets.length === 0) {
    logger.error(email ? `No user with email ${email}` : 'Pass --email <address> or --all');
    process.exitCode = 1;
    return;
  }

  if (!has('apply')) {
    logger.info(`DRY RUN — would grant ${usd(toMicro(amount))} to ${targets.length} user(s):`);
    for (const t of targets) logger.info(`  ${t.email}`);
    logger.info('Re-run with --apply to commit.');
    return;
  }

  for (const t of targets) {
    const after = await billingService.adjust({
      userId: t.id,
      amountMicroUsd: toMicro(amount),
      note,
      byId: actor.id,
    });
    logger.info(`  ${t.email.padEnd(34)} -> ${usd(after.balanceMicroUsd)}`);
  }
  logger.info(`Granted ${usd(toMicro(amount))} to ${targets.length} user(s), recorded against ${actor.email}`);
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
