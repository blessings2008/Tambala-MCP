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
    && /Queue record ID:\\s*[0-9a-f-]{36}\\./i.test(input);
  const securityReview = agent === 'security'
    && input.includes('STANDING DUTY: Daily incident monitoring and security review');

  return {
    userInputLimit: researchHeavyOutreach ? 5_500
      : queueOnlyResearch ? 1_800
      : queueRecordReview ? 4_200
      : MAX_USER_INPUT_CHARS,
    contextLimit: researchHeavyOutreach ? 250
      : queueOnlyResearch ? 2_800
      : queueRecordReview ? 700
      : securityReview ? 2_200
      : MAX_CONTEXT_CHARS,
    completionBudget: queueOnlyResearch ? 2_600
      : agent === 'operations' ? 3_200
      : researchHeavyOutreach ? (input.includes('discovery pass') ? 1_200 : 1_600)
      : agent === 'research' ? 2_800
      : MAX_COMPLETION_TOKENS,
  };
}
