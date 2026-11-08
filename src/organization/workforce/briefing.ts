/** Deterministic briefing used when the CEO's model is unavailable, so the Founder still gets a real, honest report. */
export function deterministicBriefing(context: Record<string, unknown>): string | null {
  const b = context.briefing as undefined | {
    date: string;
    handoffs?: { from: string; to: string; request: string; status: string; result: string | null }[];
    duties: { title: string; owner: string; status: string; summary: string | null; error: string | null }[];
    pendingApprovals: { summary: string; requestedBy: string; risk: string }[];
    failedTasks: { objective: string; error: string | null }[];
  };
  if (!b) return null;
  const lines: string[] = [`Daily briefing for ${b.date} (compiled without a model).`, ''];
  lines.push(`Decisions needed: ${b.pendingApprovals.length ? '' : 'none pending.'}`);
  for (const a of b.pendingApprovals) lines.push(`- ${a.summary} (from ${a.requestedBy}, risk ${a.risk})`);
  lines.push('', 'Department updates:');
  if (!b.duties.length) lines.push('- No standing duties have run today.');
  for (const d of b.duties) {
    const detail = d.status === 'skipped' || d.status === 'failed' ? (d.error ?? '') : (d.summary ?? '').replace(/\s+/g, ' ').slice(0, 220);
    lines.push(`- ${d.owner} — ${d.title}: ${d.status.replaceAll('_', ' ')}${detail ? `. ${detail}` : ''}`);
  }
  if (b.handoffs?.length) {
    lines.push('', 'Work handed between staff:');
    for (const h of b.handoffs) lines.push(`- ${h.from} → ${h.to}: ${h.request.slice(0, 120)} [${h.status}]${h.result ? `. ${h.result.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`);
  }
  if (b.failedTasks.length) { lines.push('', 'Problems:'); for (const t of b.failedTasks) lines.push(`- ${t.objective.slice(0, 100)}: ${t.error ?? 'failed'}`); }
  return lines.join('\n');
}
