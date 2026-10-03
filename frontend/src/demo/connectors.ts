/**
 * The connector catalogue for the demo gallery (#10). Contract from the issue —
 * the production `GET /api/v1/connectors` (#11) returns this same shape.
 *
 * Logos are bundled in /public/connectors (generated from simple-icons, CC0) so
 * nothing is fetched on stage. Brands simple-icons doesn't carry (Slack,
 * Microsoft, …) get a monogram tile in their brand colour instead.
 *
 * "connected" matches the sources the demo data actually cites, so the gallery
 * and the overview's "where this memory came from" never disagree.
 */

export type ConnectorCategory =
  | 'google' | 'microsoft' | 'communication' | 'work' | 'meetings'
  | 'engineering' | 'crm' | 'support';

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  description: string;
  /** /connectors/<id>.svg when a bundled logo exists; otherwise a monogram is drawn. */
  logo?: string;
  /** Brand colour — monogram tile, accents. */
  color: string;
  auth: 'oauth2' | 'api_key' | 'qr';
  scopes: string[];
  syncs: string[];
  status: 'connected' | 'available' | 'coming_soon';
  featured?: boolean;
  /** For the sync animation: what is being counted, and how many. */
  syncUnit?: string;
  syncCount?: number;
}

export const CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  google: 'Google Workspace',
  microsoft: 'Microsoft 365',
  communication: 'Communication',
  work: 'Work management',
  meetings: 'Meetings & notes',
  engineering: 'Engineering',
  crm: 'CRM & sales',
  support: 'Support',
};

const LOGOS = new Set([
  'gmail', 'google_drive', 'google_docs', 'google_sheets', 'google_calendar', 'google_meet', 'whatsapp', 'discord',
  'telegram', 'intercom', 'clickup', 'asana', 'jira', 'notion', 'linear', 'trello', 'basecamp', 'confluence', 'zoom',
  'fathom', 'loom', 'github', 'gitlab', 'bitbucket', 'sentry', 'vercel', 'hubspot', 'zoho_crm', 'quickbooks', 'xero',
  'stripe', 'paypal', 'dropbox', 'box', 'airtable', 'figma', 'miro', 'zendesk',
]);

type Row = [
  id: string, name: string, category: ConnectorCategory, color: string, description: string,
  syncs: string[], extra?: Partial<Connector>,
];

const ROWS: Row[] = [
  // Google Workspace
  ['gmail', 'Gmail', 'google', '#EA4335', 'Every client thread, linked to the people and deals it is about.', ['Emails', 'Threads', 'Attachments'], { status: 'connected', featured: true, syncUnit: 'emails', syncCount: 12840 }],
  ['google_calendar', 'Google Calendar', 'google', '#4285F4', 'Meetings, attendees and agendas, so every call has context.', ['Events', 'Attendees'], { status: 'connected', featured: true, syncUnit: 'events', syncCount: 2310 }],
  ['google_drive', 'Google Drive', 'google', '#4285F4', 'Contracts, SOWs and proposals, searchable by what they say.', ['Files', 'Folders', 'Sharing'], { status: 'connected', syncUnit: 'files', syncCount: 4120 }],
  ['google_docs', 'Google Docs', 'google', '#4285F4', 'Plans, PRDs and meeting notes as living knowledge.', ['Documents', 'Comments'], { status: 'connected', syncUnit: 'documents', syncCount: 1870 }],
  ['google_sheets', 'Google Sheets', 'google', '#34A853', 'Trackers and forecasts the team actually maintains.', ['Spreadsheets'], { syncUnit: 'sheets', syncCount: 640 }],


  // Microsoft 365
  ['outlook', 'Outlook', 'microsoft', '#0078D4', 'Email and calendar for teams on Microsoft 365.', ['Emails', 'Events']],
  ['teams', 'Microsoft Teams', 'microsoft', '#6264A7', 'Channels, chats and meeting transcripts.', ['Messages', 'Meetings']],
  ['onedrive', 'OneDrive', 'microsoft', '#0078D4', 'Files across personal and shared drives.', ['Files']],
  ['sharepoint', 'SharePoint', 'microsoft', '#038387', 'Intranet sites and document libraries.', ['Sites', 'Documents'], { status: 'coming_soon' }],

  // Communication
  ['slack', 'Slack', 'communication', '#4A154B', 'Channels and threads where decisions actually get made.', ['Messages', 'Threads', 'Files'], { status: 'connected', featured: true, syncUnit: 'messages', syncCount: 48230 }],
  ['whatsapp', 'WhatsApp Business', 'communication', '#25D366', 'Client conversations from your business number, with approval before replies.', ['Chats', 'Media'], { status: 'connected', featured: true, auth: 'qr', syncUnit: 'messages', syncCount: 9120 }],
  
  ['clickup', 'ClickUp', 'work', '#7B68EE', 'Tasks, owners and due dates, kept in sync with what was promised.', ['Tasks', 'Comments', 'Docs'], { status: 'connected', featured: true, syncUnit: 'tasks', syncCount: 3420 }],
  ['jira', 'Jira', 'work', '#0052CC', 'Issues, sprints and blockers across every client build.', ['Issues', 'Sprints', 'Comments'], { status: 'connected', syncUnit: 'issues', syncCount: 7810 }],
  ['linear', 'Linear', 'work', '#5E6AD2', 'Issues and cycles for product teams.', ['Issues', 'Cycles'], { status: 'connected', syncUnit: 'issues', syncCount: 1240 }],
  ['notion', 'Notion', 'work', '#000000', 'Wikis, specs and runbooks, read as the source of truth.', ['Pages', 'Databases'], { status: 'connected', syncUnit: 'pages', syncCount: 2650 }],
  ['asana', 'Asana', 'work', '#F06A6A', 'Projects, tasks and portfolios.', ['Tasks', 'Projects']],
  ['trello', 'Trello', 'work', '#0052CC', 'Boards and cards.', ['Cards', 'Boards']],
  ['monday', 'monday.com', 'work', '#FF3D57', 'Boards, items and updates.', ['Items', 'Updates']],

  // Meetings & notes
  ['fireflies', 'Fireflies', 'meetings', '#7C3AED', 'AI meeting notes, decisions and action items.', ['Transcripts', 'Summaries'], { status: 'connected', featured: true, auth: 'api_key', syncUnit: 'meetings', syncCount: 860 }],
  ['otter', 'Otter', 'meetings', '#3C84F5', 'Live transcripts and meeting summaries.', ['Transcripts'], { status: 'connected', auth: 'api_key', syncUnit: 'meetings', syncCount: 410 }],
  ['fathom', 'Fathom', 'meetings', '#9187FF', 'Call recordings with highlights.', ['Recordings', 'Highlights'], { status: 'connected', auth: 'api_key', syncUnit: 'meetings', syncCount: 290 }],


  // Engineering
  ['github', 'GitHub', 'engineering', '#181717', 'Pull requests, reviews and releases linked to the work they ship.', ['Pull requests', 'Issues', 'Releases'], { status: 'connected', syncUnit: 'pull requests', syncCount: 5320 }],
  ['gitlab', 'GitLab', 'engineering', '#FC6D26', 'Merge requests and pipelines.', ['Merge requests', 'Issues']],
  ['bitbucket', 'Bitbucket', 'engineering', '#0052CC', 'Repositories and pull requests.', ['Pull requests']],
  ['vercel', 'Vercel', 'engineering', '#000000', 'Deployments and preview links.', ['Deployments']],

  // CRM & sales
  ['hubspot', 'HubSpot', 'crm', '#FF7A59', 'Clients, deals and renewals, with every touchpoint attached.', ['Companies', 'Deals', 'Contacts'], { status: 'connected', featured: true, syncUnit: 'records', syncCount: 6240 }],
  ['salesforce', 'Salesforce', 'crm', '#00A1E0', 'Accounts, opportunities and activity.', ['Accounts', 'Opportunities']],
  ['pipedrive', 'Pipedrive', 'crm', '#017737', 'Deals and pipeline stages.', ['Deals', 'Activities']],
  ['zoho_crm', 'Zoho CRM', 'crm', '#E42527', 'Leads, accounts and deals.', ['Leads', 'Deals']],
  ['apollo', 'Apollo.io', 'crm', '#1C1C1C', 'Prospects and outreach sequences.', ['Contacts', 'Sequences'], { auth: 'api_key' }],


  // Support
  ['zendesk', 'Zendesk', 'support', '#03363D', 'Tickets and SLAs, so support issues reach the account owner.', ['Tickets', 'Users']],
  ['freshdesk', 'Freshdesk', 'support', '#25C16F', 'Tickets and customer replies.', ['Tickets']],
];

const SCOPES: Record<Connector['auth'], string[]> = {
  oauth2: ['Read-only access to your workspace', 'See who created and owns each item', 'No permission to send or delete'],
  api_key: ['Read-only API key', 'Pulls transcripts and summaries on a schedule'],
  qr: ['Linked-device access to your business number', 'Read messages; replies need human approval'],
};

export const CONNECTORS: Connector[] = ROWS.map(([id, name, category, color, description, syncs, extra = {}]) => {
  const auth = extra.auth ?? 'oauth2';
  return {
    id, name, category, color, description, syncs, auth,
    logo: LOGOS.has(id) ? `/connectors/${id}.svg` : undefined,
    scopes: SCOPES[auth],
    status: 'available',
    syncUnit: syncs[0].toLowerCase(),
    syncCount: 1000 + ((id.length * 7919) % 9000),
    ...extra,
  };
});

export const getConnector = (id: string) => CONNECTORS.find((c) => c.id === id);
