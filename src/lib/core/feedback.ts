import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { parseFrontmatter } from "./freshness";

export type FeedbackType = "missing_context" | "build_failure" | "wrong_location";

export interface Feedback {
  type: FeedbackType;
  scope: string;
  missingFiles?: string[];
  detail?: string;
}

interface RepairEntry {
  scope: string;
  reason: string;
  addedAt?: string;
}

/**
 * Increment (or insert) a numeric frontmatter field in CONTEXT.md content.
 * Returns the updated full content string.
 */
function incrementFrontmatterField(content: string, field: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!fmMatch) {
    // No frontmatter — create one with just this field
    return `---\n${field}: 1\n---\n${content}`;
  }

  const fmBlock = fmMatch[1];
  const body = fmMatch[2];
  const fieldRegex = new RegExp(`^(${field}:\\s*)(\\d+)`, "m");
  const fieldMatch = fmBlock.match(fieldRegex);

  let newFmBlock: string;
  if (fieldMatch) {
    const current = parseInt(fieldMatch[2], 10);
    newFmBlock = fmBlock.replace(fieldRegex, `${field}: ${current + 1}`);
  } else {
    // Field doesn't exist yet — append it
    newFmBlock = fmBlock + `\n${field}: 1`;
  }

  return `---\n${newFmBlock}\n---\n${body}`;
}

/**
 * Add missing files to the Key Files section of CONTEXT.md content.
 * If no Key Files section exists, appends one.
 */
function addToKeyFiles(content: string, files: string[]): string {
  const additions = files.map(f => `- \`${f}\``).join("\n");

  // Look for existing Key Files section
  const keyFilesRegex = /^(## Key Files\s*\n)([\s\S]*?)(?=\n##|\n*$)/m;
  const match = content.match(keyFilesRegex);

  if (match) {
    const existingSection = match[2].trimEnd();
    const newSection = existingSection + "\n" + additions;
    return content.replace(keyFilesRegex, `$1${newSection}\n`);
  }

  // No Key Files section — append one
  return content.trimEnd() + `\n\n## Key Files\n${additions}\n`;
}

/**
 * Append an entry to .contextador/repair-queue.json.
 */
async function addToRepairQueue(root: string, scope: string, reason: string): Promise<void> {
  const ctxDir = join(root, ".contextador");
  await mkdir(ctxDir, { recursive: true });
  const queuePath = join(ctxDir, "repair-queue.json");

  let queue: RepairEntry[] = [];
  try {
    const raw = await readFile(queuePath, "utf-8");
    queue = JSON.parse(raw);
    if (!Array.isArray(queue)) queue = [];
  } catch {
    queue = [];
  }

  // Don't duplicate
  if (!queue.some(e => e.scope === scope && e.reason === reason)) {
    queue.push({
      scope,
      reason,
      addedAt: new Date().toISOString().split("T")[0],
    });
  }

  await writeFile(queuePath, JSON.stringify(queue, null, 2), "utf-8");
}

/**
 * Process feedback from an agent about context accuracy.
 *
 * - missing_context: immediately adds missingFiles to Key Files, increments feedback_failures
 * - build_failure: increments feedback_failures, queues for janitor repair
 * - wrong_location: increments feedback_failures, queues for janitor repair
 */
export async function processFeedback(root: string, feedback: Feedback): Promise<void> {
  const contextPath = join(root, feedback.scope, "CONTEXT.md");

  let content: string;
  try {
    content = await readFile(contextPath, "utf-8");
  } catch {
    // CONTEXT.md doesn't exist — nothing to patch
    // Still queue for repair so janitor can create it
    await addToRepairQueue(root, feedback.scope, `${feedback.type}: ${feedback.detail || "no detail"}`);
    return;
  }

  // Always increment feedback_failures
  content = incrementFrontmatterField(content, "feedback_failures");

  switch (feedback.type) {
    case "missing_context": {
      if (feedback.missingFiles && feedback.missingFiles.length > 0) {
        content = addToKeyFiles(content, feedback.missingFiles);
      }
      await writeFile(contextPath, content, "utf-8");
      break;
    }

    case "build_failure": {
      await writeFile(contextPath, content, "utf-8");
      await addToRepairQueue(root, feedback.scope, `build_failure: ${feedback.detail || "unknown"}`);
      break;
    }

    case "wrong_location": {
      await writeFile(contextPath, content, "utf-8");
      await addToRepairQueue(root, feedback.scope, `wrong_location: ${feedback.detail || "unknown"}`);
      break;
    }
  }
}

/**
 * Record a successful context usage. Increments feedback_successes in frontmatter.
 */
export async function recordSuccess(root: string, scope: string): Promise<void> {
  const contextPath = join(root, scope, "CONTEXT.md");

  let content: string;
  try {
    content = await readFile(contextPath, "utf-8");
  } catch {
    return; // Nothing to stamp
  }

  content = incrementFrontmatterField(content, "feedback_successes");
  await writeFile(contextPath, content, "utf-8");
}
