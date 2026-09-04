/**
 * End-to-end check that `tz` survives the HTTP layer.
 *
 * Hits the running dev server as a real super admin, so it exercises the zod
 * schema, `resolveWindow`, the service and the aggregation together — the parts
 * a unit check of the zone helpers cannot cover.
 */
import { prisma } from '../lib/prisma';
import { authService } from '../services/auth.service';

const BASE = process.env.CHECK_BASE ?? 'http://localhost:4000';

const ZONES = ['UTC', 'Europe/Warsaw', 'Asia/Dubai', 'America/New_York', 'Pacific/Kiritimati'];

async function main() {
  const admin = await prisma.user.findFirst({
    where: { role: 'super_admin' },
    select: { id: true, email: true, role: true },
  });
  if (!admin) throw new Error('no super_admin to authenticate as');

  const token = authService.signToken({ sub: admin.id, email: admin.email, role: admin.role });
  const headers = { Authorization: `Bearer ${token}` };

  const call = async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { headers });
    if (!res.ok) return { status: res.status, body: await res.text() };
    return { status: res.status, json: await res.json() };
  };

  console.log(`as ${admin.email} @ ${BASE}\n`);

  const probe = await call('/api/ai-usage/all?preset=today&tz=UTC');
  console.log('response keys:', 'json' in probe ? Object.keys(probe.json as object).join(', ') : 'HTTP ' + probe.status);
  console.log();

  console.log('--- GET /api/ai-usage/all?preset=today&tz=… ---');
  for (const tz of ZONES) {
    const r = await call(`/api/ai-usage/all?preset=today&tz=${encodeURIComponent(tz)}`);
    if (!('json' in r)) {
      console.log(`  ${tz.padEnd(20)} HTTP ${r.status} ${r.body?.slice(0, 80)}`);
      continue;
    }
    const j = r.json as { totals: { calls: number }; from: string; rangeLabel: string; daily: unknown[] };
    console.log(
      `  ${tz.padEnd(20)} calls=${String(j.totals.calls).padStart(4)}  buckets=${String(j.daily.length).padStart(2)}  from=${j.from}`,
    );
  }

  console.log('\n--- GET /api/stats/bid-performance?preset=today&tz=… ---');
  for (const tz of ZONES) {
    const r = await call(`/api/stats/bid-performance?preset=today&tz=${encodeURIComponent(tz)}`);
    if (!('json' in r)) {
      console.log(`  ${tz.padEnd(20)} HTTP ${r.status} ${r.body?.slice(0, 80)}`);
      continue;
    }
    const j = r.json as { range: { from: string; to: string }; daily: { date: string }[] };
    console.log(
      `  ${tz.padEnd(20)} from=${j.range.from}  days=${j.daily.length}  dates=${j.daily.map((d) => d.date.slice(5)).join(',')}`,
    );
  }

  console.log('\n--- custom range 2026-09-01..2026-09-02 bounds move with tz ---');
  for (const tz of ZONES) {
    const r = await call(`/api/stats/bid-performance?from=2026-09-01&to=2026-09-02&tz=${encodeURIComponent(tz)}`);
    if (!('json' in r)) {
      console.log(`  ${tz.padEnd(20)} HTTP ${r.status}`);
      continue;
    }
    const j = r.json as { range: { from: string; to: string } };
    console.log(`  ${tz.padEnd(20)} ${j.range.from} -> ${j.range.to}`);
  }

  console.log('\n--- a rejected zone must not 500 ---');
  const bad = await call('/api/stats/bid-performance?preset=today&tz=Mars%2FOlympus');
  console.log(`  HTTP ${bad.status} (expect 200, falling back to UTC)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
