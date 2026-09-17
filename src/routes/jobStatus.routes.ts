import { Router, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { applicationService } from '../services/application.service';
import { coverLetterService } from '../services/coverLetter.service';
import { discardService } from '../services/discard.service';
import { interviewService } from '../services/interview.service';
import { jobQueryService } from '../services/jobQuery.service';
import { rejectionService } from '../services/rejection.service';
import { resumeService } from '../services/resume.service';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const jobStatusRouter = Router();

const querySchema = z.object({
  profileId: z.coerce.number().int().positive(),
  jobIds: z
    .string()
    .trim()
    .min(1)
    .transform((s) => s.split(',').map((v) => Number(v.trim())))
    .pipe(z.array(z.number().int().positive()).min(1).max(100)),
});

/**
 * Every per-job status for one page of the list, in one request.
 *
 * The job list needs eight of these — resume, applied, cover letter, discard,
 * interview, rejection, AI-query counts, and two company histories — all keyed
 * on the SAME job ids and the same profile. Fetched separately that was eight
 * HTTP round trips carrying the same question, and the page waited for the
 * slowest of them.
 *
 * Collapsing them here is nearly free: the services already run in parallel,
 * and inside the backend a query costs ~1-5ms against a database on the same
 * network. What is expensive is the request, and this spends one instead of
 * eight.
 *
 * Deliberately NOT folded into `GET /api/jobs` itself. The list is cached and
 * paged as a public-ish resource; these are per-profile facts about the reader,
 * and merging them would mean neither could be cached independently of the
 * other.
 */
jobStatusRouter.get('/', requireAuth, async (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { profileId, jobIds } = parsed.data;
    const userId = req.user!.id;

    // Each service does its own ownership check against `userId`, so a profile
    // the caller may not use yields empty maps rather than someone else's data.
    const [
      resume,
      applied,
      coverLetter,
      discard,
      interview,
      rejection,
      queryCounts,
      companyHistory,
      discardCompanyHistory,
    ] = await Promise.all([
      resumeService.statusFor(jobIds, profileId, userId),
      applicationService.statusFor(jobIds, profileId, userId),
      coverLetterService.statusFor(jobIds, profileId, userId),
      discardService.statusFor(jobIds, profileId, userId),
      interviewService.statusFor(jobIds, profileId, userId),
      rejectionService.statusFor(jobIds, profileId, userId),
      jobQueryService.countsFor(jobIds, profileId, userId),
      applicationService.companyHistoryFor(jobIds, profileId, userId),
      discardService.companyHistoryFor(jobIds, profileId, userId),
    ]);

    res.json({
      resume,
      applied,
      coverLetter,
      discard,
      interview,
      rejection,
      queryCounts,
      companyHistory,
      discardCompanyHistory,
    });
  } catch (err) {
    next(err);
  }
});
