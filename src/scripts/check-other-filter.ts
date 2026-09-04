import { jobService } from '../services/job.service';

jobService
  .list({ page: 1, pageSize: 1, sites: ['other'] })
  .then((r) => console.log('filter site=other ->', r.pagination.total, 'jobs, no error'))
  .catch((e) => console.log('FAILED:', String(e).slice(0, 200)))
  .finally(() => process.exit(0));
