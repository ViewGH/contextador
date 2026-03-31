// Core
export { findContextFiles, readContextFile, buildHierarchy, lowestCommonAncestor, computeRoleMap, buildHierarchyConfig } from "./core/hierarchy";
export { checkFreshness, stampContextFile, parseFrontmatter, buildFrontmatter } from "./core/freshness";
export { extractPointers, serializePointers } from "./core/pointers";
export { validateContext } from "./core/validation";
export { hashKeywords, recordHit, pruneHitLog, hasHit } from "./core/hitlog";
export { runJanitor, processRepairQueue, freshnessSweep, detectNewScopes, dependencyScan } from "./core/janitor";
export { generateBriefing } from "./core/briefing";
export { processFeedback, recordSuccess } from "./core/feedback";
export { planWrite, buildWriteResponse } from "./core/writer";
export { mergeResults, buildContextResponse, serializeResponse } from "./core/response";
export { detectImports, matchImportsToScopes, scanScopeDependencies, scanAllDependencies } from "./core/depscan";
export { shouldUseContextador, countCodeFiles } from "./core/sizecheck";
export { loadConfig, saveConfig, getDefaults } from "./core/projectconfig";
export { demolish, isContextadorGenerated } from "./core/demolish";
export { generateContextContent, summarizeDirectory } from "./core/generator";
export { loadStats, saveStats, recordQuery, recordFeedback, recordInit, recordSweep, estimateTokensSaved, formatStats } from "./core/stats";

// Providers
export { detectProvider, configure, getConfig, getModel, createClient, testConnection } from "./providers/config";

// Mainframe
export { MainframeBridge } from "./mainframe/bridge";
export { MatrixClient } from "./mainframe/client";
export { BudgetTracker } from "./mainframe/budget";
export { buildBroadcast, buildRequest, parseBroadcast, isBroadcast, isRequest } from "./mainframe/rooms";
export { findMatchingBroadcast } from "./mainframe/dedup";
export { buildSummary, serializeSummary, summarizeIfNeeded } from "./mainframe/summarizer";

// GitHub
export { startWebhookServer, getWebhookDefaults, getWebhookEvents } from "./github/webhook";
export { triagePush, triageScope, extractChangedFiles, filterTrivialFiles, mapFilesToScopes } from "./github/triage";

// Setup
export { runSetup, loadGlobalConfig } from "./setup/wizard";

// Types
export type * from "./core/types";
export type { GitHubPushPayload, WebhookConfig, TriageResult, WebhookEvent } from "./github/types";
