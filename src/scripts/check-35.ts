import { jobService } from '../services/job.service';

/** Does UTC-today plus the default remote-only filter come to the number on screen? */
async function main() {
  for (const tz of ['America/Los_Angeles', 'UTC']) {
    for (const remote of [true, false]) {
      const r = await jobService.list({ page: 1, pageSize: 1, posted: 'today', tz, remote });
      console.log(`  tz=${tz.padEnd(20)} remote=${String(remote).padEnd(5)} -> ${r.pagination.total}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
