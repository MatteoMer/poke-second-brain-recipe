export type JobType = "ingest" | "query" | "lint" | "reindex";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface IngestInput {
  sourceRelPath: string;
  focus?: string;
}

export interface QueryInput {
  question: string;
  mode: "answer-only" | "file-back-into-wiki";
}

export interface LintInput {
  scope: "all" | "recent";
}

export type ReindexInput = Record<string, never>;

export type JobInput = IngestInput | QueryInput | LintInput | ReindexInput;

export interface JobResult {
  text: string;
  rawJson?: unknown;
}

export interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  input: JobInput;
  result: JobResult | null;
  errorText: string | null;
  sessionId: string | null;
  attempts: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
}
