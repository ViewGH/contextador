import { Glob } from "bun";
import { loadConfig } from "./projectconfig";

export async function countCodeFiles(root: string): Promise<number> {
  const glob = new Glob("**/*.{ts,tsx,js,jsx,py,rs,go,java,cs,swift,c,cpp,h,rb,kt}");
  let count = 0;
  for await (const _ of glob.scan({ cwd: root, absolute: false })) {
    count++;
    if (count > 10000) break; // Cap counting for huge repos
  }
  return count;
}

export async function shouldUseContextador(root: string): Promise<{ use: boolean; fileCount: number; threshold: number; reason: string }> {
  const config = await loadConfig(root);
  const fileCount = await countCodeFiles(root);

  if (fileCount < config.minFiles) {
    return {
      use: false,
      fileCount,
      threshold: config.minFiles,
      reason: `Repo has ${fileCount} code files (threshold: ${config.minFiles}). Direct exploration is more efficient.`,
    };
  }

  return {
    use: true,
    fileCount,
    threshold: config.minFiles,
    reason: `Repo has ${fileCount} code files — Contextador recommended.`,
  };
}
