import { readFile } from "fs/promises";
import { join, relative, dirname, sep } from "path";
import { Glob } from "bun";
import type { HierarchyNode, HierarchyConfig, Role } from "./types";

export async function findContextFiles(root: string): Promise<string[]> {
  const glob = new Glob("**/CONTEXT.md");
  const results: string[] = [];
  for await (const path of glob.scan({ cwd: root, absolute: true })) {
    results.push(path);
  }
  return results.sort();
}

export async function readContextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

function roleForDepth(depth: number): Role {
  if (depth === 0) return "headmaster";
  if (depth === 1) return "dean";
  if (depth === 2) return "chair";
  if (depth === 3) return "professor";
  return "pupil";
}

export function computeRoleMap(maxDepth: number): Record<number, Role> {
  const map: Record<number, Role> = {};
  if (maxDepth <= 2) {
    map[0] = "headmaster";
    if (maxDepth >= 1) map[1] = "professor";
    if (maxDepth >= 2) map[2] = "pupil";
  } else if (maxDepth <= 4) {
    const roles: Role[] = ["headmaster", "dean", "chair", "professor", "pupil"];
    for (let i = 0; i <= maxDepth; i++) {
      map[i] = roles[Math.min(i, roles.length - 1)];
    }
  } else {
    const roles: Role[] = ["headmaster", "dean", "chair", "professor", "assistant-professor", "head-pupil", "pupil"];
    for (let i = 0; i <= maxDepth; i++) {
      map[i] = roles[Math.min(i, roles.length - 1)];
    }
  }
  return map;
}

export async function buildHierarchyConfig(root: string): Promise<HierarchyConfig> {
  const files = await findContextFiles(root);
  let maxDepth = 0;
  for (const f of files) {
    const rel = relative(root, dirname(f));
    const depth = rel === "" ? 0 : rel.split(sep).length;
    if (depth > maxDepth) maxDepth = depth;
  }
  return { maxDepth, roleMap: computeRoleMap(maxDepth) };
}

export async function buildHierarchy(root: string): Promise<HierarchyNode> {
  const files = await findContextFiles(root);

  const scopes = files.map(f => {
    const rel = relative(root, dirname(f));
    return { scope: rel, contextPath: f };
  });

  const nodeMap = new Map<string, HierarchyNode>();

  for (const { scope, contextPath } of scopes) {
    const depth = scope === "" ? 0 : scope.split(sep).length;
    const node: HierarchyNode = {
      role: roleForDepth(depth),
      scope,
      contextPath,
      children: [],
    };
    nodeMap.set(scope, node);
  }

  for (const [scope, node] of nodeMap) {
    if (scope === "") continue;
    const parentScope = scope.includes(sep) ? scope.slice(0, scope.lastIndexOf(sep)) : "";
    const parent = nodeMap.get(parentScope);
    if (parent) {
      parent.children.push(scope);
    }
  }

  return nodeMap.get("") ?? {
    role: "headmaster",
    scope: "",
    contextPath: join(root, "CONTEXT.md"),
    children: Array.from(nodeMap.keys()).filter(s => !s.includes(sep) && s !== ""),
  };
}

export function findBestNode(
  nodeMap: Map<string, HierarchyNode>,
  targetPath: string,
): HierarchyNode | undefined {
  let best: HierarchyNode | undefined;
  let bestLen = -1;

  for (const [scope, node] of nodeMap) {
    if (targetPath.startsWith(scope) && scope.length > bestLen) {
      best = node;
      bestLen = scope.length;
    }
  }
  return best;
}

export function lowestCommonAncestor(scopes: string[]): string {
  if (scopes.length === 0) return "";
  if (scopes.length === 1) return scopes[0];

  const parts = scopes.map(s => (s === "" ? [] : s.split(sep)));
  const minLen = Math.min(...parts.map(p => p.length));
  const common: string[] = [];

  for (let i = 0; i < minLen; i++) {
    const segment = parts[0][i];
    if (parts.every(p => p[i] === segment)) {
      common.push(segment);
    } else {
      break;
    }
  }
  return common.join(sep);
}
