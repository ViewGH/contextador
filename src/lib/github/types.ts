/**
 * GitHub webhook payload types — push events only.
 * We keep this minimal: just what triage needs.
 */

export interface GitHubPushPayload {
  ref: string; // e.g. "refs/heads/main"
  before: string; // commit SHA before push
  after: string; // commit SHA after push
  repository: {
    full_name: string; // e.g. "PatientPassLLC/contextador"
    name: string;
    default_branch: string;
  };
  commits: GitHubCommit[];
  head_commit: GitHubCommit | null;
  pusher: { name: string; email: string };
  forced: boolean;
}

export interface GitHubCommit {
  id: string;
  message: string;
  timestamp: string;
  added: string[];
  removed: string[];
  modified: string[];
}

export interface WebhookConfig {
  enabled: boolean;
  port: number;
  secret: string; // HMAC secret for verifying GitHub signatures
  branches: string[]; // branches to watch (e.g. ["main", "master"])
}

export interface TriageResult {
  shouldUpdate: boolean;
  reason: string;
  affectedScopes: string[];
  diffSummary: string;
  filesChanged: number;
  linesChanged: number;
}

export interface WebhookEvent {
  receivedAt: string;
  repo: string;
  branch: string;
  commits: number;
  triage: TriageResult;
  swept: boolean;
}
