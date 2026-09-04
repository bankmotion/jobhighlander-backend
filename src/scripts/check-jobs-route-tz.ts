import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

const BASE = process.env.CHECK_BASE ?? 'http://localhost:4000';

async function main() {
  const u = await prisma.user.findFirst({ select: { id: true, email: true, role: true } });
  if (!u) throw new Error('no user');
  const token = authService.signToken({ sub: u.id, email: u.email, role: u.role });

  const call = async (qs: string) => {
    const res = await fetch(`${BASE}/api/jobs?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await res.json()) as { pagination?: { total?: number } };
    return j.pagination?.total ?? -1;
  };

  console.log('GET /api/jobs?posted=today&remote=1&tz=...');
  for (const tz of ['America/Los_Angeles', 'UTC', 'Asia/Dubai']) {
    console.log(`  tz=${tz.padEnd(22)} -> ${await call(`posted=today&remote=1&tz=${encodeURIComponent(tz)}`)}`);
  }
  console.log(`  tz omitted entirely  -> ${await call('posted=today&remote=1')}`);
  console.log(`  tz=PDT (invalid)     -> ${await call('posted=today&remote=1&tz=PDT')}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
