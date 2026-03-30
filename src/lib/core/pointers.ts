import { parseFrontmatter } from "./freshness";

export interface KeyFile {
  name: string;
  description: string;
}

export interface Dependencies {
  upstream: string[];
  downstream: string[];
  shared: string[];
}

export interface Pointers {
  scope: string;
  purpose: string;
  keyFiles: KeyFile[];
  dependencies: Dependencies;
  apiSurface: string[];
  tests: string[];
}

/** Extract structured pointers from CONTEXT.md content */
export function extractPointers(content: string, scope: string): Pointers {
  const { body } = parseFrontmatter(content);
  const lines = body.split("\n");

  const pointers: Pointers = {
    scope,
    purpose: "",
    keyFiles: [],
    dependencies: { upstream: [], downstream: [], shared: [] },
    apiSurface: [],
    tests: [],
  };

  let currentSection = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect section headers
    if (/^##\s+Purpose/i.test(trimmed)) {
      currentSection = "purpose";
      continue;
    }
    if (/^##\s+Key\s+Files/i.test(trimmed)) {
      currentSection = "keyfiles";
      continue;
    }
    if (/^##\s+Dependencies/i.test(trimmed)) {
      currentSection = "dependencies";
      continue;
    }
    if (/^##\s+API\s+Surface/i.test(trimmed)) {
      currentSection = "api";
      continue;
    }
    if (/^##\s+Tests?/i.test(trimmed)) {
      currentSection = "tests";
      continue;
    }
    // Any other h2 resets section
    if (/^##\s+/.test(trimmed)) {
      currentSection = "";
      continue;
    }

    // Skip blank lines for purpose extraction but not for other sections
    if (!trimmed) continue;

    // If no section detected yet and we hit a non-header non-blank line,
    // and purpose is still empty, treat first substantive paragraph as purpose
    if (!currentSection && !pointers.purpose && !trimmed.startsWith("#")) {
      pointers.purpose = trimmed;
      continue;
    }

    switch (currentSection) {
      case "purpose": {
        if (!pointers.purpose) {
          pointers.purpose = trimmed;
        }
        break;
      }

      case "keyfiles": {
        // Match: - filename — description  (em dash)
        // Also match: - `filename` — description
        const kfMatch = trimmed.match(/^-\s+`?([^`—–\-]+?)`?\s*[—–]\s*(.+)$/);
        if (kfMatch) {
          pointers.keyFiles.push({
            name: kfMatch[1].trim(),
            description: kfMatch[2].trim(),
          });
        }
        break;
      }

      case "dependencies": {
        // Match **Upstream:** / **Downstream:** / **Shared:** lines
        const upMatch = trimmed.match(/^\*?\*?-?\s*\*?\*?Upstream:\*?\*?\s*(.+)$/i);
        if (upMatch) {
          pointers.dependencies.upstream = parseDependencyList(upMatch[1]);
          break;
        }
        const downMatch = trimmed.match(/^\*?\*?-?\s*\*?\*?Downstream:\*?\*?\s*(.+)$/i);
        if (downMatch) {
          pointers.dependencies.downstream = parseDependencyList(downMatch[1]);
          break;
        }
        const sharedMatch = trimmed.match(/^\*?\*?-?\s*\*?\*?Shared:\*?\*?\s*(.+)$/i);
        if (sharedMatch) {
          pointers.dependencies.shared = parseDependencyList(sharedMatch[1]);
          break;
        }
        break;
      }

      case "api": {
        if (trimmed.startsWith("- ")) {
          pointers.apiSurface.push(trimmed.slice(2).trim());
        }
        break;
      }

      case "tests": {
        if (trimmed.startsWith("- ")) {
          pointers.tests.push(trimmed.slice(2).trim());
        }
        break;
      }
    }
  }

  return pointers;
}

/** Parse a comma-separated or inline dependency value */
function parseDependencyList(raw: string): string[] {
  const trimmed = raw.trim();
  if (/^none$/i.test(trimmed)) return [];
  // Split on commas, semicolons, or " and "
  return trimmed
    .split(/[,;]|\s+and\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Serialize pointers into a compact text block */
export function serializePointers(pointers: Pointers): string {
  const lines: string[] = [];

  lines.push(`[${pointers.scope}]`);

  if (pointers.purpose) {
    lines.push(`Purpose: ${pointers.purpose}`);
  }

  if (pointers.keyFiles.length > 0) {
    lines.push("Key Files:");
    for (const kf of pointers.keyFiles) {
      lines.push(`  ${kf.name} — ${kf.description}`);
    }
  }

  const deps = pointers.dependencies;
  if (deps.upstream.length || deps.downstream.length || deps.shared.length) {
    lines.push("Dependencies:");
    if (deps.upstream.length) lines.push(`  up: ${deps.upstream.join(", ")}`);
    if (deps.downstream.length) lines.push(`  down: ${deps.downstream.join(", ")}`);
    if (deps.shared.length) lines.push(`  shared: ${deps.shared.join(", ")}`);
  }

  if (pointers.apiSurface.length > 0) {
    lines.push("API Surface:");
    for (const api of pointers.apiSurface) {
      lines.push(`  ${api}`);
    }
  }

  if (pointers.tests.length > 0) {
    lines.push("Tests:");
    for (const t of pointers.tests) {
      lines.push(`  ${t}`);
    }
  }

  return lines.join("\n");
}
