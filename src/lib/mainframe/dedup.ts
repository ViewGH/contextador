/**
 * Deduplication for the mainframe multi-agent sharing layer.
 * Finds matching broadcasts in room history to avoid redundant queries.
 */

import { isBroadcast, parseBroadcast, type BroadcastData } from "./rooms";

export function findMatchingBroadcast(
  events: any[],
  queryHash: string,
  maxAgeHours: number = 24,
): BroadcastData | null {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);

  for (const event of events) {
    if (!isBroadcast(event)) continue;
    const data = parseBroadcast(event);
    if (!data || data.queryHash !== queryHash) continue;

    const timestamp = event.content?.["m.ctx"]?.data?.timestamp;
    if (timestamp && new Date(timestamp).getTime() < cutoff) continue;

    return data;
  }

  return null;
}
