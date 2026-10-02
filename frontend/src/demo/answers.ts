/**
 * Retrieval and offline answers over the demo memory.
 *
 * Pure (no server or browser APIs) so both sides can use it: the chat route uses
 * `retrieve` to ground Qwen and pick source chips, and falls back to
 * `offlineAnswer` when Qwen is unavailable; the chat page uses `offlineAnswer`
 * if the route itself cannot be reached. Either way the demo never shows an error.
 *
 * Everything here respects visibility: it only ever reads `itemsInScope`.
 */
import { ORG, getItem, getPerson } from './org';
import { SUGGESTED_PROMPTS } from './prompts';
import { itemsInScope } from './visibility';
import type { BrainItem, Role, Scope, Viewer } from './types';

/* ── Retrieval ─────────────────────────────────────────────────────────── */

const STOP = new Set([
  // English
  'the', 'and', 'for', 'with', 'what', 'who', 'whom', 'which', 'when', 'where', 'why', 'how', 'are', 'was', 'were',
  'is', 'did', 'does', 'this', 'that', 'there', 'their', 'about', 'tell', 'me', 'my', 'our', 'any', 'all', 'from',
  'right', 'now', 'have', 'has', 'been', 'into', 'everything', 'week', 'month', 'today', 'yesterday', 'else', 'people',
  // Roman Urdu
  'kya', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'mein', 'main', 'kis', 'haal', 'ne', 'kaam', 'kiya', 'aur', 'se',
  'par', 'tak', 'abhi', 'hafte', 'kal', 'wala', 'wali', 'status',
]);

/** Words that, when asked about, should bring a status forward. */
const STATUS_HINTS: [RegExp, BrainItem['status'][]][] = [
  [/risk|slip|late|behind|worr|problem|khatr/, ['at_risk', 'blocked']],
  [/block|stuck|ruk|atk/, ['blocked']],
  [/approv|sign.?off|waiting on me|manzoor/, ['pending_approval']],
];

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9؀-ۿ\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

export interface Hit {
  item: BrainItem;
  score: number;
}

function haystack(item: BrainItem) {
  const owners = item.ownerIds.map((id) => getPerson(id)?.name ?? '').join(' ');
  const related = (item.relatedIds ?? []).map((id) => getItem(id)?.title ?? '').join(' ');
  return {
    title: item.title.toLowerCase(),
    summary: (item.summary ?? '').toLowerCase(),
    owners: owners.toLowerCase(),
    related: related.toLowerCase(),
  };
}

/** Keyword retrieval over what the viewer can see in this scope. Highest score first. */
export function retrieve(question: string, viewer: Viewer, scope: Scope, limit = 8): Hit[] {
  const q = question.toLowerCase();
  const terms = tokens(question);
  const statusBoost = STATUS_HINTS.filter(([re]) => re.test(q)).flatMap(([, s]) => s);
  const hits: Hit[] = [];

  for (const item of itemsInScope(ORG, viewer, scope)) {
    const h = haystack(item);
    let score = 0;
    for (const t of terms) {
      if (h.title.includes(t)) score += 3;
      if (h.summary.includes(t)) score += 1.5;
      if (h.owners.includes(t)) score += 2;
      if (h.related.includes(t)) score += 1;
    }
    if (item.status && statusBoost.includes(item.status)) score += 4;
    // Hand-written story items carry the narrative; break ties in their favour.
    if (score > 0 && !item.id.startsWith('bg-')) score += 0.5;
    if (score > 0) hits.push({ item, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* ── Scripted answers ──────────────────────────────────────────────────── */

interface Scripted {
  text: string;
  sources: string[];
}

/**
 * One answer per suggested prompt, keyed by role. A prompt only matches inside its
 * own role, so a Member typing the Owner's question gets a retrieval answer over
 * their own memory — never the Owner's briefing.
 */
const SCRIPTED: Record<Role, Scripted[]> = {
  owner: [
    {
      text: `**Two clients are at risk right now.**

1. **Indus Freight**: the renewal is due **Oct 31** (PKR 9.6M/yr). They're unhappy with 2-day support response times and asked for 10% off. Invoice **INV-2291 (PKR 4.2M)** is 45 days overdue; their AP says it's "with management" until the renewal is settled. Omar and Mahnoor propose **5% plus a 4-hour SLA**, and that counter-offer is **waiting on your approval**.
2. **Kestrel Health**: the app v2 launch slipped **Oct 13 → Oct 20**. Payment-SDK certification is blocked on 3-D Secure errors in the PSP sandbox. Asad has drafted the revised-timeline email to Dr. Nadia; it's also **waiting on your approval**.

Everyone else is on track. Lumen Pay's security questionnaire is due Oct 8, Saffron's UAT runs Oct 7–9, Tidewater is in discovery, and Crescent phase 1 is delivered with an upsell pending.`,
      sources: ['client-indus', 'dec-indus-discount', 'task-indus-invoice', 'client-kestrel', 'task-kestrel-sdk', 'task-kestrel-email'],
    },
    {
      text: `In Wednesday's **Leadership weekly** (Sep 30, recorded by Fireflies), you and the five team admins decided:

1. **Migrate production to AWS Bahrain.** Cutover target **Nov 15**. It cuts about 90ms of latency for Gulf clients and keeps data in-region, for roughly +8% infra cost.
2. **Open 3 backend engineer roles.** The hiring freeze is lifted for backend only, because Platform is running at 120% load with the migration.
3. **The month's two biggest risks** are the Kestrel launch slip and the Indus Freight renewal.

Follow-ups already moving: Kashif publishes the job description (due Oct 3), and Ali and Usman are writing the cutover runbook (due Oct 15).`,
      sources: ['mtg-leadership', 'dec-aws-bahrain', 'dec-hiring', 'task-hiring-jd', 'task-aws-runbook'],
    },
    {
      text: `Indus Freight ka renewal **risk par hai**.

- Renewal **31 October** ko due hai (PKR 9.6M saalana).
- Client support ke **2 din** wale response time se naraz hai aur **10% discount** maang raha hai.
- Invoice **INV-2291 (PKR 4.2M)** 45 din se overdue hai. Un ka AP kehta hai renewal tak payment "management ke paas" hai.
- Omar aur Mahnoor ka counter-offer: **5% discount + 4 ghante ka support SLA**. Yeh **aap ki approval** ka intezar kar raha hai.
- Junaid aur Imran **6 October** tak SLA ka draft bana rahe hain.

Approval aate hi counter-offer client ko ja sakta hai.`,
      sources: ['client-indus', 'dec-indus-discount', 'task-indus-invoice', 'task-indus-sla', 'mtg-indus-renewal'],
    },
    {
      text: `**Two things are waiting on you.** Both go to people outside the company, so Sentinel drafted them and is holding them until you approve:

1. **Indus renewal counter-offer**: 5% discount (not the 10% they asked for) plus a 4-hour support SLA. Proposed by Omar and Mahnoor on Oct 1.
2. **Revised Kestrel timeline email**: Asad's draft to Dr. Nadia confirming the move to Oct 20. Kestrel asked for it in writing by **today**.

Nothing internal is blocked on you.`,
      sources: ['dec-indus-discount', 'task-kestrel-email'],
    },
  ],
  admin: [
    {
      text: `**One blocker: payment-SDK certification.**

- Areeba and Hira can't finish certification because the **PSP sandbox returns 3-D Secure errors** on test cards. A ticket has been open with the PSP since **Sep 27**. Due **Oct 8**.
- Because of it, the launch moved **Oct 13 → Oct 20** in yesterday's Kestrel sync. There's no scope cut, and the client agreed on the call.
- Everything else is moving: 78% of sprint scope is done, and design cut onboarding from 6 screens to 3 after elderly patients dropped off at the OTP step.

If the PSP ticket isn't resolved by Monday, Oct 20 is at risk too. It's worth escalating with their account manager.`,
      sources: ['task-kestrel-sdk', 'proj-kestrel-v2', 'dec-kestrel-launch', 'thr-kestrel-slack', 'mtg-design-crit'],
    },
    {
      text: `**Platform is over capacity**. Leadership put it at about **120% load** on Wednesday.

- **AWS Bahrain migration** (Usman, Ali, Hira): cutover Nov 15, runbook due Oct 15.
- **Hira** is also pulled into Mobile's payment-SDK certification, which is blocked.
- **Ali** is also answering the Lumen Pay security questionnaire with Sales (due Oct 8).
- Day to day: on-call, the API rate limiter and Postgres tuning.

Relief is coming: **3 backend roles** opened Sep 30, with December start dates. Until then, the Oct 8 double-booking on Ali and Hira is the pinch point.`,
      sources: ['proj-aws-bahrain', 'task-aws-runbook', 'task-kestrel-sdk', 'task-lumen-security', 'dec-hiring'],
    },
    {
      text: `Mobile team ne is hafte **Kestrel app v2** par kaam kiya:

- Sprint scope ka **78%** mukammal ho gaya.
- TestFlight **build 2.0.14** par feedback aaya aur fixes chal rahe hain.
- Android 11 par video call crash aur appointment reminders ka push flow.
- Design crit ke baad onboarding **6 se 3 screens** par aa gayi.

**Rukawat:** payment SDK certification. PSP sandbox mein 3-D Secure errors aa rahe hain, is liye launch **20 October** par shift hua.`,
      sources: ['proj-kestrel-v2', 'task-kestrel-sdk', 'dec-kestrel-launch', 'mtg-design-crit'],
    },
    {
      text: `**Two Engineering deadlines are slipping, both on Kestrel:**

1. **Kestrel app v2 launch**: moved **Oct 13 → Oct 20**.
2. **Payment-SDK certification**: due **Oct 8**, currently **blocked** on the PSP sandbox.

On track: the AWS cutover runbook (Oct 15), Saffron UAT support (Oct 7–9), and the Indus portal tracking work.`,
      sources: ['proj-kestrel-v2', 'task-kestrel-sdk', 'dec-kestrel-launch', 'task-aws-runbook'],
    },
  ],
  member: [
    {
      text: `**This week you owe:**

1. **Payment-SDK certification** (with Hira), due **Oct 8**. It's **blocked**: the PSP sandbox is throwing 3-D Secure errors. This is the critical path for the Oct 20 Kestrel launch.
2. **Appointment reminders push flow**: on track.

Already done: the accessibility pass on onboarding. You're also on the #kestrel-v2 thread where the SDK issue is being worked.`,
      sources: ['task-kestrel-sdk', 'thr-kestrel-slack', 'proj-kestrel-v2'],
    },
    {
      text: `**Kestrel Health weekly sync**, yesterday (Oct 1, Zoom), with Asad, Zain, Sana and you:

- Payment-SDK certification with Kestrel's PSP is **still pending**.
- The launch moves **Oct 13 → Oct 20**. There's no scope cut, and Kestrel agreed on the call.
- Dr. Nadia asked for the **revised timeline in writing by Friday**. Asad drafted it, and it's waiting for approval.

**Your action:** get the SDK certified by **Oct 8** so Oct 20 holds.`,
      sources: ['mtg-kestrel-sync', 'dec-kestrel-launch', 'task-kestrel-sdk'],
    },
    {
      text: `PSP certification abhi **blocked** hai.

- PSP ka sandbox test cards par **3-D Secure errors** de raha hai.
- PSP ke saath **27 September** se ticket khula hai.
- Deadline **8 October** hai. Aap aur Hira is par hain.
- Kestrel ka **20 October** launch isi par depend karta hai.

Details #kestrel-v2 Slack thread mein hain.`,
      sources: ['task-kestrel-sdk', 'thr-kestrel-slack', 'dec-kestrel-launch'],
    },
    {
      text: `On **Kestrel app v2** with you:

- **Zain Abbas**, Mobile Lead
- **Hassan Raza**, Android
- **Noor Fatima**, Flutter
- **Hira Javed**, backend, with you on SDK certification

Client side: **Asad Mahmood** is the account manager, and **Sana Malik** heads Delivery. Design (**Zoya, Fahad, Anam**) reworked onboarding in Wednesday's crit.`,
      sources: ['proj-kestrel-v2', 'task-kestrel-sdk', 'mtg-kestrel-sync', 'mtg-design-crit'],
    },
  ],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

/** The scripted answer for this exact suggested prompt in this role, if any. */
export function scriptedAnswer(question: string, role: Role): Scripted | null {
  const q = norm(question);
  const i = SUGGESTED_PROMPTS[role].findIndex((p) => norm(p) === q);
  return i >= 0 ? SCRIPTED[role][i] ?? null : null;
}

/* ── Offline composer ──────────────────────────────────────────────────── */

const ROMAN_URDU = /\b(kya|hai|hain|ka|ki|ke|mein|kis|haal|kaun|kab|kahan|kyun|batao|bataen)\b/i;
export const isRomanUrdu = (s: string) => ROMAN_URDU.test(s);

const STATUS_WORDS: Record<NonNullable<BrainItem['status']>, string> = {
  on_track: 'on track',
  at_risk: 'at risk',
  blocked: 'blocked',
  done: 'done',
  pending_approval: 'waiting on approval',
};

/** Answer without a model: the scripted reply, else a summary of the best retrieval hits. */
export function offlineAnswer(question: string, viewer: Viewer, scope: Scope): Scripted {
  const scripted = scriptedAnswer(question, viewer.role);
  if (scripted) return scripted;

  const hits = retrieve(question, viewer, scope, 4);
  const urdu = isRomanUrdu(question);
  if (!hits.length) {
    return {
      text: urdu
        ? 'Mujhe is baare mein aap ki nazar wali memory mein kuch nahi mila. Kisi client, project, meeting ya shakhs ka naam le kar poochiye.'
        : "I couldn't find anything about that in what you can see. Try naming a client, project, meeting or person, and I'll pull up what's connected to it.",
      sources: [],
    };
  }

  const lines = hits.map(({ item }) => {
    const owners = item.ownerIds.map((id) => getPerson(id)?.name.split(' ')[0]).filter(Boolean).join(', ');
    const status = item.status ? ` (${STATUS_WORDS[item.status]})` : '';
    const detail = item.summary ? `: ${item.summary}` : '';
    return `- **${item.title}**${status}${detail}${owners ? ` *Owner: ${owners}.*` : ''}`;
  });
  return {
    text: `${urdu ? 'Yeh mila:' : "Here's what I found:"}\n\n${lines.join('\n')}`,
    sources: hits.map((h) => h.item.id),
  };
}
