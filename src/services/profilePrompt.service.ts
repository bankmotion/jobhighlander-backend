import { prisma } from '../lib/prisma';
import { providerOf, providerLabelOf, resolveProvider, type AiProvider } from '../lib/ai';
import { AiOutputError, structuredCall } from '../lib/generate';
import { logger } from './logger.service';
import { promptService } from './prompt.service';
import { aiUsageService } from './aiUsage.service';
import { billingService } from './billing.service';
import { ResumeInputError } from './resume.service';
import {
  promptCheckSchema,
  sanitizeCustomPrompt,
  CUSTOM_PROMPT_MAX,
  type PromptCheck,
  type PromptCheckFinding,
} from '../schemas/promptCheck.schema';

/**
 * A review as the admin screen reads it.
 *
 * `stale` is derived rather than stored: a check describes the text it was run
 * against, and the only way to know whether it still applies is to compare that
 * snapshot with what the profile holds now. A stored boolean would mean
 * remembering to clear it on every write that touches the prompt.
 */
export interface PromptCheckView {
  verdict: string;
  summary: string;
  findings: PromptCheckFinding[];
  model: string;
  provider: AiProvider | null;
  providerLabel: string;
  checkedBy: string | null;
  checkedAt: string;
  stale: boolean;
}

export interface ProfilePromptView {
  profileId: number;
  profileName: string;
  content: string;
  updatedAt: string | null;
  /** Null when it has never been reviewed, or the last review failed. */
  check: PromptCheckView | null;
}

const profileLabel = (p: {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string =>
  [p.firstName, p.lastName].filter(Boolean).join(' ') || p.email || `Profile #${p.id}`;

/**
 * Only profiles this user OWNS.
 *
 * Deliberately narrower than `usableProfileWhere`, which also admits accepted
 * invitations. An addendum shapes every document generated from a profile,
 * including ones its owner generates themselves — that is a property of the
 * profile, and an invited bidder who may not edit the profile's contents has no
 * business editing how it is written about either.
 */
const ownedWhere = (userId: number) => ({ ownerId: userId });

function shapeCheck(
  row: {
    content: string;
    verdict: string;
    summary: string;
    findings: unknown;
    model: string;
    createdAt: Date;
    checkedBy: { email: string } | null;
  } | null,
  current: string,
): PromptCheckView | null {
  if (!row) return null;
  return {
    verdict: row.verdict,
    summary: row.summary,
    findings: Array.isArray(row.findings) ? (row.findings as PromptCheckFinding[]) : [],
    model: row.model,
    provider: providerOf(row.model),
    providerLabel: providerLabelOf(row.model),
    checkedBy: row.checkedBy?.email ?? null,
    checkedAt: row.createdAt.toISOString(),
    // Compared on the SANITIZED text, which is what was actually reviewed —
    // otherwise a save that only stripped a fence line would show as stale
    // against a review that is still perfectly accurate.
    stale: sanitizeCustomPrompt(row.content) !== sanitizeCustomPrompt(current),
  };
}

const latestCheckArgs = {
  orderBy: { createdAt: 'desc' as const },
  take: 1,
  select: {
    content: true,
    verdict: true,
    summary: true,
    findings: true,
    model: true,
    createdAt: true,
    checkedBy: { select: { email: true } },
  },
};

export const profilePromptService = {
  /** Every profile this admin owns, each with its prompt and latest review. */
  async list(userId: number): Promise<ProfilePromptView[]> {
    const rows = await prisma.profile.findMany({
      where: ownedWhere(userId),
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        customPrompt: true,
        updatedAt: true,
        promptChecks: latestCheckArgs,
      },
    });

    return rows.map((p) => ({
      profileId: p.id,
      profileName: profileLabel(p),
      content: p.customPrompt ?? '',
      updatedAt: p.customPrompt ? p.updatedAt.toISOString() : null,
      check: shapeCheck(p.promptChecks[0] ?? null, p.customPrompt ?? ''),
    }));
  },

  /**
   * Save the prompt, then review it.
   *
   * In that order, and the review's failure is swallowed. An admin who has just
   * typed four thousand characters must not lose them because a vendor was down
   * or a balance was empty — the save is the part they asked for, and the review
   * is advice about it. Same instinct as `saveResume`, which reports rather than
   * throws for exactly this reason.
   */
  async save(
    profileId: number,
    contentRaw: string,
    userId: number,
    provider?: AiProvider,
  ): Promise<ProfilePromptView> {
    const content = sanitizeCustomPrompt(contentRaw);
    if (content.length > CUSTOM_PROMPT_MAX) {
      throw new ResumeInputError(
        `A custom prompt is at most ${CUSTOM_PROMPT_MAX.toLocaleString()} characters.`,
        400,
      );
    }

    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...ownedWhere(userId) },
      select: { id: true },
    });
    if (!profile) throw new ResumeInputError('Profile not found', 404);

    await prisma.profile.update({
      where: { id: profileId },
      data: { customPrompt: content || null },
    });
    logger.info('Profile custom prompt saved', { profileId, userId, chars: content.length });

    // Clearing it is not worth a call: there is nothing to review, and the
    // stale history stays readable as the record of what used to be there.
    if (content) {
      const reviewed = await this.check(profileId, userId, provider).catch((err: unknown) => {
        logger.warn('Custom prompt saved but not reviewed', { profileId, err: String(err) });
        return null;
      });
      if (reviewed) return reviewed;
    }

    const all = await this.list(userId);
    return all.find((p) => p.profileId === profileId)!;
  },

  /**
   * Review the profile's stored prompt against the live application prompt.
   *
   * Billable, and billed the ordinary way: the provider is resolved through
   * `resolveProvider`, the balance is checked before the spend, and the usage is
   * recorded against the acting user. `payerFor` resolves to that same person
   * here because this screen only ever lists profiles they own — it is used
   * anyway, so the rule about who pays stays in one place.
   */
  async check(
    profileId: number,
    userId: number,
    provider?: AiProvider,
  ): Promise<ProfilePromptView> {
    const chosen = resolveProvider(provider);

    const profile = await prisma.profile.findFirst({
      where: { id: profileId, ...ownedWhere(userId) },
      select: { id: true, customPrompt: true },
    });
    if (!profile) throw new ResumeInputError('Profile not found', 404);

    const content = sanitizeCustomPrompt(profile.customPrompt ?? '');
    if (!content) throw new ResumeInputError('There is no custom prompt to review.', 400);

    const payerId = await billingService.payerFor(profileId, userId);
    const { canSpend, balanceUsd } = await billingService.balanceOf(payerId);
    if (!canSpend) {
      const amount = `${balanceUsd < 0 ? '-' : ''}$${Math.abs(balanceUsd).toFixed(2)}`;
      throw new ResumeInputError(
        `Your balance is ${amount}. Top up with USDT to keep using the AI.`,
        402,
      );
    }

    // The application prompt itself, not a description of it. This is what makes
    // a verdict true rather than plausible: a super admin editing the main
    // prompt changes what this flags, with no second edit here.
    const [reviewer, application] = await Promise.all([
      promptService.text('prompt.check.system'),
      promptService.text('application.system'),
    ]);

    const call = await structuredCall({
      provider: chosen,
      system: [reviewer, `THE APPLICATION SYSTEM PROMPT, IN FULL:\n\n${application}`],
      user: `THE ADDENDUM TO REVIEW:\n\n"""\n${content}\n"""`,
      schema: promptCheckSchema,
      schemaName: 'prompt_check',
      maxTokens: 4_000,
      // Both blocks are identical on every check anyone runs, and together they
      // clear the 4096-token floor comfortably — this is the one prompt in the
      // app whose entire prefix is genuinely shared across users.
      cacheSystem: true,
    }).catch(asInputError);

    await aiUsageService.record({
      feature: 'prompt_check',
      model: call.model,
      userId,
      profileId,
      usage: call.usage,
    });

    const review: PromptCheck = call.output;
    await prisma.profilePromptCheck.create({
      data: {
        profileId,
        // The snapshot is what was SENT, so a later comparison against the
        // profile's text is comparing like with like.
        content,
        verdict: review.verdict,
        summary: review.summary,
        findings: review.findings as never,
        model: call.model,
        checkedById: userId,
      },
    });

    logger.info('Custom prompt reviewed', {
      profileId,
      userId,
      provider: chosen,
      model: call.model,
      usage: call.usage,
      verdict: review.verdict,
      findings: review.findings.length,
    });

    const all = await this.list(userId);
    return all.find((p) => p.profileId === profileId)!;
  },
};

/** Same split as generation: 422 tells the caller to change it, 502 to retry. */
function asInputError(err: unknown): never {
  if (err instanceof AiOutputError) {
    throw new ResumeInputError(err.message, err.kind === 'refused' ? 422 : 502);
  }
  throw err;
}
