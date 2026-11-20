import type { AgentName } from './models.js';

const MAX_USER_INPUT_CHARS = 1_800;
const MAX_CONTEXT_CHARS = 1_200;
const MAX_COMPLETION_TOKENS = 3_200;

export interface AIRequestBudget {
  userInputLimit: number;
  contextLimit: number;
  completionBudget: number;
}

/**
 * Keep each provider request within the free-tier token budget without
 * truncating the record payload that a Research queue-review handoff needs.
 */
export function getAIRequestBudget(agent: AgentName, input: string): AIRequestBudget {
  const researchHeavyOutreach = agent === 'outreach' && input.includes('WEB RESEARCH RESULT');
  const queueOnlyResearch = agent === 'research'
    && /STANDING DUTY: Daily prospect queue intelligence|STANDING DUTY: Research department queue assessment/i.test(input);
  const queueRecordReview = agent === 'research'
    && /(?:reviewing one existing lead_discovery_queue record|re-assess this existing queue record)/i.test(input)
    && /Queue record ID:\s*[0-9a-f-]{36}\./i.test(input);
  const outreachProspectReview = agent === 'outreach'
    && /Review(?:ing)? this single researched Tambala prospect using the attached record/i.test(input)
    && /Queue record ID:\s*[0-9a-f-]{36}\./i.test(input);
  const handoffReview = agent === 'orchestrator'
    && input.includes('CEO REVIEW — you own acceptance of this delegated work.')
    && input.includes('EMPLOYEE DELIVERABLE:');
  const securityReview = agent === 'security'
    && input.includes('STANDING DUTY: Daily incident monitoring and security review');

  const recordReview = queueRecordReview || outreachProspectReview;

  return {
    userInputLimit: researchHeavyOutreach ? 5_500
      : queueOnlyResearch ? 1_800
      : recordReview ? 4_200
      : handoffReview ? 6_500
      : MAX_USER_INPUT_CHARS,
    // Queue-record payloads are passed separately as context_summary. A 700
    // character cap silently removed key evidence and contact fields, causing
    // agents to ask for records that were already attached. Keep enough room
    // for the compact JSON record while retaining the conservative default.
    contextLimit: researchHeavyOutreach ? 250
      : queueOnlyResearch ? 2_800
      : recordReview ? 2_800
      : handoffReview ? 300
      : securityReview ? 2_200
      : MAX_CONTEXT_CHARS,
    // These reviews should return concise decisions, not long reports. The
    // lower output cap leaves room for the record and system prompt on free
    // provider TPM limits.
    completionBudget: queueOnlyResearch ? 2_600
      : recordReview ? 1_800
      : handoffReview ? 700
      : agent === 'operations' ? 3_200
      : researchHeavyOutreach ? (input.includes('discovery pass') ? 1_200 : 1_600)
      : agent === 'research' ? 2_800
      : MAX_COMPLETION_TOKENS,
  };
}
