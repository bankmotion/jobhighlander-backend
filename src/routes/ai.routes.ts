import { Router, type Response } from 'express';
import { providerCatalog } from '../lib/ai';
import { rateCard } from '../lib/pricing';
import { requireAuth, type AuthedRequest } from '../middleware/auth.middleware';

export const aiRouter = Router();

/**
 * What the generation picker is allowed to offer.
 *
 * The UI must not present a provider whose key is missing — a user picking it
 * would get a 503 after a modal they had no reason to distrust. So the server
 * states which providers are usable and which one is the default, rather than
 * the client guessing from environment it cannot see.
 *
 * The rate for each provider's model is joined on here rather than in
 * `providerCatalog`, which cannot import pricing without a cycle. Prices ride
 * along so the picker can say what a choice costs at the moment it is made.
 *
 * Authenticated: it names the models this deployment runs and the vendors it
 * pays, neither of which belongs on a public endpoint. It never returns keys.
 */
aiRouter.get('/providers', requireAuth, (_req: AuthedRequest, res: Response) => {
  const rates = new Map(rateCard().map((r) => [r.model, r]));
  res.json({
    providers: providerCatalog().map((p) => {
      const rate = rates.get(p.model);
      return {
        ...p,
        inputPerMTok: rate?.inputPerMTok ?? null,
        outputPerMTok: rate?.outputPerMTok ?? null,
      };
    }),
  });
});
