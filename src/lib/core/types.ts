import { z } from "zod";

// Hierarchy roles
export type Role = "headmaster" | "dean" | "chair" | "professor" | "assistant-professor" | "head-pupil" | "pupil";

// A node in the hierarchy, resolved from CONTEXT.md files
export interface HierarchyNode {
  role: Role;
  scope: string;        // e.g. "services/backend/pipelines/eob"
  contextPath: string;  // absolute path to CONTEXT.md
  children: string[];   // child scope paths
}

// What a build agent asks for
export interface ContextRequest {
  query: string;
  intent: "read" | "write";
  knownPaths?: string[];  // if set and single file, bypass
  code?: string;          // for write intent
}

// A file snippet in a context response
export interface FileContext {
  path: string;
  relevantLines?: [number, number];
  snippet: string;
  why: string;
}

// Type definition in a context response
export interface TypeContext {
  path: string;
  snippet: string;
}

// Test info in a context response
export interface TestContext {
  location: string;
  pattern: string;
}

// Staleness info included in responses
export interface StalenessWarning {
  scope: string;
  severity: "minor" | "major";
  detail: string;  // e.g. "2 commits behind, 1 day old"
}

// The structured response from Contextador
export interface ContextResponse {
  query: string;
  routedTo: string;      // e.g. "professor:pipelines/eob"
  staleWarnings: StalenessWarning[];
  context: {
    files: FileContext[];
    types: TypeContext[];
    dependencies: string[];
    apiSurface: string[];
    tests: TestContext | null;
    contextChain: string[];
  };
}

// The structured response for writes
export interface WriteResponse {
  action: "write";
  coordinatedBy: string;  // e.g. "chair:backend"
  changes: { path: string; status: "created" | "updated" }[];
  docsUpdated: string[];
}

// Result from a subagent at any level
export interface SubagentResult {
  role: Role;
  scope: string;
  files: FileContext[];
  types: TypeContext[];
  dependencies: string[];
  apiSurface: string[];
  tests: TestContext | null;
}

// Tool definition interface (standalone)
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodObject<any>;
  execute: (args: any) => Promise<string>;
}

// Zod schema for the context tool parameter
export const contextRequestSchema = z.object({
  query: z.string().describe("What context do you need from the codebase?"),
  intent: z.enum(["read", "write"]).default("read"),
  knownPaths: z.array(z.string()).optional(),
  code: z.string().optional(),
});

export interface HierarchyConfig {
  maxDepth: number;
  roleMap: Record<number, Role>;
}

export const ALL_ROLES: Role[] = [
  "headmaster", "dean", "chair", "professor",
  "assistant-professor", "head-pupil", "pupil"
];
