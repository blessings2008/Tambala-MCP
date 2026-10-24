import {
  createOrganizationTask,
  transitionTask,
  type OrganizationTask,
  type OrganizationTaskEvent,
} from './task-engine.js';

export interface TaskRunnerContext {
  specialist: string;
  ceoTitle?: string;
  departmentTitle: string;
}

/**
 * Coordinates the lifecycle transitions around an execution run.
 * AI/provider calls remain outside this module; this layer records who owns
 * each stage so the HTTP/UI layer can execute one stage at a time without
 * losing the organizational state machine.
 */
export class OrganizationTaskRunner {
  readonly task: OrganizationTask;

  constructor(objective: string, private readonly context: TaskRunnerContext) {
    this.task = createOrganizationTask(objective);
  }

  startCeoAnalysis(): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'ceo_analyzing',
      'Chief Executive Officer (CEO)',
      'CEO is analyzing the Founder objective and deciding what work must be delegated.',
      this.context.departmentTitle,
    );
  }

  delegate(message: string): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'delegated',
      'Chief Executive Officer (CEO)',
      message,
      this.context.departmentTitle,
      { specialist: this.context.specialist },
    );
  }

  startDepartment(): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'executing',
      this.context.departmentTitle,
      'Department is executing the delegated deliverable.',
      'Chief Executive Officer (CEO)',
    );
  }

  waitForResearch(query: string): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'waiting_for_tool',
      this.context.departmentTitle,
      `Department requested web research for: ${query}`,
      'Web Research',
      { tool: 'web_research', query },
    );
  }

  researchComplete(sourceCount?: number): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'tool_complete',
      'Web Research',
      sourceCount === undefined
        ? 'Web research returned evidence to the department.'
        : `Web research returned evidence from ${sourceCount} source(s).`,
      this.context.departmentTitle,
      { tool: 'web_research', sourceCount },
    );
  }

  resumeDepartment(): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'executing',
      this.context.departmentTitle,
      'Department resumed execution using the returned research evidence.',
      'Chief Executive Officer (CEO)',
    );
  }

  submitDepartmentWork(message: string): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'department_review',
      this.context.departmentTitle,
      message,
      'Chief Executive Officer (CEO)',
    );
  }

  returnToCeo(): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'returned_to_ceo',
      this.context.departmentTitle,
      'Department has submitted its completed work for CEO evaluation.',
      'Chief Executive Officer (CEO)',
    );
  }

  beginCeoReview(): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'ceo_review',
      'Chief Executive Officer (CEO)',
      'CEO is evaluating the completed department work against the original Founder objective.',
      'Founder / Bless',
    );
  }

  requestRework(reason: string): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'needs_more_work',
      'Chief Executive Officer (CEO)',
      reason,
      this.context.departmentTitle,
    );
  }

  complete(finalResult: string): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'completed',
      'Chief Executive Officer (CEO)',
      finalResult,
      'Founder / Bless',
    );
  }

  fail(message: string): OrganizationTaskEvent {
    return transitionTask(
      this.task,
      'failed',
      'Organization Task Runner',
      message,
      'Founder / Bless',
    );
  }
}
