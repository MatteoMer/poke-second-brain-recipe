import { App, PluginSettingTab, Setting } from "obsidian";
import type LlmWikiPlugin from "./main";

export interface LlmWikiSettings {
  apiBaseUrl: string;
  apiToken: string;
  lastJobId: string;
}

export const DEFAULT_SETTINGS: LlmWikiSettings = {
  apiBaseUrl: "https://localhost:8080",
  apiToken: "",
  lastJobId: "",
};

export class LlmWikiSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: LlmWikiPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "LLM Wiki" });
    containerEl.createEl("p", {
      text: "Trigger LLM wiki jobs against your VPS worker. Requires HTTPS for the URL — Obsidian/Electron will reject self-signed or plain HTTP unless tunneled.",
    });

    new Setting(containerEl)
      .setName("API base URL")
      .setDesc("e.g. https://wiki.example.com")
      .addText((text) =>
        text
          .setPlaceholder("https://wiki.example.com")
          .setValue(this.plugin.settings.apiBaseUrl)
          .onChange(async (value) => {
            this.plugin.settings.apiBaseUrl = value.trim().replace(/\/+$/, "");
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("API token")
      .setDesc("Bearer token from /etc/llm-wiki/env on the VPS. Stored in vault data.json — note this syncs across devices.")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("…")
          .setValue(this.plugin.settings.apiToken)
          .onChange(async (value) => {
            this.plugin.settings.apiToken = value.trim();
            await this.plugin.saveSettings();
          });
      });
  }
}
