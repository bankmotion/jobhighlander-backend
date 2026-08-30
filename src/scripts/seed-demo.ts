import { prisma } from '../lib/prisma';
import { logger } from '../services/logger.service';
import type { Role } from '../services/auth.service';

const DEMO_DOMAIN = '@demo.local';

interface WorkSeed {
  company: string;
  location: string;
  startDate: string;
  endDate: string | null;
}
interface EduSeed {
  university: string;
  location: string;
  degree: string;
  startDate: string;
  endDate: string | null;
}
interface InviteSeed {
  role: Role;
  status: 'pending' | 'accepted' | 'declined';
}
interface ProfileSeed {
  ownerRole: Role;
  firstName: string;
  lastName: string;
  phone: string;
  location: string;
  work: WorkSeed[];
  education: EduSeed[];
  invites: InviteSeed[];
}

const d = (s: string) => new Date(`${s}-01T00:00:00Z`);

const SEED: ProfileSeed[] = [
  {
    ownerRole: 'admin',
    firstName: 'Aisha',
    lastName: 'Rahman',
    phone: '+1 512 555 0142',
    location: 'Austin, Texas',
    work: [
      { company: 'Stripe', location: 'Remote', startDate: '2022-04', endDate: null },
      { company: 'Shopify', location: 'Ottawa, Canada', startDate: '2019-08', endDate: '2022-03' },
    ],
    education: [
      {
        university: 'University of Texas at Austin',
        location: 'Austin, Texas',
        degree: 'B.S. in Computer Science',
        startDate: '2015-09',
        endDate: '2019-05',
      },
    ],
    // Shared with the bidder, and still waiting on the super admin: one profile
    // showing two different states at once is what the Bidders page has to sort.
    invites: [
      { role: 'bidder', status: 'accepted' },
      { role: 'super_admin', status: 'pending' },
    ],
  },
  {
    ownerRole: 'admin',
    firstName: 'Marcus',
    lastName: 'Lee',
    phone: '+1 415 555 0198',
    location: 'San Francisco, California',
    work: [
      { company: 'Datadog', location: 'New York, NY', startDate: '2021-01', endDate: null },
      { company: 'Twilio', location: 'San Francisco, CA', startDate: '2018-06', endDate: '2020-12' },
    ],
    education: [
      {
        university: 'Stanford University',
        location: 'Stanford, California',
        degree: 'M.S. in Software Engineering',
        startDate: '2016-09',
        endDate: '2018-05',
      },
    ],
    invites: [{ role: 'bidder', status: 'pending' }],
  },
  {
    ownerRole: 'admin',
    firstName: 'Elena',
    lastName: 'Petrova',
    phone: '+44 20 7946 0311',
    location: 'London, United Kingdom',
    work: [{ company: 'Monzo', location: 'London, UK', startDate: '2020-02', endDate: null }],
    education: [
      {
        university: 'Imperial College London',
        location: 'London, UK',
        degree: 'B.Eng. in Computing',
        startDate: '2016-09',
        endDate: '2019-06',
      },
    ],
    invites: [{ role: 'bidder', status: 'declined' }],
  },
  {
    ownerRole: 'admin',
    firstName: 'Tom',
    lastName: 'Becker',
    phone: '+49 30 5555 0177',
    location: 'Berlin, Germany',
    work: [{ company: 'SoundCloud', location: 'Berlin, Germany', startDate: '2019-05', endDate: null }],
    education: [
      {
        university: 'TU Berlin',
        location: 'Berlin, Germany',
        degree: 'B.Sc. in Informatics',
        startDate: '2015-10',
        endDate: '2019-03',
      },
    ],
    // Deliberately unshared: the Bidders page needs an empty card too.
    invites: [],
  },
  {
    ownerRole: 'super_admin',
    firstName: 'Priya',
    lastName: 'Nair',
    phone: '+91 80 5555 0164',
    location: 'Bengaluru, India',
    work: [
      { company: 'Razorpay', location: 'Bengaluru, India', startDate: '2021-07', endDate: null },
      { company: 'Infosys', location: 'Pune, India', startDate: '2018-01', endDate: '2021-06' },
    ],
    education: [
      {
        university: 'IIT Bombay',
        location: 'Mumbai, India',
        degree: 'B.Tech. in Computer Science',
        startDate: '2014-07',
        endDate: '2018-05',
      },
    ],
    invites: [{ role: 'admin', status: 'accepted' }],
  },
  {
    ownerRole: 'super_admin',
    firstName: 'Daniel',
    lastName: 'Osei',
    phone: '+233 30 555 0129',
    location: 'Accra, Ghana',
    work: [{ company: 'Flutterwave', location: 'Remote', startDate: '2022-09', endDate: null }],
    education: [
      {
        university: 'University of Ghana',
        location: 'Accra, Ghana',
        degree: 'B.Sc. in Computer Engineering',
        startDate: '2017-08',
        endDate: '2021-06',
      },
    ],
    invites: [
      { role: 'admin', status: 'pending' },
      { role: 'bidder', status: 'accepted' },
    ],
  },
];

const emailFor = (p: ProfileSeed) =>
  `${p.firstName}.${p.lastName}`.toLowerCase() + DEMO_DOMAIN;

async function clear(): Promise<number> {
  const { count } = await prisma.profile.deleteMany({
    where: { email: { endsWith: DEMO_DOMAIN } },
  });
  return count;
}

async function main() {
  const clearOnly = process.argv.includes('--clear');

  const removed = await clear();
  if (removed) logger.info(`Removed ${removed} existing demo profile(s)`);
  if (clearOnly) {
    logger.info('Cleared. Nothing seeded.');
    return;
  }

  // One user per role. Roles with nobody in them are skipped rather than
  // invented: creating accounts would mean inventing passwords, and a seeded
  // login nobody can use is worse than a smaller fixture.
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true } });
  const byRole = new Map<string, { id: number; email: string }>();
  for (const u of users) if (!byRole.has(u.role)) byRole.set(u.role, u);

  for (const role of ['admin', 'super_admin', 'bidder'] as const) {
    const u = byRole.get(role);
    logger.info(u ? `${role.padEnd(12)} → ${u.email}` : `${role.padEnd(12)} → (none; skipped)`);
  }

  let profiles = 0;
  let invitations = 0;
  const skipped: string[] = [];

  for (const seed of SEED) {
    const owner = byRole.get(seed.ownerRole);
    if (!owner) {
      skipped.push(`${seed.firstName} ${seed.lastName} (no ${seed.ownerRole})`);
      continue;
    }

    const profile = await prisma.profile.create({
      data: {
        ownerId: owner.id,
        email: emailFor(seed),
        firstName: seed.firstName,
        lastName: seed.lastName,
        phone: seed.phone,
        location: seed.location,
        linkedin: `https://linkedin.com/in/${seed.firstName.toLowerCase()}-${seed.lastName.toLowerCase()}`,
        workExperiences: {
          create: seed.work.map((w, i) => ({
            company: w.company,
            location: w.location,
            startDate: d(w.startDate),
            endDate: w.endDate ? d(w.endDate) : null,
            sortOrder: i,
          })),
        },
        educations: {
          create: seed.education.map((e, i) => ({
            university: e.university,
            location: e.location,
            degree: e.degree,
            startDate: d(e.startDate),
            endDate: e.endDate ? d(e.endDate) : null,
            sortOrder: i,
          })),
        },
      },
    });
    profiles++;

    for (const inv of seed.invites) {
      const invitee = byRole.get(inv.role);
      // An owner cannot be invited to their own profile — the API rejects it,
      // and seeding a row the app would refuse to create is a fixture that
      // tests nothing real.
      if (!invitee || invitee.id === owner.id) {
        skipped.push(`invite ${seed.firstName} → ${inv.role} (${invitee ? 'is the owner' : 'no such role'})`);
        continue;
      }
      await prisma.profileInvitation.create({
        data: {
          profileId: profile.id,
          userId: invitee.id,
          invitedById: owner.id,
          status: inv.status,
          respondedAt: inv.status === 'pending' ? null : new Date(),
        },
      });
      invitations++;
    }
  }

  logger.info(`Seeded ${profiles} profile(s) and ${invitations} invitation(s)`);
  for (const s of skipped) logger.warn(`  skipped: ${s}`);

  // What each account will actually see, so the result can be checked against
  // the UI without opening Prisma Studio.
  for (const [role, u] of byRole) {
    if (role === 'guest') continue;
    const [owned, accepted, pending] = await Promise.all([
      prisma.profile.count({ where: { ownerId: u.id } }),
      prisma.profileInvitation.count({ where: { userId: u.id, status: 'accepted' } }),
      prisma.profileInvitation.count({ where: { userId: u.id, status: 'pending' } }),
    ]);
    logger.info(
      `  ${u.email.padEnd(32)} ${owned} owned + ${accepted} shared = ${owned + accepted} in Jobs; ${pending} pending in inbox`,
    );
  }
}

main()
  .catch((e) => {
    logger.error(String(e));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
