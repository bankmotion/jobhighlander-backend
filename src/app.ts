import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { jobRouter } from './routes/job.routes';
import { authRouter } from './routes/auth.routes';
import { keywordRouter } from './routes/keyword.routes';
import { profileRouter } from './routes/profile.routes';
import { invitationRouter } from './routes/invitation.routes';
import { applicationRouter } from './routes/application.routes';
import { discardRouter } from './routes/discard.routes';
import { interviewRouter } from './routes/interview.routes';
import { stageTypeRouter } from './routes/stageType.routes';
import { scrapeRunRouter } from './routes/scrapeRun.routes';
import { scraperSettingRouter } from './routes/scraperSetting.routes';
import { resumeRouter } from './routes/resume.routes';
import { coverLetterRouter } from './routes/coverLetter.routes';
import { promptRouter } from './routes/prompt.routes';
import { aiUsageRouter } from './routes/aiUsage.routes';
import { requireAuth } from './middleware/auth.middleware';
import { notFound, errorHandler } from './middleware/error.middleware';

/** Build the Express application (no listening — kept testable/importable). */
export function createApp(): Application {
  const app = express();

  app.use(cors({ origin: env.CORS_ORIGIN }));
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'jobhighlander-backend' });
  });

  app.use('/api/auth', authRouter);
  // Job data requires a valid session (the Next.js server forwards the JWT).
  app.use('/api/jobs', requireAuth, jobRouter);
  app.use('/api/keywords', keywordRouter);
  app.use('/api/profiles', profileRouter);
  app.use('/api/invitations', invitationRouter);
  app.use('/api/applications', applicationRouter);
  app.use('/api/discards', discardRouter);
  app.use('/api/interviews', interviewRouter);
  app.use('/api/stage-types', stageTypeRouter);
  app.use('/api/scrape-runs', scrapeRunRouter);
  app.use('/api/scraper-settings', scraperSettingRouter);
  app.use('/api/resumes', resumeRouter);
  app.use('/api/cover-letters', coverLetterRouter);
  app.use('/api/prompts', promptRouter);
  app.use('/api/ai-usage', aiUsageRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
