import { askTambalaAI } from '../services/ai.js';
import { DEPARTMENT_CAPABILITIES } from './capability-registry.js';
import type { ObjectiveInterpretation } from './intelligence-engine.js';

export class ObjectiveInterpretationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObjectiveInterpretationError';
  }
}

/**
 * Ask the CEO model to interpret a natural-language request into a typed
 * outcome and explicit capability requirements. The model proposes intent;
 * this parser validates the shape and rejects invented capability IDs.
 */
export async function interpretFounderObjective(
  request: string,
  organizationContext: unknown,
): Promise<ObjectiveInterpretation> {
  const originalRequest = request.trim();
  if (!originalRequest) throw new ObjectiveInterpretationError('The Founder request is empty.');

  const capabilityCatalog = DEPARTMENT_CAPABILITIES.map((capability) => ({
    id: capability.id,
    description: capability.description,
    examples: capability.objectiveKeywords.slice(0, 8),
  }));

  const prompt = [
    'You are the CEO of Tambala Technologies. Interpret the Founder request as an organisational outcome, not as a fixed command phrase.',
    'Do not execute the task or write the deliverable. Determine what success means and which organisational capabilities are genuinely required.',
    'Consider cross-functional requirements. Include multiple capabilities when the outcome genuinely requires them; do not force every request into one department.',
    'Select capability IDs only from the supplied catalogue. Never invent a department, employee, tool, capability, permission or fact.',
    'Distinguish a desired outcome from a suggested method. Preserve explicit constraints. Make only low-risk assumptions and label them. Ask questions only when missing information materially changes scope, risk or correctness.',
    'Do not ask obvious scoping questions when company context provides a safe default.',
    'Return ONLY one JSON object with exactly these fields: desiredOutcome (string), successDescription (string), requiredCapabilityIds (array of strings), assumptions (array of strings), unresolvedQuestions (array of strings), constraints (array of strings).',
    'Use concise values. Return 1–8 capability IDs. If no existing capability fits, return an empty array and explain the gap in unresolvedQuestions. Do not return markdown fences or prose outside JSON.',
    'AUTHORITATIVE ORGANISATION CONTEXT:',
    JSON.stringify(organizationContext).slice(0, 7000),
    'AVAILABLE CAPABILITY CATALOGUE:',
    JSON.stringify(capabilityCatalog),
    'FOUNDER REQUEST:',
    originalRequest,
  ].join('\n\n');

  const response = await askTambalaAI('orchestrator', prompt, {
    communicationType: 'CEO objective interpretation',
    sender: 'Founder / Bless',
    recipient: 'Chief Executive Officer (CEO)',
  });

  return parseObjectiveInterpretation(response, originalRequest);
}

/** Strict, provider-independent parser for the CEO's structured interpretation. */
export function parseObjectiveInterpretation(
  response: string,
  originalRequest: string,
): ObjectiveInterpretation {
  const json = extractJsonObject(response);
  if (!json) throw new ObjectiveInterpretationError('The CEO did not return a valid JSON interpretation.');

  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ObjectiveInterpretationError('The CEO returned malformed JSON; no task was routed.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ObjectiveInterpretationError('The CEO interpretation must be a JSON object.');
  }

  const record = value as Record<string, unknown>;
  const desiredOutcome = readString(record.desiredOutcome, 'desiredOutcome', 600);
  const successDescription = readString(record.successDescription, 'successDescription', 800);
  const requiredCapabilityIds = readStringArray(record.requiredCapabilityIds, 'requiredCapabilityIds', 8, 100);
  const assumptions = readStringArray(record.assumptions, 'assumptions', 12, 500);
  const unresolvedQuestions = readStringArray(record.unresolvedQuestions, 'unresolvedQuestions', 8, 500);
  const constraints = readStringArray(record.constraints, 'constraints', 16, 500);

  const known = new Set(DEPARTMENT_CAPABILITIES.map((capability) => capability.id));
  const unknown = requiredCapabilityIds.filter((id) => !known.has(id));
  if (unknown.length) {
    throw new ObjectiveInterpretationError(`The CEO proposed unknown capability IDs: ${unknown.join(', ')}. No task was routed.`);
  }
  if (new Set(requiredCapabilityIds).size !== requiredCapabilityIds.length) {
    throw new ObjectiveInterpretationError('The CEO returned duplicate capability IDs.');
  }
  if (!requiredCapabilityIds.length && !unresolvedQuestions.length) {
    throw new ObjectiveInterpretationError('The CEO identified no capability and did not explain the gap.');
  }

  return {
    originalRequest: originalRequest.trim(),
    desiredOutcome,
    successDescription,
    requiredCapabilityIds,
    assumptions,
    unresolvedQuestions,
    constraints,
  };
}

function extractJsonObject(response: string): string | null {
  const text = response.trim().replace(/^\uFEFF/, '').replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/i, '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function readString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ObjectiveInterpretationError(`The CEO interpretation is missing ${field}.`);
  }
  return value.trim().slice(0, maxLength);
}

function readStringArray(value: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value) || value.length > maxItems || value.some((item) => typeof item !== 'string')) {
    throw new ObjectiveInterpretationError(`The CEO interpretation contains an invalid ${field} list.`);
  }
  return value.map((item) => (item as string).trim().slice(0, maxLength)).filter(Boolean);
}
