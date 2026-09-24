/**
 * @fileoverview Assembles the use-case handlers from dependencies.
 */

import {
  Advisor,
  ApproveRecommendation,
  CreateScenario,
  EvaluateOutcomes,
  GenerateRecommendation,
  GetLlmQuota,
  GetRecommendation,
  GetScenario,
  ListCandidateActions,
  ListRecommendations,
  ListScenarios,
  LlmGateway,
  ProcessDecisionJob,
  RejectRecommendation,
  RunScenario,
  Simulator,
  SubmitFeedback,
  SuggestMapping,
  type DecisionDeps,
} from '../application';

/** Every decision use case. */
export interface DecisionHandlers {
  createScenario: CreateScenario;
  listScenarios: ListScenarios;
  getScenario: GetScenario;
  runScenario: RunScenario;
  listCandidateActions: ListCandidateActions;
  generateRecommendation: GenerateRecommendation;
  processDecisionJob: ProcessDecisionJob;
  listRecommendations: ListRecommendations;
  getRecommendation: GetRecommendation;
  approve: ApproveRecommendation;
  reject: RejectRecommendation;
  feedback: SubmitFeedback;
  suggestMapping: SuggestMapping;
  llmQuota: GetLlmQuota;
  evaluateOutcomes: EvaluateOutcomes;
}

/** Builds the handlers. */
export function createHandlers(deps: DecisionDeps): DecisionHandlers {
  const simulator = new Simulator(deps.graph, deps.models, deps.clock);
  const gateway = new LlmGateway(
    deps.llm,
    deps.llmStore,
    deps.clock,
    {user: deps.config.userDailyLimit, tenant: deps.config.tenantDailyLimit},
    deps.logger,
  );
  const advisor = new Advisor(gateway);
  return {
    createScenario: new CreateScenario(deps),
    listScenarios: new ListScenarios(deps),
    getScenario: new GetScenario(deps),
    runScenario: new RunScenario(deps, simulator),
    listCandidateActions: new ListCandidateActions(simulator),
    generateRecommendation: new GenerateRecommendation(deps),
    processDecisionJob: new ProcessDecisionJob(deps, simulator, advisor),
    listRecommendations: new ListRecommendations(deps),
    getRecommendation: new GetRecommendation(deps),
    approve: new ApproveRecommendation(deps),
    reject: new RejectRecommendation(deps),
    feedback: new SubmitFeedback(deps),
    suggestMapping: new SuggestMapping(gateway),
    llmQuota: new GetLlmQuota(gateway),
    evaluateOutcomes: new EvaluateOutcomes(deps, simulator, gateway),
  };
}
