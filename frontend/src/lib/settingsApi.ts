import axios from 'axios';
import { api } from './api';

/**
 * Settings page API (/brain/settings). Every call here is Owner-only server-side.
 * Types mirror backend/app/schemas/{company,employee,onboarding}.py.
 */

/** backend/app/schemas/company.py MAX_COMPANY_CONTEXT */
export const MAX_COMPANY_CONTEXT = 4000;
export const MAX_ASSISTANT_NAME = 64;
export const MAX_TONE = 64;

export interface PersonaConfig {
  assistant_name: string;
  tone: string;
  company_context: string;
  glossary: Record<string, string>;
}

export interface CompanySettings {
  id: string;
  name: string;
  industry?: string | null;
  persona_config: PersonaConfig;
  escalation_after_days: number;
  max_chases: number;
  auto_approve_threshold: number;
  auto_send_internal_followups: boolean;
  slack_connected: boolean;
  slack_team_id?: string | null;
  knowledge_connected: boolean;
}

export interface CompanySettingsUpdate {
  name?: string;
  industry?: string;
  /** Replaced wholesale on the server — always send the full object. */
  persona_config?: PersonaConfig;
  escalation_after_days?: number;
  max_chases?: number;
  auto_approve_threshold?: number;
  auto_send_internal_followups?: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  role_title: string | null;
  slack_user_id: string | null;
  manager_id: string | null;
  department_id?: string | null;
  has_login: boolean;
  /** Only on the detail response, so filled in per member after the list loads. */
  email?: string | null;
}

export interface TeamMemberCreate {
  name: string;
  role_title?: string;
  email?: string;
  manager_id?: string;
}

/** Owner is not grantable from here (backend GRANTABLE_ROLES). */
export type LoginRole = 'member' | 'admin';

export interface LoginCreate {
  email: string;
  password: string;
  full_name?: string;
  role: LoginRole;
}

export interface BulkRow {
  name: string;
  role_title?: string;
  manager?: string;
  email?: string;
}

export interface BulkResult {
  created: TeamMember[];
  skipped: string[];
  warnings: { employee: string; message: string }[];
}

const PERSONA_DEFAULTS: PersonaConfig = { assistant_name: 'Sentinel', tone: 'direct', company_context: '', glossary: {} };

export async function getCompany(): Promise<CompanySettings> {
  const { data } = await api.get<CompanySettings>('/company');
  return { ...data, persona_config: { ...PERSONA_DEFAULTS, ...(data.persona_config ?? {}) } };
}

export async function updateCompany(payload: CompanySettingsUpdate): Promise<CompanySettings> {
  const { data } = await api.patch<CompanySettings>('/company', payload);
  return { ...data, persona_config: { ...PERSONA_DEFAULTS, ...(data.persona_config ?? {}) } };
}

export async function listMembers(): Promise<TeamMember[]> {
  const { data } = await api.get<{ items: TeamMember[]; total: number }>('/employees');
  return data.items;
}

export async function getMemberEmail(id: string): Promise<string | null> {
  const { data } = await api.get<{ email?: string | null }>(`/employees/${id}`);
  return data.email ?? null;
}

export async function createMember(payload: TeamMemberCreate): Promise<TeamMember> {
  const { data } = await api.post<TeamMember>('/employees', payload);
  return data;
}

export async function deleteMember(id: string): Promise<void> {
  await api.delete(`/employees/${id}`);
}

export async function createLogin(id: string, payload: LoginCreate): Promise<void> {
  await api.post(`/employees/${id}/login`, payload);
}

export async function bulkImport(rows: BulkRow[]): Promise<BulkResult> {
  const { data } = await api.post<BulkResult>('/onboarding/employees/bulk', { employees: rows });
  return data;
}

/** "Name, Role, Manager" per line. Blank lines are ignored; empty fields are omitted. */
export function parseBulk(text: string): BulkRow[] {
  return text
    .split('\n')
    .map((line) => line.split(',').map((p) => p.trim()))
    .filter((parts) => parts[0])
    .map(([name, role, manager]) => ({
      name,
      ...(role ? { role_title: role } : {}),
      ...(manager ? { manager } : {}),
    }));
}

/** The open task titles a 409 on delete carries, if any. */
export function conflictTasks(err: unknown): string[] {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return [];
  const details = (err.response.data as { details?: { tasks?: { title: string }[] } } | undefined)?.details;
  return (details?.tasks ?? []).map((t) => t.title);
}
