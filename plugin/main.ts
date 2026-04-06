import { Modal, Notice, Plugin, Setting, TFile } from "obsidian";
import { DEFAULT_SETTINGS, LlmWikiSettingTab, type LlmWikiSettings } from "./settings";
import { LlmWikiApi, type JobRow } from "./api";

export default class LlmWikiPlugin extends Plugin {
  settings: LlmWikiSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new LlmWikiSettingTab(this.app, this));

    this.addCommand({
      id: "ingest-current-note",
      name: "Ingest current note",
      callback: () => void this.ingestCurrentNote(),
    });

    this.addCommand({
      id: "ask-wiki",
      name: "Ask wiki…",
      callback: () => this.openAskWikiModal(),
    });

    this.addCommand({
      id: "run-lint",
      name: "Run lint",
      callback: () => void this.runLint(),
    });

    this.addCommand({
      id: "show-last-job",
      name: "Show last job status",
      callback: () => void this.showLastJob(),
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private api(): LlmWikiApi {
    return new LlmWikiApi(this.settings.apiBaseUrl, this.settings.apiToken);
  }

  private async ingestCurrentNote(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note");
      return;
    }
    if (!(file instanceof TFile)) {
      new Notice("Active item is not a file");
      return;
    }
    const rel = file.path;
    if (!rel.startsWith("raw/")) {
      new Notice("Note is not under raw/ — refusing to ingest");
      return;
    }
    try {
      const { jobId } = await this.api().ingest(rel);
      this.settings.lastJobId = jobId;
      await this.saveSettings();
      new Notice(`Queued ingest: ${jobId.slice(0, 8)}…`);
      void this.pollJob(jobId, "ingest");
    } catch (e) {
      new Notice(`Ingest failed: ${(e as Error).message}`);
    }
  }

  private openAskWikiModal(): void {
    const modal = new AskWikiModal(this.app, async (question, save) => {
      try {
        const { jobId } = await this.api().query(
          question,
          save ? "file-back-into-wiki" : "answer-only",
        );
        this.settings.lastJobId = jobId;
        await this.saveSettings();
        new Notice(`Queued query: ${jobId.slice(0, 8)}…`);
        void this.pollJob(jobId, "query");
      } catch (e) {
        new Notice(`Query failed: ${(e as Error).message}`);
      }
    });
    modal.open();
  }

  private async runLint(): Promise<void> {
    try {
      const { jobId } = await this.api().lint("recent");
      this.settings.lastJobId = jobId;
      await this.saveSettings();
      new Notice(`Queued lint: ${jobId.slice(0, 8)}…`);
      void this.pollJob(jobId, "lint");
    } catch (e) {
      new Notice(`Lint failed: ${(e as Error).message}`);
    }
  }

  private async showLastJob(): Promise<void> {
    if (!this.settings.lastJobId) {
      new Notice("No previous job recorded");
      return;
    }
    try {
      const job = await this.api().getJob(this.settings.lastJobId);
      new JobStatusModal(this.app, job).open();
    } catch (e) {
      new Notice(`Could not fetch job: ${(e as Error).message}`);
    }
  }

  /**
   * Poll the API every 2s up to 60 times. On terminal status, show a Notice.
   * Best-effort: errors are surfaced as Notices but don't throw.
   */
  private async pollJob(jobId: string, label: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      let job: JobRow;
      try {
        job = await this.api().getJob(jobId);
      } catch (e) {
        new Notice(`${label} poll failed: ${(e as Error).message}`);
        return;
      }
      if (job.status === "succeeded") {
        new Notice(`${label} succeeded (${jobId.slice(0, 8)})`);
        return;
      }
      if (job.status === "failed" || job.status === "cancelled") {
        new Notice(`${label} ${job.status}: ${job.errorText ?? "unknown"}`);
        return;
      }
    }
    new Notice(`${label} still pending after 2 min — use "Show last job status"`);
  }
}

class AskWikiModal extends Modal {
  private question = "";
  private save = false;

  constructor(
    app: import("obsidian").App,
    private onSubmit: (question: string, save: boolean) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Ask the wiki" });

    new Setting(contentEl).setName("Question").addTextArea((ta) => {
      ta.inputEl.rows = 4;
      ta.inputEl.style.width = "100%";
      ta.onChange((v) => {
        this.question = v;
      });
    });

    new Setting(contentEl)
      .setName("Save answer as wiki page")
      .setDesc("Persist this query under wiki/queries/")
      .addToggle((tg) =>
        tg.setValue(false).onChange((v) => {
          this.save = v;
        }),
      );

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Ask")
        .setCta()
        .onClick(async () => {
          if (!this.question.trim()) return;
          this.close();
          await this.onSubmit(this.question.trim(), this.save);
        }),
    );
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

class JobStatusModal extends Modal {
  constructor(
    app: import("obsidian").App,
    private job: JobRow,
  ) {
    super(app);
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `Job ${this.job.id.slice(0, 8)}…` });
    contentEl.createEl("p", { text: `Type: ${this.job.type}` });
    contentEl.createEl("p", { text: `Status: ${this.job.status}` });
    if (this.job.errorText) {
      contentEl.createEl("p", { text: `Error: ${this.job.errorText}` });
    }
    if (this.job.result) {
      contentEl.createEl("h3", { text: "Result" });
      const pre = contentEl.createEl("pre");
      pre.style.whiteSpace = "pre-wrap";
      pre.style.maxHeight = "400px";
      pre.style.overflow = "auto";
      pre.setText(this.job.result.text);
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
