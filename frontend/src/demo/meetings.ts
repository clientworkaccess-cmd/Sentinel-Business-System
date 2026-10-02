/**
 * Meeting detail for the demo (#9): decisions, action items and transcript
 * excerpts. Keyed by the meeting's BrainItem id in `org.ts`, so who can see a
 * meeting is decided by the same `itemsInScope` rules as everything else.
 *
 * An action item addressed to someone outside the company carries `draft` — the
 * message Sentinel wrote — and waits in `pending_approval` until a human approves.
 */
import { DEMO_PERSONAS } from './org';

export interface ActionItem {
  id: string;
  text: string;
  ownerId: string;
  due?: string;
  status: 'open' | 'done' | 'pending_approval';
  /** Outside party it goes to. Set ⇒ needs human approval before sending. */
  externalTo?: string;
  /** The drafted message, shown for approval. */
  draft?: string;
  /** BrainItem this became, if any. */
  itemId?: string;
}

export interface TranscriptLine {
  /** Person id, or a display name for someone outside the company. */
  speaker: string;
  at: string;
  text: string;
}

export interface MeetingDetail {
  id: string;
  time: string;
  durationMin: number;
  /** People outside the company who were in the room. */
  guests?: string[];
  decisions: string[];
  actions: ActionItem[];
  transcript: TranscriptLine[];
}

const ALYAN = DEMO_PERSONAS.member;

export const MEETING_DETAILS: Record<string, MeetingDetail> = {
  'mtg-kestrel-sync': {
    id: 'mtg-kestrel-sync',
    time: '15:00',
    durationMin: 42,
    guests: ['Dr. Nadia Hassan (Kestrel Health)', 'Imran Sheikh (Kestrel IT)'],
    decisions: [
      'Launch moves from Oct 13 to Oct 20. No scope is cut.',
      'Kestrel gets a written revised timeline by Friday, Oct 3.',
      'If the PSP sandbox is still failing on Oct 8, both sides escalate to the PSP together.',
    ],
    actions: [
      {
        id: 'a-kes-1', text: 'Send Dr. Nadia the revised launch timeline', ownerId: 'asad-mahmood', due: '2026-10-03',
        status: 'pending_approval', externalTo: 'Dr. Nadia Hassan, Kestrel Health', itemId: 'task-kestrel-email',
        draft: `Hi Dr. Nadia,

Thank you for your patience on yesterday's call. As agreed, here is the revised plan for the patient app v2:

• Payment certification with your PSP: target Oct 8
• Final QA and store submission: Oct 13–17
• Launch: Monday, Oct 20

No features have been removed. We'll send a short status note every Wednesday until launch.

Best regards,
Asad Mahmood
Arcline Technologies`,
      },
      { id: 'a-kes-2', text: 'Finish payment SDK certification', ownerId: ALYAN, due: '2026-10-08', status: 'open', itemId: 'task-kestrel-sdk' },
      { id: 'a-kes-3', text: "Escalate the PSP ticket with their account manager", ownerId: 'zain-abbas', due: '2026-10-05', status: 'open' },
    ],
    transcript: [
      { speaker: 'Dr. Nadia Hassan (Kestrel Health)', at: '00:02:10', text: "Where are we on payments? Our board is expecting the 13th." },
      { speaker: ALYAN, at: '00:03:02', text: 'The SDK is integrated, but the PSP sandbox rejects every 3-D Secure test card. We have a ticket open since the 27th.' },
      { speaker: 'zain-abbas', at: '00:04:40', text: "Realistically we need one more week. I'd rather move to the 20th than launch with payments half-tested." },
      { speaker: 'Dr. Nadia Hassan (Kestrel Health)', at: '00:06:15', text: "The 20th works if nothing else slips. I need it in writing by Friday for the board." },
      { speaker: 'asad-mahmood', at: '00:06:48', text: "Understood. I'll send the revised timeline by Friday." },
      { speaker: 'sana-malik', at: '00:38:20', text: 'If the sandbox is still broken on the 8th, we escalate to the PSP together.' },
    ],
  },

  'mtg-indus-renewal': {
    id: 'mtg-indus-renewal',
    time: '11:30',
    durationMin: 35,
    guests: ['Faisal Qureshi (Indus Freight, Ops)', 'Rehana Aziz (Indus Freight, Finance)'],
    decisions: [
      'We will propose a written support SLA before discussing price.',
      'Discount is not agreed. Our counter-offer needs Owner approval first.',
    ],
    actions: [
      {
        id: 'a-ind-1', text: 'Send Indus the counter-offer: 5% plus a 4-hour support SLA', ownerId: 'omar-farooq', due: '2026-10-06',
        status: 'pending_approval', externalTo: 'Faisal Qureshi, Indus Freight', itemId: 'dec-indus-discount',
        draft: `Hi Faisal,

Thanks for the candid conversation on Monday. We heard you on response times, and we want to fix that properly, not just discount it.

Our proposal for the renewal:
• A 4-hour first-response SLA for priority issues, 24/7
• A named support engineer for your account
• 5% off the annual renewal

The full SLA document follows by Oct 6. Happy to walk your team through it.

Regards,
Omar Farooq
Head of Growth, Arcline Technologies`,
      },
      { id: 'a-ind-2', text: 'Draft the 4-hour support SLA', ownerId: 'junaid-akram', due: '2026-10-06', status: 'open', itemId: 'task-indus-sla' },
      { id: 'a-ind-3', text: 'Chase overdue invoice INV-2291 (PKR 4.2M)', ownerId: 'yasir-hameed', due: '2026-10-04', status: 'open', itemId: 'task-indus-invoice' },
    ],
    transcript: [
      { speaker: 'Faisal Qureshi (Indus Freight, Ops)', at: '00:01:30', text: 'Two days to respond to a tracking outage is not acceptable for us. Our drivers were blind for a whole afternoon.' },
      { speaker: 'mahnoor-saleem', at: '00:03:05', text: "That's fair, and we're sorry. We want to fix the process, not just apologise." },
      { speaker: 'Rehana Aziz (Indus Freight, Finance)', at: '00:12:40', text: 'For renewal we are looking for at least ten percent off, given the issues.' },
      { speaker: 'omar-farooq', at: '00:13:10', text: "Let us come back with a written SLA first. Then we can talk about price with something concrete on the table." },
      { speaker: 'junaid-akram', at: '00:31:00', text: "I'll have the SLA draft to you by the 6th." },
    ],
  },

  'mtg-leadership': {
    id: 'mtg-leadership',
    time: '10:00',
    durationMin: 55,
    decisions: [
      'Migrate production to AWS Bahrain (me-south-1). Cutover by Nov 15.',
      'Open 3 backend engineer roles. The freeze is lifted for backend only.',
      'Kestrel launch and Indus renewal are this month’s two biggest risks; review both every Monday.',
    ],
    actions: [
      { id: 'a-led-1', text: 'Publish the backend engineer job description', ownerId: 'kashif-naveed', due: '2026-10-03', status: 'open', itemId: 'task-hiring-jd' },
      { id: 'a-led-2', text: 'Write the AWS cutover runbook', ownerId: 'ali-haider', due: '2026-10-15', status: 'open', itemId: 'task-aws-runbook' },
      { id: 'a-led-3', text: 'Add Kestrel and Indus to the Monday risk review', ownerId: 'sana-malik', due: '2026-10-05', status: 'done' },
    ],
    transcript: [
      { speaker: DEMO_PERSONAS.owner, at: '00:04:12', text: 'Bahrain gets us ninety milliseconds for Gulf clients and keeps their data in-region. I am for it.' },
      { speaker: DEMO_PERSONAS.admin, at: '00:06:30', text: "Platform is at a hundred and twenty percent with the migration. We can't also absorb new client work without hiring." },
      { speaker: 'fatima-raza', at: '00:08:05', text: 'Budget allows three backend roles if we keep the freeze everywhere else.' },
      { speaker: DEMO_PERSONAS.owner, at: '00:41:50', text: "Kestrel and Indus — I want both on the Monday risk review until they're closed." },
    ],
  },

  'mtg-lumen-discovery': {
    id: 'mtg-lumen-discovery',
    time: '16:00',
    durationMin: 48,
    guests: ['Hamid Raza (Lumen Pay, CTO)'],
    decisions: [
      'Pilot scope: merchant dashboard only, six weeks.',
      'Security questionnaire comes before any pricing discussion.',
    ],
    actions: [
      { id: 'a-lum-1', text: 'Complete the Lumen Pay security questionnaire', ownerId: 'erum-latif', due: '2026-10-08', status: 'open', itemId: 'task-lumen-security' },
      {
        id: 'a-lum-2', text: 'Send Lumen the proposed pilot timeline', ownerId: 'adeel-chaudhry', due: '2026-10-03',
        status: 'pending_approval', externalTo: 'Hamid Raza, Lumen Pay',
        draft: `Hi Hamid,

Great speaking with you on Friday. As discussed, here's how a six-week merchant dashboard pilot would run:

• Oct 8: security questionnaire returned
• Oct 20: pilot kickoff and access to your sandbox
• Nov 28: pilot review with your team

Let me know if Nov 1 suits better for kickoff and we'll adjust.

Best,
Adeel Chaudhry
Arcline Technologies`,
      },
    ],
    transcript: [
      { speaker: 'Hamid Raza (Lumen Pay, CTO)', at: '00:05:20', text: "Before we talk money, I need to see how you handle encryption at rest and incident response." },
      { speaker: 'erum-latif', at: '00:06:02', text: "Send us your questionnaire and we'll turn it around within the week." },
      { speaker: 'rabia-anwar', at: '00:22:45', text: 'For the pilot I would keep it to the merchant dashboard. Six weeks is enough to prove it.' },
    ],
  },

  'mtg-design-crit': {
    id: 'mtg-design-crit',
    time: '14:00',
    durationMin: 30,
    decisions: ['Onboarding goes from 6 screens to 3.', 'OTP is replaced by a magic link for patients over 60.'],
    actions: [
      { id: 'a-des-1', text: 'Redesign onboarding as 3 screens', ownerId: 'fahad-mustafa', due: '2026-10-06', status: 'open' },
      { id: 'a-des-2', text: 'Implement magic-link sign-in for patients over 60', ownerId: ALYAN, due: '2026-10-09', status: 'open' },
    ],
    transcript: [
      { speaker: 'anam-sheikh', at: '00:01:40', text: 'Four of the six older patients we tested gave up at the OTP step. They could not switch apps fast enough.' },
      { speaker: 'zoya-rehman', at: '00:04:10', text: 'Then the OTP has to go for that group. Can we do a magic link?' },
      { speaker: ALYAN, at: '00:05:00', text: 'Yes, the auth provider supports it. I can have it in by the 9th.' },
    ],
  },

  'mtg-saffron-uat-prep': {
    id: 'mtg-saffron-uat-prep',
    time: '12:15',
    durationMin: 25,
    decisions: ['UAT runs Oct 7–9 at the Gulberg and DHA branches.', 'Kitchen display ships a large-font mode before UAT.'],
    actions: [
      { id: 'a-saf-1', text: 'Add large-font mode to the kitchen display', ownerId: 'maryam-aslam', due: '2026-10-06', status: 'open' },
      { id: 'a-saf-2', text: 'Run UAT with Saffron kitchen staff', ownerId: 'sadia-batool', due: '2026-10-07', status: 'open', itemId: 'task-saffron-uat' },
    ],
    transcript: [
      { speaker: 'komal-rizvi', at: '00:02:30', text: 'Kitchen staff read the screen from two metres away. The order text is too small.' },
      { speaker: 'maryam-aslam', at: '00:03:15', text: 'Large-font mode bana deti hoon, Monday tak ho jayega.' },
    ],
  },

  'mtg-crescent-qbr': {
    id: 'mtg-crescent-qbr',
    time: '17:00',
    durationMin: 40,
    guests: ['Usama Javed (Crescent Mobility, COO)'],
    decisions: ['Phase 2 proposal (driver app) goes to Crescent by Oct 10.'],
    actions: [
      {
        id: 'a-cre-1', text: 'Send Crescent the phase 2 driver app proposal', ownerId: 'sara-imtiaz', due: '2026-10-10',
        status: 'pending_approval', externalTo: 'Usama Javed, Crescent Mobility', itemId: 'task-crescent-upsell',
        draft: `Hi Usama,

Thank you for the review last week. Forty dispatchers using the dashboard every day is a great start.

Attached is our phase 2 proposal for the driver app: live job offers, navigation hand-off and earnings, built on the same data as your dispatch dashboard. We estimate ten weeks from kickoff.

Best regards,
Sara Imtiaz
Arcline Technologies`,
      },
    ],
    transcript: [
      { speaker: 'Usama Javed (Crescent Mobility, COO)', at: '00:06:00', text: 'The dashboard changed how dispatch works. Next we need the drivers on the same page.' },
      { speaker: 'shahzaib-qadir', at: '00:07:20', text: "We'll put a phase 2 proposal for a driver app in front of you by the 10th." },
    ],
  },
};
