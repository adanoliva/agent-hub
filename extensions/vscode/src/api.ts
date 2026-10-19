import * as vscode from 'vscode';

// Thin client over Agent Hub's local REST API (the same one the app and the `agent-hub` CLI use).
// The app must be running: everything (providers, skills, context, MCP, timeouts) lives there.

export interface Project { id: string; name: string; path: string; status: string; pendingUpdates?: number }
export interface Agent { name: string; description?: string; level?: string; model?: string }
export interface TemporalField { id: string; type: 'file' | 'text'; label: string; placeholder?: string; required: boolean }
export interface OrchNode {
  id: string; agentName: string; dependsOn: string[]; isRoot?: boolean; x?: number; y?: number;
  dataFlow: { agentOutput: boolean; filesModified: boolean; projectContext: boolean };
  contextExtra: { fixed: { freeText: string; files: string[] }; temporal: TemporalField[] };
  gateAfter?: boolean;
}
export interface Orchestration {
  id: string; name: string; description?: string; nodes: OrchNode[];
  executionCount?: number; lastExecutionStatus?: string; lastExecutedAt?: string;
  activeExecutionId?: string | null;   // running right now (launched from anywhere)
  executionConfig?: { maxTurns?: number; timeout?: number; stepTimeout?: number; maxBudgetUSD?: number };
}
export interface ExecutionMeta { executionId: string; orchestrationId: string; status: string; startedAt: string; completedAt?: string; stepsCompleted?: number; totalSteps?: number }
export interface CostHistory { runs: number; input: number; output: number; costUSD: number | null }
export interface CostEstimate {
  provider: string; priced: boolean; nativeCLI: boolean;
  totals: { inputTokens: number; minCostUSD: number | null; history: CostHistory | null };
}

export class ApiError extends Error {}

export class Api {
  get base(): string {
    // The app listens on 127.0.0.1 only, and `localhost` may resolve to ::1 first in the extension host
    return vscode.workspace.getConfiguration('agentHub').get<string>('url', 'http://127.0.0.1:3737')
      .replace(/\/+$/, '').replace(/\/\/localhost(?=[:/]|$)/i, '//127.0.0.1');
  }

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/api${path}`, {
        ...init,
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      throw new ApiError('Agent Hub no está abierto (no responde en ' + this.base + ')');
    }
    if (!res.ok) {
      const body: any = await res.json().catch(() => ({}));
      throw new ApiError(body.errors?.length ? body.errors.join(' · ') : body.error || `Error ${res.status}`);
    }
    return res;
  }

  async req<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const res = await this.fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body), signal });
    return res.json() as Promise<T>;
  }

  async isUp(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/api/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch { return false; }
  }

  /** POST that answers NDJSON (one JSON object per line), e.g. /projects/:id/run?stream=1 */
  async *ndjson(path: string, body: unknown, signal: AbortSignal): AsyncGenerator<any> {
    const res = await this.fetch(path, { method: 'POST', body: JSON.stringify(body), signal });
    for await (const line of lines(res, signal)) {
      if (line.trim()) yield JSON.parse(line);
    }
  }

  /** Server-sent events: yields { event, data } (data already parsed) */
  async *sse(path: string, signal: AbortSignal): AsyncGenerator<{ event: string; data: any }> {
    const res = await this.fetch(path, { headers: { Accept: 'text/event-stream' }, signal });
    let event = 'message';
    let data = '';
    for await (const line of lines(res, signal)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
      else if (line === '') {
        if (data) yield { event, data: JSON.parse(data) };
        event = 'message';
        data = '';
      }
    }
  }
}

async function* lines(res: Response, signal: AbortSignal): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  signal.addEventListener('abort', () => reader.cancel().catch(() => {}), { once: true });
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const parts = (pending + decoder.decode(value, { stream: true })).split(/\r?\n/);
    pending = parts.pop()!;
    yield* parts;
  }
  if (pending) yield pending;
}
