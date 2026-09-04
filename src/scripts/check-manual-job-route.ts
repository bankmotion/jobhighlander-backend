/**
 * The HTTP layer for adding a job: zod validation, the 201, and the 409.
 *
 * Separate from the service check because the failures differ — this is where a
 * schema that rejects a legitimate body, or a duplicate that surfaces as a 500
 * instead of a 409, would show up.
 */
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

const BASE = process.env.CHECK_BASE ?? 'http://localhost:4000';
const MARKER = 'ZZ-ROUTECHECK-DELETE-ME';

const BODY = {
  title: `${MARKER} Principal SRE`,
  company: 'Routecheck GmbH',
  location: 'Munich',
  remote: false,
  jobUrl: 'https://example.invalid/jobs/routecheck',
  description:
    'Created by check-manual-job-route.ts to verify the POST /api/jobs endpoint. ' +
    'Removed before the script exits.',
};

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true, email: true, role: true } });
  if (!user) throw new Error('no user to authenticate as');
  const token = authService.signToken({ sub: user.id, email: user.email, role: user.role });

  const post = async (body: unknown) => {
    const res = await fetch(`${BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  };

  const check = (label: string, ok: boolean, extra = '') =>
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? `  — ${extra}` : ''}`);

  console.log(`as ${user.email} @ ${BASE}\n`);

  try {
    const created = await post(BODY);
    check('valid body returns 201', created.status === 201, `got ${created.status}`);
    const id = created.json.id as number | undefined;
    check('response carries the new id', typeof id === 'number');
    check('stored as site=other', created.json.site === 'other');

    const dupe = await post(BODY);
    check('same posting returns 409', dupe.status === 409, `got ${dupe.status}`);
    check('409 names the existing job', dupe.json.jobId === id, String(dupe.json.jobId));

    // Rejections. Each should be a 400 the form can act on, never a 500.
    const short = await post({ ...BODY, title: 'x', description: BODY.description });
    check('title too short is 400', short.status === 400, `got ${short.status}`);

    const thin = await post({ ...BODY, title: `${MARKER} Other`, description: 'too short' });
    check('description too short is 400', thin.status === 400, `got ${thin.status}`);

    const badUrl = await post({ ...BODY, title: `${MARKER} Other`, jobUrl: 'not-a-url' });
    check('malformed URL is 400', badUrl.status === 400, `got ${badUrl.status}`);

    // The optional fields really are optional.
    const minimal = await post({
      title: `${MARKER} Minimal Role`,
      description: 'Only the two required fields are present in this body, nothing else at all.',
    });
    check('title + description alone is accepted', minimal.status === 201, `got ${minimal.status}`);

    const noAuth = await fetch(`${BASE}/api/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(BODY),
    });
    check('unauthenticated is rejected', noAuth.status === 401, `got ${noAuth.status}`);
  } finally {
    const gone = await prisma.job.deleteMany({ where: { title: { startsWith: MARKER } } });
    console.log(`\ncleaned up ${gone.count} test row(s)`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
