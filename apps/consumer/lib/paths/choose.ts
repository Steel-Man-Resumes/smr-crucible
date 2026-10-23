/** Called only after the person's visible confirmation. Existing APIs own writes. */
interface Lane { id: string; target_role: string; kind?: string }
interface Reply { ok: boolean; json(): Promise<unknown> }
type Fetcher = (url: string, init?: RequestInit) => Promise<Reply>;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const laneOf = (value: unknown): Lane | null => {
  const lane = record(value);
  return typeof lane.id === "string" && typeof lane.target_role === "string" && (!lane.kind || lane.kind === "resume") ? { id: lane.id, target_role: lane.target_role, kind: "resume" } : null;
};
export async function choosePathDirection(role: string, laneAtStart: string, currentLane: () => string, fetcher: Fetcher = fetch) {
  const listResponse = await fetcher("/api/lanes", { cache: "no-store" });
  const list = record(await listResponse.json());
  if (!listResponse.ok || !Array.isArray(list.lanes)) throw new Error("Your lanes could not be checked. Try again.");
  if (currentLane() !== laneAtStart) throw new Error("Your active lane changed. Compare paths again before choosing.");
  let lane = list.lanes.map(laneOf).find((item) => item?.target_role.toLowerCase() === role.toLowerCase()) ?? null;
  if (!lane) {
    const response = await fetcher("/api/lanes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: role.slice(0, 60), targetRole: role, kind: "resume" }) });
    const data = record(await response.json());
    lane = laneOf(data.lane);
    if (!response.ok || !lane || lane.target_role !== role) throw new Error(typeof data.message === "string" ? data.message : "This direction could not be saved. Try again.");
  }
  if (currentLane() !== laneAtStart) throw new Error("Your goal was saved, but your active lane changed. Select the saved goal from the lane chooser when ready.");
  const response = await fetcher("/api/lane-focus", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task: "explore", laneId: lane.id, target: lane.target_role }) });
  const focus = record(record(await response.json()).focus);
  if (!response.ok || focus.laneId !== lane.id) throw new Error("The goal is saved, but it could not be selected. Try Choose this direction again.");
  return { laneId: lane.id, target: lane.target_role };
}
