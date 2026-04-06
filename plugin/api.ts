import { requestUrl, type RequestUrlParam } from "obsidian";

export interface JobRow {
  id: string;
  type: "ingest" | "query" | "lint" | "reindex";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  input: unknown;
  result: { text: string; rawJson?: unknown } | null;
  errorText: string | null;
  sessionId: string | null;
  attempts: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
}

export interface EnqueueResponse {
  jobId: string;
  status: "queued";
}

export class LlmWikiApi {
  constructor(
    private baseUrl: string,
    private token: string,
  ) {}

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.baseUrl) throw new Error("API base URL not configured");
    if (!this.token) throw new Error("API token not configured");
    const url = `${this.baseUrl}${path}`;
    const params: RequestUrlParam = {
      url,
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      throw: false,
    };
    if (body !== undefined) {
      params.body = JSON.stringify(body);
    }
    const res = await requestUrl(params);
    if (res.status >= 400) {
      const text = res.text || `${res.status}`;
      throw new Error(`api ${method} ${path} failed: ${res.status} ${text}`);
    }
    return res.json as T;
  }

  ingest(sourceRelPath: string, focus?: string): Promise<EnqueueResponse> {
    return this.req("POST", "/ingest", { sourceRelPath, focus });
  }

  query(question: string, mode: "answer-only" | "file-back-into-wiki"): Promise<EnqueueResponse> {
    return this.req("POST", "/query", { question, mode });
  }

  lint(scope: "all" | "recent" = "recent"): Promise<EnqueueResponse> {
    return this.req("POST", "/lint", { scope });
  }

  reindex(): Promise<EnqueueResponse> {
    return this.req("POST", "/reindex", {});
  }

  getJob(id: string): Promise<JobRow> {
    return this.req("GET", `/jobs/${id}`);
  }
}
