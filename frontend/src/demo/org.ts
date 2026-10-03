/**
 * Barq Digital — the hard-coded demo company.
 *
 * Fictional: every person, client and figure here is invented. The story threads
 * the demo leans on (keep them consistent if you edit):
 *   1. Kestrel Health app v2 is slipping — launch moved Oct 13 → Oct 20, blocked on
 *      payment-SDK certification; a revised-timeline email waits for approval.
 *   2. Indus Freight renewal is at risk — invoice INV-2291 is 45 days overdue and
 *      the client wants 10% off; leadership leans to 5%.
 *   3. Lumen Pay is a hot prospect — security questionnaire due Oct 8.
 *   4. Platform is migrating production to AWS Bahrain by Nov 15.
 *   5. Hiring: three backend roles just opened.
 */
import type { BrainItem, Department, Org, Person, Role, Team } from './types';

const DOMAIN = 'barqdigitalai.com';

function initialsOf(name: string): string {
  const words = name.split(' ');
  // A one-word name ("Saim") still gets two letters, so every avatar reads the same weight.
  if (words.length === 1) return name.slice(0, 2).toUpperCase();
  return words
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/(^-|-$)/g, '');
}

function person(name: string, title: string, role: Role, extra: Partial<Person> = {}): Person {
  const id = slug(name);
  return {
    id,
    name,
    title,
    role,
    initials: initialsOf(name),
    email: `${id.split('-')[0]}@${DOMAIN}`,
    ...extra,
  };
}

/* ── Roster ─────────────────────────────────────────────────────────────── */

interface TeamSpec {
  id: string;
  name: string;
  members: [name: string, title: string][]; // first entry is the lead
}

interface DepartmentSpec {
  id: string;
  name: string;
  hue: number;
  description: string;
  head: [name: string, title: string];
  teams: TeamSpec[];
}

const DEPARTMENT_SPECS: DepartmentSpec[] = [
  {
    id: 'engineering',
    name: 'Engineering',
    hue: 205,
    description: 'Platform, mobile and web delivery for every client build.',
    head: ['Saim', 'VP Engineering'],
    teams: [
      {
        id: 'platform',
        name: 'Platform',
        members: [
          ['Usman Tariq', 'Platform Lead'],
          ['Hira Javed', 'Senior Backend Engineer'],
          ['Ali Haider', 'DevOps Engineer'],
          ['Mehwish Iqbal', 'Backend Engineer'],
          ['Daniyal Shah', 'Backend Engineer'],
        ],
      },
      {
        id: 'mobile',
        name: 'Mobile',
        members: [
          ['Zain Abbas', 'Mobile Lead'],
          ['Alyan Ali', 'iOS Engineer'],
          ['Hassan Raza', 'Android Engineer'],
          ['Noor Fatima', 'Flutter Engineer'],
          ['Saad Mirza', 'Mobile Engineer'],
        ],
      },
      {
        id: 'web',
        name: 'Web',
        members: [
          ['Kamran Yousuf', 'Web Lead'],
          ['Maryam Aslam', 'Frontend Engineer'],
          ['Faizan Ali', 'Full-stack Engineer'],
          ['Iqra Nadeem', 'Frontend Engineer'],
          ['Taha Siddiqui', 'Full-stack Engineer'],
        ],
      },
    ],
  },
  {
    id: 'product',
    name: 'Product & Design',
    hue: 262,
    description: 'Discovery, product management and the Arc design system.',
    head: ['Bilal Ahmed', 'Head of Product'],
    teams: [
      {
        id: 'product-mgmt',
        name: 'Product',
        members: [
          ['Rabia Anwar', 'Product Lead'],
          ['Shoaib Akhtar', 'Product Manager'],
          ['Laiba Hussain', 'Product Analyst'],
          ['Ahmed Nawaz', 'Product Manager'],
        ],
      },
      {
        id: 'design',
        name: 'Design',
        members: [
          ['Zoya Rehman', 'Design Lead'],
          ['Fahad Mustafa', 'Product Designer'],
          ['Anam Sheikh', 'UX Researcher'],
          ['Waqas Butt', 'Brand Designer'],
        ],
      },
    ],
  },
  {
    id: 'delivery',
    name: 'Client Delivery',
    hue: 158,
    description: 'Account management, project delivery and quality.',
    head: ['Sana Malik', 'Head of Delivery'],
    teams: [
      {
        id: 'client-success',
        name: 'Client Success',
        members: [
          ['Nida Pervaiz', 'Client Success Lead'],
          ['Asad Mahmood', 'Account Manager'],
          ['Komal Rizvi', 'Project Manager'],
          ['Junaid Akram', 'Project Manager'],
          ['Sara Imtiaz', 'Delivery Coordinator'],
        ],
      },
      {
        id: 'qa',
        name: 'Quality',
        members: [
          ['Imran Ghani', 'QA Lead'],
          ['Sadia Batool', 'QA Engineer'],
          ['Rizwan Khalid', 'Automation Engineer'],
          ['Hamna Yasir', 'QA Engineer'],
        ],
      },
    ],
  },
  {
    id: 'growth',
    name: 'Sales & Growth',
    hue: 32,
    description: 'New business, renewals and the Barq Digital brand.',
    head: ['Omar Farooq', 'Head of Growth'],
    teams: [
      {
        id: 'sales',
        name: 'Sales',
        members: [
          ['Adeel Chaudhry', 'Sales Lead'],
          ['Mahnoor Saleem', 'Account Executive'],
          ['Shahzaib Qadir', 'Business Development'],
          ['Erum Latif', 'Sales Engineer'],
        ],
      },
      {
        id: 'marketing',
        name: 'Marketing',
        members: [
          ['Hina Altaf', 'Marketing Lead'],
          ['Raza Hamdani', 'Content Strategist'],
          ['Amna Zubair', 'Performance Marketer'],
          ['Owais Kazmi', 'Marketing Designer'],
        ],
      },
    ],
  },
  {
    id: 'operations',
    name: 'Operations & Finance',
    hue: 346,
    description: 'Finance, billing, people and the office.',
    head: ['Fatima Raza', 'Chief Operating Officer'],
    teams: [
      {
        id: 'finance',
        name: 'Finance',
        members: [
          ['Tariq Jameel', 'Finance Lead'],
          ['Sundas Arif', 'Accountant'],
          ['Yasir Hameed', 'Billing Specialist'],
        ],
      },
      {
        id: 'people',
        name: 'People',
        members: [
          ['Mariam Saeed', 'People Lead'],
          ['Kashif Naveed', 'Technical Recruiter'],
          ['Rida Ashraf', 'Office & IT Admin'],
        ],
      },
    ],
  },
];

// The three demo sign-ins (#25) are Alyan's team, by his request: Owner Saif,
// Admin Saim (Engineering), Member Alyan (Mobile). Everyone else is fictional.
const owner = person('Syed Muhammad Saif', 'Founder & CEO', 'owner', { shortName: 'Saif', email: 'saif@barqdigitalai.com' });

const people: Person[] = [owner];
const departments: Department[] = [];
const teams: Team[] = [];

for (const d of DEPARTMENT_SPECS) {
  const head = person(d.head[0], d.head[1], 'admin', { departmentId: d.id });
  people.push(head);
  departments.push({
    id: d.id,
    name: d.name,
    hue: d.hue,
    description: d.description,
    headId: head.id,
    teamIds: d.teams.map((t) => t.id),
  });
  for (const t of d.teams) {
    const members = t.members.map(([name, title], i) =>
      person(name, title, 'member', { departmentId: d.id, teamId: t.id, isLead: i === 0 }),
    );
    people.push(...members);
    teams.push({
      id: t.id,
      name: t.name,
      departmentId: d.id,
      leadId: members[0].id,
      memberIds: members.map((m) => m.id),
    });
  }
}

const P = (name: string) => slug(name);

/* ── Story items ────────────────────────────────────────────────────────── */
/* Hand-written: these are what the chat and the presenter talk about. */

const storyItems: BrainItem[] = [
  // Clients
  {
    id: 'client-kestrel', kind: 'client', title: 'Kestrel Health', status: 'at_risk', external: true,
    ownerIds: [P('Asad Mahmood'), P('Zain Abbas')], teamId: 'client-success', departmentId: 'delivery', source: 'hubspot',
    summary: 'Telehealth provider, 140k patients. Phase 2: patient app v2 with in-app payments. PKR 18M contract. Launch slipped a week.',
  },
  {
    id: 'client-indus', kind: 'client', title: 'Indus Freight', status: 'at_risk', external: true,
    ownerIds: [P('Mahnoor Saleem'), P('Junaid Akram')], teamId: 'sales', departmentId: 'growth', source: 'hubspot',
    summary: 'Logistics company using our shipper portal. Renewal due Oct 31 (PKR 9.6M/yr). Unhappy about support response times; invoice INV-2291 is 45 days overdue.',
  },
  {
    id: 'client-lumen', kind: 'client', title: 'Lumen Pay', status: 'on_track', external: true,
    ownerIds: [P('Adeel Chaudhry'), P('Erum Latif')], teamId: 'sales', departmentId: 'growth', source: 'hubspot',
    summary: 'Fintech prospect. Merchant dashboard pilot worth about PKR 12M. Proposal v3 sent; security questionnaire due Oct 8.',
  },
  {
    id: 'client-saffron', kind: 'client', title: 'Saffron & Co.', status: 'on_track', external: true,
    ownerIds: [P('Komal Rizvi'), P('Kamran Yousuf')], teamId: 'client-success', departmentId: 'delivery', source: 'hubspot',
    summary: 'Restaurant chain, 22 branches. Online ordering web app; UAT with kitchen staff next week.',
  },
  {
    id: 'client-tidewater', kind: 'client', title: 'Tidewater Retail', status: 'on_track', external: true,
    ownerIds: [P('Nida Pervaiz')], teamId: 'client-success', departmentId: 'delivery', source: 'hubspot',
    summary: 'E-commerce replatform from Magento to a headless stack. Discovery phase.',
  },
  {
    id: 'client-crescent', kind: 'client', title: 'Crescent Mobility', status: 'done', external: true,
    ownerIds: [P('Sara Imtiaz')], teamId: 'client-success', departmentId: 'delivery', source: 'hubspot',
    summary: 'Ride-hailing analytics dashboard. Phase 1 delivered Sep 15; NPS 9. Upsell conversation pending.',
  },

  // Projects
  {
    id: 'proj-kestrel-v2', kind: 'project', title: 'Kestrel app v2', status: 'at_risk',
    ownerIds: [P('Zain Abbas'), P('Alyan Ali'), P('Hassan Raza'), P('Noor Fatima')], teamId: 'mobile', departmentId: 'engineering', source: 'jira',
    relatedIds: ['client-kestrel'],
    summary: 'Patient app rebuild with in-app payments. 78% of sprint scope done. Launch now Oct 20 (was Oct 13).',
  },
  {
    id: 'proj-indus-portal', kind: 'project', title: 'Indus shipper portal', status: 'on_track',
    ownerIds: [P('Kamran Yousuf'), P('Faizan Ali'), P('Taha Siddiqui')], teamId: 'web', departmentId: 'engineering', source: 'jira',
    relatedIds: ['client-indus'],
    summary: 'Live since March. Current work: real-time tracking updates and faster support triage.',
  },
  {
    id: 'proj-saffron-ordering', kind: 'project', title: 'Saffron online ordering', status: 'on_track',
    ownerIds: [P('Maryam Aslam'), P('Iqra Nadeem'), P('Komal Rizvi')], teamId: 'web', departmentId: 'engineering', source: 'linear',
    relatedIds: ['client-saffron'],
    summary: 'Ordering and kitchen display app. Feature-complete; UAT Oct 7–9.',
  },
  {
    id: 'proj-aws-bahrain', kind: 'project', title: 'AWS Bahrain migration', status: 'on_track',
    ownerIds: [P('Usman Tariq'), P('Ali Haider'), P('Hira Javed')], teamId: 'platform', departmentId: 'engineering', source: 'jira',
    summary: 'Move production from Frankfurt to me-south-1 for latency and data-residency. Cutover target Nov 15.',
  },
  {
    id: 'proj-arc-ds', kind: 'project', title: 'Arc design system v3', status: 'on_track',
    ownerIds: [P('Zoya Rehman'), P('Fahad Mustafa'), P('Waqas Butt')], teamId: 'design', departmentId: 'product', source: 'figma',
    summary: 'Shared tokens and components across client builds. Cuts new-project UI setup from 2 weeks to 3 days.',
  },
  {
    id: 'proj-lumen-pilot', kind: 'project', title: 'Lumen Pay pilot scope', status: 'on_track',
    ownerIds: [P('Rabia Anwar'), P('Shoaib Akhtar'), P('Erum Latif')], teamId: 'product-mgmt', departmentId: 'product', source: 'notion',
    relatedIds: ['client-lumen'],
    summary: 'Six-week merchant dashboard pilot. Scope and estimate are in proposal v3.',
  },
  {
    id: 'proj-q4-campaign', kind: 'project', title: 'Q4 "Built in Lahore" campaign', status: 'on_track',
    ownerIds: [P('Hina Altaf'), P('Raza Hamdani'), P('Amna Zubair'), P('Owais Kazmi')], teamId: 'marketing', departmentId: 'growth', source: 'clickup',
    summary: 'Case-study-led campaign. Kestrel and Crescent stories; LinkedIn plus two events.',
  },
  {
    id: 'proj-hiring-q4', kind: 'project', title: 'Hiring: 3 backend engineers', status: 'on_track',
    ownerIds: [P('Mariam Saeed'), P('Kashif Naveed'), P('Usman Tariq')], teamId: 'people', departmentId: 'operations', source: 'notion',
    summary: 'Roles opened Sep 30 after the leadership meeting. Target start dates in December.',
  },

  // Meetings
  {
    id: 'mtg-kestrel-sync', kind: 'meeting', title: 'Kestrel Health weekly sync', date: '2026-10-01', status: 'at_risk', external: true,
    ownerIds: [P('Asad Mahmood'), P('Zain Abbas'), P('Alyan Ali'), P('Sana Malik')], teamId: 'client-success', departmentId: 'delivery', source: 'zoom',
    relatedIds: ['client-kestrel', 'proj-kestrel-v2', 'dec-kestrel-launch'],
    summary: "Payment SDK certification with Kestrel's PSP is still pending. Agreed to move launch from Oct 13 to Oct 20. Kestrel's Dr. Nadia asked for a written revised timeline by Friday.",
  },
  {
    id: 'mtg-indus-renewal', kind: 'meeting', title: 'Indus Freight renewal call', date: '2026-09-29', status: 'at_risk', external: true,
    ownerIds: [P('Mahnoor Saleem'), P('Junaid Akram'), P('Omar Farooq')], teamId: 'sales', departmentId: 'growth', source: 'google_meet',
    relatedIds: ['client-indus', 'dec-indus-discount', 'task-indus-sla'],
    summary: 'Client unhappy with 2-day support response times; asked for 10% off the renewal. We committed to a written SLA proposal by Oct 6.',
  },
  {
    id: 'mtg-leadership', kind: 'meeting', title: 'Leadership weekly', date: '2026-09-30',
    ownerIds: [owner.id, P('Saim'), P('Bilal Ahmed'), P('Sana Malik'), P('Omar Farooq'), P('Fatima Raza')], departmentId: 'operations', source: 'fireflies',
    relatedIds: ['dec-aws-bahrain', 'dec-hiring', 'client-indus', 'client-kestrel'],
    summary: 'Approved AWS Bahrain migration. Opened 3 backend roles. Flagged Kestrel slip and Indus renewal as the two biggest risks this month.',
  },
  {
    id: 'mtg-lumen-discovery', kind: 'meeting', title: 'Lumen Pay discovery call', date: '2026-09-26', external: true,
    ownerIds: [P('Adeel Chaudhry'), P('Erum Latif'), P('Rabia Anwar')], teamId: 'sales', departmentId: 'growth', source: 'fireflies',
    relatedIds: ['client-lumen', 'task-lumen-security'],
    summary: 'Lumen CTO wants SOC 2-style answers before a pilot. Security questionnaire due Oct 8. Pilot could start Nov 1.',
  },
  {
    id: 'mtg-design-crit', kind: 'meeting', title: 'Design crit: Kestrel onboarding', date: '2026-09-30',
    ownerIds: [P('Zoya Rehman'), P('Fahad Mustafa'), P('Anam Sheikh'), P('Alyan Ali')], teamId: 'design', departmentId: 'product', source: 'google_meet',
    relatedIds: ['proj-kestrel-v2'],
    summary: 'Cut onboarding from 6 screens to 3. Usability test showed elderly patients dropping at OTP step.',
  },
  {
    id: 'mtg-saffron-uat-prep', kind: 'meeting', title: 'Saffron UAT prep', date: '2026-10-02',
    ownerIds: [P('Komal Rizvi'), P('Sadia Batool'), P('Maryam Aslam')], teamId: 'qa', departmentId: 'delivery', source: 'otter',
    relatedIds: ['proj-saffron-ordering', 'task-saffron-uat', 'client-saffron'],
    summary: 'UAT runs Oct 7–9 at the Gulberg and DHA branches. Kitchen display needs a large-font mode before staff test it.',
  },
  {
    id: 'mtg-crescent-qbr', kind: 'meeting', title: 'Crescent Mobility quarterly review', date: '2026-09-25', external: true,
    ownerIds: [P('Sara Imtiaz'), P('Shahzaib Qadir'), P('Nida Pervaiz')], teamId: 'client-success', departmentId: 'delivery', source: 'fathom',
    relatedIds: ['client-crescent', 'task-crescent-upsell'],
    summary: 'Phase 1 dashboard is in daily use by 40 dispatchers. Crescent asked for a driver app proposal for phase 2.',
  },

  // Decisions
  {
    id: 'dec-kestrel-launch', kind: 'decision', title: 'Kestrel v2 launch moved to Oct 20', date: '2026-10-01',
    ownerIds: [P('Sana Malik'), P('Zain Abbas')], teamId: 'mobile', departmentId: 'engineering', source: 'zoom',
    relatedIds: ['proj-kestrel-v2', 'client-kestrel'],
    summary: 'One-week slip to finish PSP certification. No scope cut. Client agreed verbally on the call.',
  },
  {
    id: 'dec-aws-bahrain', kind: 'decision', title: 'Migrate production to AWS Bahrain', date: '2026-09-30',
    ownerIds: [owner.id, P('Saim')], departmentId: 'engineering', source: 'fireflies',
    relatedIds: ['proj-aws-bahrain'],
    summary: 'Approved: about 90ms lower latency for Gulf clients and data stays in-region. Budget +8% infra cost.',
  },
  {
    id: 'dec-hiring', kind: 'decision', title: 'Open 3 backend engineer roles', date: '2026-09-30',
    ownerIds: [owner.id, P('Fatima Raza')], departmentId: 'operations', source: 'fireflies',
    relatedIds: ['proj-hiring-q4'],
    summary: 'Hiring freeze lifted for backend only. Platform team is at 120% load with the migration.',
  },
  {
    id: 'dec-indus-discount', kind: 'decision', title: 'Indus renewal: offer 5% (not 10%) + SLA', date: '2026-10-01', status: 'pending_approval', external: true,
    ownerIds: [P('Omar Farooq'), P('Mahnoor Saleem')], teamId: 'sales', departmentId: 'growth', source: 'slack',
    relatedIds: ['client-indus', 'mtg-indus-renewal'],
    summary: 'Proposed counter-offer: 5% discount plus a 4-hour support SLA. Waiting on Saif before it goes to the client.',
  },
  {
    id: 'dec-arc-tokens', kind: 'decision', title: 'All new client builds start on Arc v3', date: '2026-09-22',
    ownerIds: [P('Bilal Ahmed'), P('Zoya Rehman')], departmentId: 'product', source: 'notion',
    relatedIds: ['proj-arc-ds'],
  },

  // Tasks
  {
    id: 'task-kestrel-sdk', kind: 'task', title: 'Finish payment SDK certification', date: '2026-10-08', status: 'blocked',
    ownerIds: [P('Alyan Ali'), P('Hira Javed')], teamId: 'mobile', departmentId: 'engineering', source: 'jira',
    relatedIds: ['proj-kestrel-v2'],
    summary: "Blocked: PSP sandbox returns 3-D Secure errors on test cards. Ticket open with the PSP since Sep 27.",
  },
  {
    id: 'task-kestrel-email', kind: 'task', title: 'Send Kestrel the revised launch timeline', date: '2026-10-03', status: 'pending_approval', external: true,
    ownerIds: [P('Asad Mahmood')], teamId: 'client-success', departmentId: 'delivery', source: 'gmail',
    relatedIds: ['client-kestrel', 'mtg-kestrel-sync'],
    summary: 'Draft email to Dr. Nadia (Kestrel) is ready; needs approval before it is sent.',
  },
  {
    id: 'task-indus-invoice', kind: 'task', title: 'Chase overdue invoice INV-2291 (PKR 4.2M)', date: '2026-10-04', status: 'at_risk', external: true,
    ownerIds: [P('Yasir Hameed'), P('Tariq Jameel')], teamId: 'finance', departmentId: 'operations', source: 'quickbooks',
    relatedIds: ['client-indus'],
    summary: '45 days overdue. Two reminders sent. Indus AP says it is "with management" pending the renewal.',
  },
  {
    id: 'task-indus-sla', kind: 'task', title: 'Draft 4-hour support SLA for Indus', date: '2026-10-06', status: 'on_track',
    ownerIds: [P('Junaid Akram'), P('Imran Ghani')], teamId: 'client-success', departmentId: 'delivery', source: 'google_docs',
    relatedIds: ['client-indus', 'mtg-indus-renewal'],
  },
  {
    id: 'task-lumen-security', kind: 'task', title: 'Complete Lumen Pay security questionnaire', date: '2026-10-08', status: 'on_track', external: true,
    ownerIds: [P('Erum Latif'), P('Ali Haider')], teamId: 'sales', departmentId: 'growth', source: 'gmail',
    relatedIds: ['client-lumen', 'mtg-lumen-discovery'],
    summary: '64 questions; 41 answered. Encryption-at-rest and incident-response sections remain.',
  },
  {
    id: 'task-aws-runbook', kind: 'task', title: 'Write AWS cutover runbook', date: '2026-10-15', status: 'on_track',
    ownerIds: [P('Ali Haider'), P('Usman Tariq')], teamId: 'platform', departmentId: 'engineering', source: 'notion',
    relatedIds: ['proj-aws-bahrain'],
  },
  {
    id: 'task-hiring-jd', kind: 'task', title: 'Publish backend engineer job description', date: '2026-10-03', status: 'on_track',
    ownerIds: [P('Kashif Naveed')], teamId: 'people', departmentId: 'operations', source: 'notion',
    relatedIds: ['proj-hiring-q4'],
  },
  {
    id: 'task-saffron-uat', kind: 'task', title: 'Run UAT with Saffron kitchen staff', date: '2026-10-07', status: 'on_track', external: true,
    ownerIds: [P('Sadia Batool'), P('Komal Rizvi')], teamId: 'qa', departmentId: 'delivery', source: 'clickup',
    relatedIds: ['proj-saffron-ordering', 'client-saffron'],
  },
  {
    id: 'task-crescent-upsell', kind: 'task', title: 'Pitch Crescent phase 2 (driver app)', date: '2026-10-10', status: 'on_track', external: true,
    ownerIds: [P('Sara Imtiaz'), P('Shahzaib Qadir')], teamId: 'client-success', departmentId: 'delivery', source: 'hubspot',
    relatedIds: ['client-crescent'],
  },
  {
    id: 'task-case-study', kind: 'task', title: 'Draft Crescent Mobility case study', date: '2026-10-09', status: 'on_track',
    ownerIds: [P('Raza Hamdani')], teamId: 'marketing', departmentId: 'growth', source: 'google_docs',
    relatedIds: ['client-crescent', 'proj-q4-campaign'],
  },

  // Documents
  {
    id: 'doc-kestrel-sow', kind: 'document', title: 'Kestrel Health SOW — Phase 2', date: '2026-07-14',
    ownerIds: [P('Asad Mahmood'), P('Sana Malik')], teamId: 'client-success', departmentId: 'delivery', source: 'google_drive',
    relatedIds: ['client-kestrel'],
  },
  {
    id: 'doc-indus-msa', kind: 'document', title: 'Indus Freight MSA renewal draft', date: '2026-09-25',
    ownerIds: [P('Mahnoor Saleem'), P('Fatima Raza')], teamId: 'sales', departmentId: 'growth', source: 'google_docs',
    relatedIds: ['client-indus'],
  },
  {
    id: 'doc-lumen-proposal', kind: 'document', title: 'Lumen Pay pilot proposal v3', date: '2026-09-28',
    ownerIds: [P('Adeel Chaudhry'), P('Rabia Anwar')], teamId: 'sales', departmentId: 'growth', source: 'google_docs',
    relatedIds: ['client-lumen', 'proj-lumen-pilot'],
  },
  {
    id: 'doc-q4-okrs', kind: 'document', title: 'Q4 company OKRs', date: '2026-09-20',
    ownerIds: [owner.id], departmentId: 'operations', source: 'google_docs',
    summary: 'Revenue PKR 85M for Q4; two new logos; gross margin 42%; zero missed client launches.',
  },
  {
    id: 'doc-rate-card', kind: 'document', title: '2026 pricing & rate card', date: '2026-08-02',
    ownerIds: [P('Omar Farooq'), P('Fatima Raza')], departmentId: 'growth', source: 'google_drive',
  },
  {
    id: 'doc-eng-handbook', kind: 'document', title: 'Engineering handbook: releases & on-call', date: '2026-06-11',
    ownerIds: [P('Saim')], departmentId: 'engineering', source: 'notion',
  },

  // Threads
  {
    id: 'thr-kestrel-slack', kind: 'thread', title: '#kestrel-v2: PSP sandbox 3-D Secure errors', date: '2026-10-01',
    ownerIds: [P('Alyan Ali'), P('Hira Javed'), P('Zain Abbas')], teamId: 'mobile', departmentId: 'engineering', source: 'slack',
    relatedIds: ['task-kestrel-sdk'],
  },
  {
    id: 'thr-indus-whatsapp', kind: 'thread', title: 'WhatsApp: Indus ops manager on late tracking updates', date: '2026-09-28', external: true,
    ownerIds: [P('Junaid Akram')], teamId: 'client-success', departmentId: 'delivery', source: 'whatsapp',
    relatedIds: ['client-indus'],
  },
  {
    id: 'thr-lumen-email', kind: 'thread', title: 'Email: Lumen CTO on security questionnaire', date: '2026-09-29', external: true,
    ownerIds: [P('Erum Latif'), P('Adeel Chaudhry')], teamId: 'sales', departmentId: 'growth', source: 'gmail',
    relatedIds: ['client-lumen', 'task-lumen-security'],
  },
  {
    id: 'thr-office-move', kind: 'thread', title: '#general: office moves to Gulberg on Nov 1', date: '2026-09-24',
    ownerIds: [P('Rida Ashraf'), P('Fatima Raza')], teamId: 'people', departmentId: 'operations', source: 'slack',
  },
];

/* ── Background items ───────────────────────────────────────────────────── */
/*
 * Everyday work so every member has their own small brain in the graph. Picked
 * deterministically (no Math.random) so server and client render identically.
 */

type Template = [kind: BrainItem['kind'], title: string, source: string];

const TEAM_TEMPLATES: Record<string, { related: string[]; templates: Template[] }> = {
  platform: {
    related: ['proj-aws-bahrain'],
    templates: [
      ['task', 'Review PR: API rate limiter', 'github'],
      ['document', 'On-call handover notes', 'notion'],
      ['task', 'Tune Postgres connection pool', 'jira'],
      ['thread', '#platform: staging migrations failing', 'slack'],
      ['document', 'Incident review: Sep 24 API latency', 'notion'],
      ['task', 'Terraform module for me-south-1 VPC', 'github'],
    ],
  },
  mobile: {
    related: ['proj-kestrel-v2'],
    templates: [
      ['task', 'Fix crash on Android 11 video calls', 'jira'],
      ['task', 'Appointment reminders push flow', 'jira'],
      ['thread', '#mobile: TestFlight build 2.0.14 feedback', 'slack'],
      ['document', 'Release checklist v2.0', 'notion'],
      ['task', 'Accessibility pass on onboarding', 'jira'],
      ['meeting', 'Mobile sprint planning', 'google_meet'],
    ],
  },
  web: {
    related: ['proj-indus-portal', 'proj-saffron-ordering'],
    templates: [
      ['task', 'Live shipment tracking websocket', 'jira'],
      ['task', 'Kitchen display: order bump bar', 'linear'],
      ['thread', '#web: Next.js upgrade plan', 'slack'],
      ['document', 'Frontend performance budget', 'notion'],
      ['task', 'Support ticket triage view', 'jira'],
      ['meeting', 'Web team standup notes', 'google_meet'],
    ],
  },
  'product-mgmt': {
    related: ['proj-lumen-pilot', 'proj-kestrel-v2'],
    templates: [
      ['document', 'Lumen merchant dashboard PRD', 'notion'],
      ['task', 'Prioritise Indus portal backlog', 'jira'],
      ['meeting', 'Roadmap review', 'google_meet'],
      ['document', 'Kestrel v2 release notes', 'notion'],
      ['task', 'Usage analytics: portal funnel', 'linear'],
    ],
  },
  design: {
    related: ['proj-arc-ds', 'proj-kestrel-v2'],
    templates: [
      ['task', 'Arc v3: data table component', 'figma'],
      ['document', 'Kestrel onboarding usability findings', 'notion'],
      ['task', 'Saffron menu photography guidelines', 'figma'],
      ['thread', '#design: icon set licensing', 'slack'],
      ['task', 'Arc v3 dark-mode tokens', 'figma'],
    ],
  },
  'client-success': {
    related: ['client-kestrel', 'client-indus', 'client-saffron'],
    templates: [
      ['meeting', 'Client health review', 'google_meet'],
      ['task', 'Monthly status report to client', 'google_docs'],
      ['thread', 'Email: change request CR-07', 'gmail'],
      ['document', 'Delivery risk register', 'google_drive'],
      ['task', 'Update project plan in ClickUp', 'clickup'],
    ],
  },
  qa: {
    related: ['proj-saffron-ordering', 'proj-kestrel-v2'],
    templates: [
      ['task', 'Regression suite: payments', 'jira'],
      ['document', 'UAT test cases — Saffron', 'google_drive'],
      ['task', 'Device lab: iOS 18 sweep', 'jira'],
      ['thread', '#qa: flaky Cypress tests', 'slack'],
    ],
  },
  sales: {
    related: ['client-lumen', 'client-indus'],
    templates: [
      ['meeting', 'Pipeline review', 'zoom'],
      ['task', 'Follow up: inbound lead from Dubai', 'hubspot'],
      ['thread', 'Email: proposal questions', 'gmail'],
      ['document', 'Competitor pricing notes', 'google_drive'],
    ],
  },
  marketing: {
    related: ['proj-q4-campaign'],
    templates: [
      ['task', 'LinkedIn carousel: Kestrel story', 'clickup'],
      ['document', 'Event plan: Lahore tech meetup', 'google_docs'],
      ['task', 'Website case-study pages', 'clickup'],
      ['thread', '#marketing: Q4 ad budget', 'slack'],
    ],
  },
  finance: {
    related: ['client-indus'],
    templates: [
      ['task', 'September payroll reconciliation', 'quickbooks'],
      ['document', 'Q3 receivables ageing', 'google_drive'],
      ['task', 'Issue October invoices', 'quickbooks'],
      ['thread', 'Email: bank FX rate query', 'gmail'],
    ],
  },
  people: {
    related: ['proj-hiring-q4'],
    templates: [
      ['task', 'Schedule backend candidate screens', 'google_calendar'],
      ['document', 'Onboarding checklist', 'notion'],
      ['thread', '#general: Q4 town hall', 'slack'],
      ['task', 'Laptop procurement for new hires', 'clickup'],
    ],
  },
};

const ADMIN_TEMPLATES: Template[] = [
  ['meeting', '1:1 notes', 'google_meet'],
  ['document', 'Team Q4 plan', 'google_docs'],
  ['task', 'Approve team leave calendar', 'google_calendar'],
  ['thread', 'Leadership thread: budget', 'slack'],
];

function isoDaysAgo(days: number): string {
  // Anchored to the demo's "today" so dates never drift with the real clock.
  const base = Date.UTC(2026, 9, 2);
  return new Date(base - days * 86_400_000).toISOString().slice(0, 10);
}

const backgroundItems: BrainItem[] = [];

for (const t of teams) {
  const spec = TEAM_TEMPLATES[t.id];
  if (!spec) continue;
  t.memberIds.forEach((memberId, mi) => {
    // 4–5 items each, rotated so teammates don't share identical lists.
    const count = 4 + (mi % 2);
    for (let k = 0; k < count; k++) {
      const [kind, title, source] = spec.templates[(mi + k) % spec.templates.length];
      backgroundItems.push({
        id: `bg-${memberId}-${k}`,
        kind,
        title,
        ownerIds: [memberId],
        teamId: t.id,
        departmentId: t.departmentId,
        source,
        date: isoDaysAgo((mi * 3 + k * 2) % 14),
        status: kind === 'task' ? (k === 3 ? 'done' : 'on_track') : undefined,
        relatedIds: [spec.related[(mi + k) % spec.related.length]],
      });
    }
  });
}

for (const d of departments) {
  ADMIN_TEMPLATES.forEach(([kind, title, source], k) => {
    backgroundItems.push({
      id: `bg-${d.headId}-${k}`,
      kind,
      title: `${d.name}: ${title}`,
      ownerIds: [d.headId],
      departmentId: d.id,
      source,
      date: isoDaysAgo(k * 3),
    });
  });
}

export const ORG: Org = {
  id: 'barq-digital',
  name: 'Barq Digital',
  tagline: 'Software house · Lahore & Dubai',
  city: 'Lahore',
  ownerId: owner.id,
  departments,
  teams,
  people,
  items: [...storyItems, ...backgroundItems],
};

/* ── Lookups ────────────────────────────────────────────────────────────── */

const peopleById = new Map(people.map((p) => [p.id, p]));
const teamsById = new Map(teams.map((t) => [t.id, t]));
const departmentsById = new Map(departments.map((d) => [d.id, d]));
const itemsById = new Map(ORG.items.map((i) => [i.id, i]));

export const getPerson = (id: string) => peopleById.get(id);
export const getTeam = (id: string) => teamsById.get(id);
export const getDepartment = (id: string) => departmentsById.get(id);
export const getItem = (id: string) => itemsById.get(id);

/** How the UI addresses someone: "Saif", not "Syed". */
export const firstName = (p?: Person) => p?.shortName ?? p?.name.split(' ')[0] ?? '';

/** The personas the role switcher steps into. */
export const DEMO_PERSONAS: Record<'owner' | 'admin' | 'member', string> = {
  owner: owner.id,
  admin: P('Saim'),
  member: P('Alyan Ali'),
};
