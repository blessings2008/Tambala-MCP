import { AGENT_DIRECTORY, type AgentName } from '../../services/ai/models.js';
import { initialOrganization } from '../seed.js';
import { WORK_END, WORK_START, OFFICE_TZ } from './schedule.js';

export interface EmployeeProfile {
  agent: AgentName;
  employeeNumber: string;
  title: string;
  unitId: string;
  unitName: string;
  reportsTo: string;
  roleId: string;
  jobDescription: string;
  kpis: string[];
  hours: string;
}

/**
 * Employee numbers are frozen. They are an employee's permanent identity and the root of their signing key,
 * so they must never be reassigned or reordered. New hires get the next unused number.
 */
export const EMPLOYEE_NUMBERS: Record<AgentName, string> = {
  orchestrator: 'TT-001', outreach: 'TT-002', followup: 'TT-003', research: 'TT-004', marketing: 'TT-005', content: 'TT-006',
  finance: 'TT-007', payments: 'TT-008', engineering: 'TT-009', strategy: 'TT-010', product: 'TT-011', security: 'TT-012',
  operations: 'TT-013', people: 'TT-014', legal: 'TT-015', procurement: 'TT-016', executive: 'TT-017', rnd: 'TT-018', governance: 'TT-019',
};

const KPIS: Partial<Record<AgentName, string[]>> = {
  orchestrator: ['Daily briefing delivered every weekday', 'Founder objectives completed end to end', 'Delegations returned with usable work'],
  outreach: ['Outreach drafts prepared each weekday', 'Drafts approved by the Founder', 'Leads with a recorded next step'],
  followup: ['Due follow-ups with a draft prepared', 'Overdue follow-ups reduced week on week'],
  operations: ['Overdue and stale tasks flagged daily', 'Records with missing due dates reduced'],
  security: ['Daily audit review completed', 'Denied or unusual activity reported the same day'],
  finance: ['Weekly billing review completed', 'Records missing billing data identified'],
  research: ['Weekly scan delivered with source URLs', 'Findings labelled fact or inference'],
  marketing: ['Weekly focus delivered with measurable actions'],
  people: ['Weekly workforce review delivered', 'Roles without duties identified'],
  strategy: ['Weekly priorities delivered with reasons', 'Top risk named each week'],
};

/** The accountable lead of the agent's unit (business units use a different role naming than departments). The CEO is `ceo`. */
export function roleIdFor(agent: AgentName): string {
  if (agent === 'orchestrator') return 'ceo';
  const unitId = AGENT_DIRECTORY[agent].unitId;
  const unit = initialOrganization.units.find((u) => u.id === unitId);
  return unit?.accountableRoleIds[0] ?? `director-${unitId}`;
}

export function getEmployeeProfiles(): EmployeeProfile[] {
  return (Object.keys(AGENT_DIRECTORY) as AgentName[]).map((agent) => {
    const d = AGENT_DIRECTORY[agent];
    return {
      agent,
      employeeNumber: EMPLOYEE_NUMBERS[agent],
      title: d.title,
      unitId: d.unitId,
      unitName: d.unitName,
      reportsTo: d.reportsTo,
      roleId: roleIdFor(agent),
      jobDescription: d.responsibility,
      kpis: KPIS[agent] ?? [],
      hours: `Mon–Fri ${WORK_START}–${WORK_END} (${OFFICE_TZ})`,
    };
  });
}

export const FOUNDER_ID = 'founder';

/** The worker (or the Founder) behind a role id. */
export function identityForRole(roleId: string): { employeeNumber: string; title: string } | null {
  if (roleId === FOUNDER_ID) return { employeeNumber: 'TT-000', title: 'Founder' };
  const p = getEmployeeProfiles().find((x) => x.roleId === roleId);
  return p ? { employeeNumber: p.employeeNumber, title: p.title } : null;
}

export const labelForRole = (roleId: string): string => {
  const who = identityForRole(roleId);
  return who ? `${who.employeeNumber} ${who.title}` : roleId;
};
