import * as z from 'zod/v4';
import type { McpServer } from '@modelcontextprotocol/server';
import { supabaseInsert, supabaseSelect, supabaseUpdate } from '../lib/supabase.js';
import { resolveOrganizationIdentity } from '../organization/identity-service.js';
import { recordAudit } from '../organization/audit.js';

type Identity = Awaited<ReturnType<typeof resolveOrganizationIdentity>>;
type AuthenticatedIdentity = Extract<Identity, { authenticated: true; principalType: 'oauth' }>;
type Member = { role_id: string; seat_title: string; member_type: string; active: boolean; voting_rights?: boolean };
type Meeting = { id: string; meeting_number: number; title: string; meeting_type: string; status: string; scheduled_at: string | null; purpose: string };

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}
function required(value: string, label: string, max = 2000): string {
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > max) throw new Error(`${label} is required and must be no longer than ${max} characters.`);
  return cleaned;
}
async function identity(): Promise<AuthenticatedIdentity> {
  const actor = await resolveOrganizationIdentity();
  if (!actor.authenticated || actor.principalType !== 'oauth') throw new Error('A verified OAuth identity with an active organization role is required.');
  return actor;
}
async function requireRole(allowed: string[]): Promise<AuthenticatedIdentity> {
  const actor = await identity();
  if (!allowed.includes(actor.role.id)) throw new Error(`Role ${actor.role.id} is not authorized for this Board governance action.`);
  return actor;
}
async function activeBoardMember(roleId: string): Promise<Member> {
  const rows = await supabaseSelect<Member>('organization_board_members', `select=role_id,seat_title,member_type,active&role_id=eq.${encodeURIComponent(roleId)}&active=eq.true&limit=1`);
  if (!rows.length || !['founder_chair', 'advisory_member', 'board_secretary'].includes(rows[0].member_type)) throw new Error('Only the Founder, an appointed adviser or the Board Secretary may submit a Board recommendation. Executive observers may present reports but do not submit Board recommendations.');
  return rows[0];
}
async function audit(actor: AuthenticatedIdentity, action: string, targetId: string, reason: string): Promise<void> {
  await recordAudit({ actorRoleId: actor.role.id, action, targetType: 'board_governance', targetId, outcome: 'success', reason });
}

export function registerBoardGovernanceTools(server: McpServer): void {
  server.registerTool('get_board_governance_snapshot', {
    description: 'Read the internal AI Advisory Board register: appointed seats, meetings, agenda, recommendations, minutes and action tracking. Read-only.',
    inputSchema: { limit: z.number().int().min(1).max(50).optional().default(20) },
  }, async ({ limit }) => {
    const actor = await identity();
    const [members, meetings, recommendations, actions] = await Promise.all([
      supabaseSelect<Member>('organization_board_members', 'select=role_id,seat_title,member_type,active,voting_rights&order=created_at.asc'),
      supabaseSelect<Meeting>('organization_board_meetings', `select=id,meeting_number,title,meeting_type,status,scheduled_at,purpose,created_at&order=scheduled_at.desc.nullslast,created_at.desc&limit=${limit}`),
      supabaseSelect<Record<string, unknown>>('organization_board_recommendations', `select=id,meeting_id,title,recommendation,rationale,risk_level,status,proposed_by_role_id,founder_decision_note,founder_decided_at,created_at&order=created_at.desc&limit=${limit}`),
      supabaseSelect<Record<string, unknown>>('organization_board_actions', `select=id,meeting_id,recommendation_id,title,description,assigned_role_id,due_at,status,completion_evidence,created_at&order=due_at.asc.nullslast,created_at.desc&limit=${limit}`),
    ]);
    return result({ authority: 'The Board is advisory and non-voting. Only the Founder may decide recommendations or reserved matters.', viewerRole: actor.role.id, members, meetings, recommendations, actions });
  });

  server.registerTool('create_board_meeting', {
    description: 'Founder-only: create an ordinary, strategic review, special or inaugural AI Advisory Board meeting. The Founder is always chair.',
    inputSchema: {
      title: z.string().min(3).max(200),
      meetingType: z.enum(['ordinary', 'strategic_review', 'special', 'inaugural']).default('ordinary'),
      scheduledAt: z.string().optional(),
      purpose: z.string().max(2000).optional(),
    },
  }, async ({ title, meetingType, scheduledAt, purpose }) => {
    const actor = await requireRole(['founder']);
    if (scheduledAt && Number.isNaN(Date.parse(scheduledAt))) throw new Error('scheduledAt must be a valid ISO date/time.');
    const row = await supabaseInsert<Meeting>('organization_board_meetings', {
      title: required(title, 'Meeting title', 200), meeting_type: meetingType,
      scheduled_at: scheduledAt || null, purpose: purpose?.trim() ?? '',
      chair_role_id: 'founder', created_by_role_id: 'founder', secretary_role_id: 'director-board-governance',
    });
    const members = await supabaseSelect<Member>('organization_board_members', 'select=role_id,seat_title,member_type&active=eq.true');
    for (const member of members) {
      await supabaseInsert('organization_board_attendance', {
        meeting_id: row.id, role_id: member.role_id, seat_title: member.seat_title,
        attendance_status: member.role_id === 'founder' ? 'present' : 'invited',
      });
    }
    await audit(actor, 'board_meeting_created', row.id, 'Founder created a Board meeting.');
    return result({ meeting: row, invitedSeats: members.length, note: 'The Board remains advisory; this meeting creates no independent approval authority.' });
  });

  server.registerTool('add_board_agenda_item', {
    description: 'Founder or Board Secretary: add an agenda item to a scheduled or in-session meeting.',
    inputSchema: {
      meetingId: z.string().uuid(), title: z.string().min(3).max(200),
      background: z.string().max(4000).optional(), presenterRoleId: z.string().optional(),
    },
  }, async ({ meetingId, title, background, presenterRoleId }) => {
    const actor = await requireRole(['founder', 'director-board-governance']);
    const meetings = await supabaseSelect<Meeting>('organization_board_meetings', `select=id,status&id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!meetings.length || !['scheduled', 'in_session'].includes(meetings[0].status)) throw new Error('Meeting not found or no longer accepting agenda items.');
    const current = await supabaseSelect<{ item_number: number }>('organization_board_agenda_items', `select=item_number&meeting_id=eq.${encodeURIComponent(meetingId)}&order=item_number.desc&limit=1`);
    const row = await supabaseInsert('organization_board_agenda_items', {
      meeting_id: meetingId, item_number: (current[0]?.item_number ?? 0) + 1,
      title: required(title, 'Agenda title', 200), background: background?.trim() ?? '',
      presenter_role_id: presenterRoleId || null,
    });
    await audit(actor, 'board_agenda_item_added', String((row as { id?: string }).id ?? meetingId), 'Agenda item added.');
    return result({ agendaItem: row });
  });

  server.registerTool('submit_board_recommendation', {
    description: 'An appointed active Board adviser, Secretary, or Founder may submit a non-binding recommendation linked to a meeting. Submission never constitutes approval.',
    inputSchema: {
      meetingId: z.string().uuid(), agendaItemId: z.string().uuid().optional(),
      title: z.string().min(3).max(200), recommendation: z.string().min(5).max(4000),
      rationale: z.string().max(4000).optional(),
      riskLevel: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    },
  }, async ({ meetingId, agendaItemId, title, recommendation, rationale, riskLevel }) => {
    const actor = await identity();
    if (actor.role.id !== 'founder') await activeBoardMember(actor.role.id);
    const meetings = await supabaseSelect<Meeting>('organization_board_meetings', `select=id,status&id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!meetings.length || meetings[0].status === 'cancelled') throw new Error('A valid, non-cancelled meeting is required.');
    if (agendaItemId) {
      const agenda = await supabaseSelect<{ id: string }>('organization_board_agenda_items', `select=id&id=eq.${encodeURIComponent(agendaItemId)}&meeting_id=eq.${encodeURIComponent(meetingId)}&limit=1`);
      if (!agenda.length) throw new Error('Agenda item does not belong to the selected meeting.');
    }
    const row = await supabaseInsert('organization_board_recommendations', {
      meeting_id: meetingId, agenda_item_id: agendaItemId || null,
      title: required(title, 'Recommendation title', 200),
      recommendation: required(recommendation, 'Recommendation', 4000),
      rationale: rationale?.trim() ?? '', risk_level: riskLevel,
      status: 'submitted', proposed_by_role_id: actor.role.id,
    });
    await audit(actor, 'board_recommendation_submitted', String((row as { id?: string }).id ?? meetingId), 'Non-binding recommendation submitted for Founder review.');
    return result({ recommendation: row, status: 'submitted', binding: false, decisionAuthority: 'founder' });
  });

  server.registerTool('decide_board_recommendation', {
    description: 'Founder-only: accept, reject or defer a submitted Board recommendation. This is a Founder decision, never a Board vote.',
    inputSchema: {
      recommendationId: z.string().uuid(),
      decision: z.enum(['founder_accepted', 'founder_rejected', 'deferred']),
      note: z.string().max(4000).optional(),
    },
  }, async ({ recommendationId, decision, note }) => {
    const actor = await requireRole(['founder']);
    const rows = await supabaseSelect<{ id: string; status: string }>('organization_board_recommendations', `select=id,status&id=eq.${encodeURIComponent(recommendationId)}&limit=1`);
    if (!rows.length) throw new Error('Recommendation not found.');
    if (rows[0].status !== 'submitted') throw new Error('Only submitted recommendations can receive a Founder decision.');
    const updated = await supabaseUpdate('organization_board_recommendations', {
      status: decision, founder_decision_note: note?.trim() ?? null,
      founder_decided_at: new Date().toISOString(), founder_decided_by_role_id: 'founder',
    }, `id=eq.${encodeURIComponent(recommendationId)}&status=eq.submitted`);
    await audit(actor, 'board_recommendation_decided', recommendationId, `Founder recorded decision: ${decision}.`);
    return result({ recommendation: updated, decisionAuthority: 'founder' });
  });

  server.registerTool('record_board_minutes', {
    description: 'Board Secretary or Founder: create or update meeting minutes, discussion notes and evidence references. Founder confirmation is a separate action.',
    inputSchema: {
      meetingId: z.string().uuid(), summary: z.string().max(6000),
      discussionNotes: z.array(z.object({ topic: z.string().max(200), notes: z.string().max(3000) })).max(50).optional(),
      evidenceRefs: z.array(z.string().url().or(z.string().min(1).max(500))).max(50).optional(),
    },
  }, async ({ meetingId, summary, discussionNotes, evidenceRefs }) => {
    const actor = await requireRole(['founder', 'director-board-governance']);
    const meetings = await supabaseSelect<Meeting>('organization_board_meetings', `select=id,status&id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!meetings.length) throw new Error('Meeting not found.');
    const existing = await supabaseSelect<{ id: string }>('organization_board_minutes', `select=id&meeting_id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    const value = {
      meeting_id: meetingId, summary: summary.trim(),
      discussion_notes: discussionNotes ?? [], evidence_refs: evidenceRefs ?? [],
      prepared_by_role_id: actor.role.id,
      founder_confirmed_at: null, founder_confirmed_by_role_id: null,
    };
    const row = existing.length
      ? await supabaseUpdate('organization_board_minutes', value, `meeting_id=eq.${encodeURIComponent(meetingId)}`)
      : await supabaseInsert('organization_board_minutes', value);
    await audit(actor, 'board_minutes_recorded', meetingId, 'Meeting minutes saved; not yet Founder-confirmed.');
    return result({ minutes: row, founderConfirmationRequired: true });
  });

  server.registerTool('confirm_board_minutes', {
    description: 'Founder-only: confirm the official minutes for a Board meeting.',
    inputSchema: { meetingId: z.string().uuid() },
  }, async ({ meetingId }) => {
    const actor = await requireRole(['founder']);
    const rows = await supabaseSelect<{ id: string }>('organization_board_minutes', `select=id&meeting_id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!rows.length) throw new Error('Minutes must be recorded before Founder confirmation.');
    const updated = await supabaseUpdate('organization_board_minutes', {
      founder_confirmed_at: new Date().toISOString(), founder_confirmed_by_role_id: 'founder',
    }, `meeting_id=eq.${encodeURIComponent(meetingId)}`);
    await audit(actor, 'board_minutes_confirmed', meetingId, 'Founder confirmed the official minutes.');
    return result({ minutes: updated, confirmedBy: 'founder' });
  });

  server.registerTool('create_board_action', {
    description: 'Founder or Board Secretary: create a tracked follow-up action with an accountable organization role and optional due date.',
    inputSchema: {
      meetingId: z.string().uuid(), recommendationId: z.string().uuid().optional(),
      title: z.string().min(3).max(200), description: z.string().max(3000).optional(),
      assignedRoleId: z.string().min(2).max(100), dueAt: z.string().optional(),
    },
  }, async ({ meetingId, recommendationId, title, description, assignedRoleId, dueAt }) => {
    const actor = await requireRole(['founder', 'director-board-governance']);
    const meetings = await supabaseSelect<Meeting>('organization_board_meetings', `select=id&id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!meetings.length) throw new Error('Meeting not found.');
    const roleRows = await supabaseSelect<{ id: string; activation: string }>('organization_roles', `select=id,activation&id=eq.${encodeURIComponent(assignedRoleId)}&limit=1`);
    if (!roleRows.length || roleRows[0].activation !== 'active') throw new Error('Assign the action to an existing active organization role.');
    if (dueAt && Number.isNaN(Date.parse(dueAt))) throw new Error('dueAt must be a valid ISO date/time.');
    if (recommendationId) {
      const rec = await supabaseSelect<{ id: string; meeting_id: string }>('organization_board_recommendations', `select=id,meeting_id&id=eq.${encodeURIComponent(recommendationId)}&limit=1`);
      if (!rec.length || rec[0].meeting_id !== meetingId) throw new Error('Recommendation does not belong to this meeting.');
    }
    const row = await supabaseInsert('organization_board_actions', {
      meeting_id: meetingId, recommendation_id: recommendationId || null,
      title: required(title, 'Action title', 200), description: description?.trim() ?? '',
      assigned_role_id: assignedRoleId, due_at: dueAt || null,
    });
    await audit(actor, 'board_action_created', String((row as { id?: string }).id ?? meetingId), 'Board follow-up action assigned.');
    return result({ action: row });
  });

  server.registerTool('update_board_action_status', {
    description: 'Update an assigned Board follow-up action. The assigned role may report progress; Founder or Board Secretary may oversee. Only Founder or Secretary may mark an action cancelled.',
    inputSchema: {
      actionId: z.string().uuid(), status: z.enum(['open', 'in_progress', 'blocked', 'completed', 'cancelled']),
      completionEvidence: z.string().max(2000).optional(),
    },
  }, async ({ actionId, status, completionEvidence }) => {
    const actor = await identity();
    const rows = await supabaseSelect<{ id: string; assigned_role_id: string; status: string }>('organization_board_actions', `select=id,assigned_role_id,status&id=eq.${encodeURIComponent(actionId)}&limit=1`);
    if (!rows.length) throw new Error('Action not found.');
    const oversight = ['founder', 'director-board-governance'].includes(actor.role.id);
    if (!oversight && rows[0].assigned_role_id !== actor.role.id) throw new Error('Only the assigned role, Founder or Board Secretary may update this action.');
    if (status === 'cancelled' && !oversight) throw new Error('Only Founder or Board Secretary may cancel an action.');
    const transitions: Record<string, string[]> = { open: ['in_progress', 'blocked', 'cancelled'], in_progress: ['blocked', 'completed', 'cancelled'], blocked: ['in_progress', 'cancelled'], completed: [], cancelled: [] };
    if (!transitions[rows[0].status]?.includes(status)) throw new Error(`Cannot change an action from ${rows[0].status} to ${status}.`);
    if (status === 'completed' && !completionEvidence?.trim()) throw new Error('Completion evidence is required before marking an action completed.');
    const updated = await supabaseUpdate('organization_board_actions', {
      status, completion_evidence: status === 'completed' ? completionEvidence!.trim() : completionEvidence?.trim() || null,
    }, `id=eq.${encodeURIComponent(actionId)}`);
    await audit(actor, 'board_action_status_updated', actionId, `Action status changed to ${status}.`);
    return result({ action: updated });
  });

  server.registerTool('record_board_attendance', {
    description: 'Founder or Board Secretary: record attendance for an appointed Board member or an executive observer included in the Board membership register.',
    inputSchema: {
      meetingId: z.string().uuid(), roleId: z.string().min(2).max(100),
      attendanceStatus: z.enum(['present', 'absent', 'apology', 'observer']),
    },
  }, async ({ meetingId, roleId, attendanceStatus }) => {
    const actor = await requireRole(['founder', 'director-board-governance']);
    const meetings = await supabaseSelect<Meeting>('organization_board_meetings', `select=id,status&id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!meetings.length) throw new Error('Meeting not found.');
    const seats = await supabaseSelect<Member>('organization_board_members', `select=role_id,seat_title,member_type,active&role_id=eq.${encodeURIComponent(roleId)}&active=eq.true&limit=1`);
    const roles = seats;
    if (!roles.length) throw new Error('Attendance can only be recorded for an active appointed Board seat. Add executive observers through the membership register first.');
    const existing = await supabaseSelect<{ id: string }>('organization_board_attendance', `select=id&meeting_id=eq.${encodeURIComponent(meetingId)}&role_id=eq.${encodeURIComponent(roleId)}&limit=1`);
    const value = { attendance_status: attendanceStatus, recorded_at: new Date().toISOString() };
    const row = existing.length
      ? await supabaseUpdate('organization_board_attendance', value, `meeting_id=eq.${encodeURIComponent(meetingId)}&role_id=eq.${encodeURIComponent(roleId)}`)
      : await supabaseInsert('organization_board_attendance', { meeting_id: meetingId, role_id: roleId, seat_title: roles[0].seat_title, ...value });
    await audit(actor, 'board_attendance_recorded', meetingId, `Attendance recorded for ${roleId}: ${attendanceStatus}.`);
    return result({ attendance: row });
  });

  server.registerTool('update_board_meeting_status', {
    description: 'Founder-only: open or close a Board meeting. Closing a meeting records its close time; minutes remain a separate record requiring Founder confirmation.',
    inputSchema: { meetingId: z.string().uuid(), status: z.enum(['in_session', 'completed', 'cancelled']) },
  }, async ({ meetingId, status }) => {
    const actor = await requireRole(['founder']);
    const rows = await supabaseSelect<Meeting>('organization_board_meetings', `select=id,status&id=eq.${encodeURIComponent(meetingId)}&limit=1`);
    if (!rows.length) throw new Error('Meeting not found.');
    const transitions: Record<string, string[]> = {
      scheduled: ['in_session', 'cancelled'],
      in_session: ['completed', 'cancelled'],
    };
    if (!transitions[rows[0].status]?.includes(status)) throw new Error(`Cannot change a meeting from ${rows[0].status} to ${status}.`);
    const now = new Date().toISOString();
    const updated = await supabaseUpdate('organization_board_meetings', {
      status, opened_at: status === 'in_session' ? now : undefined,
      closed_at: ['completed', 'cancelled'].includes(status) ? now : null,
    }, `id=eq.${encodeURIComponent(meetingId)}`);
    await audit(actor, 'board_meeting_status_updated', meetingId, `Founder changed meeting status to ${status}.`);
    return result({ meeting: updated });
  });

}
