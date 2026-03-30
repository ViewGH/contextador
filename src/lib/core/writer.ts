import { lowestCommonAncestor } from "./hierarchy";
import type { Role, WriteResponse } from "./types";
import { sep } from "path";

interface WritePlan {
  coordinator: string;
  coordinatorRole: Role;
  delegations: Array<{
    path: string;
    targetScope: string;
  }>;
  docsToUpdate: string[];
}

export function planWrite(touchedPaths: string[]): WritePlan {
  const scopes = touchedPaths.map(p => {
    const parts = p.split(sep);
    return parts.slice(0, Math.min(parts.length - 1, 3)).join(sep);
  });

  const uniqueScopes = [...new Set(scopes)];
  const coordinator = lowestCommonAncestor(uniqueScopes);

  const depth = coordinator === "" ? 0 : coordinator.split(sep).length;
  const roles: Role[] = ["headmaster", "dean", "chair", "professor", "pupil"];
  const coordinatorRole = roles[Math.min(depth, roles.length - 1)];

  const delegations = touchedPaths.map(path => {
    const parts = path.split(sep);
    const targetScope = parts.slice(0, Math.min(parts.length - 1, 3)).join(sep);
    return { path, targetScope };
  });

  const docsToUpdate: string[] = [];
  const seenScopes = new Set<string>();
  for (const { targetScope } of delegations) {
    if (!seenScopes.has(targetScope)) {
      seenScopes.add(targetScope);
      docsToUpdate.push(`${targetScope}/CONTEXT.md`);
    }
  }
  if (coordinator !== "") {
    docsToUpdate.push(`${coordinator}/CONTEXT.md`);
  }

  return {
    coordinator,
    coordinatorRole,
    delegations,
    docsToUpdate: [...new Set(docsToUpdate)],
  };
}

export function buildWriteResponse(
  coordinator: string,
  coordinatorRole: Role,
  changes: Array<{ path: string; status: "created" | "updated" }>,
  docsUpdated: string[],
): WriteResponse {
  return {
    action: "write",
    coordinatedBy: `${coordinatorRole}:${coordinator || "root"}`,
    changes,
    docsUpdated,
  };
}
