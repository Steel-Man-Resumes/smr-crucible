export async function readDocumentResponse(response: Response, onProgress: (event: any) => void): Promise<any> {
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
  if (!response.body) throw new Error("Empty document response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let result: any;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.error || "Document generation failed");
    if (event.type === "done") result = event;
    else onProgress(event);
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      lines.forEach(consume);
      if (done) break;
    }
    consume(pending);
    if (!result) throw new Error("Document generation was interrupted. Try again.");
    return result;
  } finally { reader.releaseLock(); }
}
