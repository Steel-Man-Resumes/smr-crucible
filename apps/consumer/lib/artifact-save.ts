/** An HTTP response is not a save receipt until it succeeds and names the artifact. */
export async function saveArtifactReceipt(payload: unknown, expectedAccountId: string, send: typeof fetch = fetch): Promise<string> {
  if (!expectedAccountId) throw new Error("Your account could not be confirmed. Reload before saving.");
  const response = await send("/api/artifacts", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Expected-Account-Id": expectedAccountId },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  const result = await response.json().catch(() => null);
  const id = result?.data?.id;
  if (!response.ok || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("The save could not be confirmed. Your work is still here. Check your Library before retrying.");
  return id;
}
