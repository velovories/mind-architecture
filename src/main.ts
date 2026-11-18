import { App, FuzzySuggestModal, MarkdownView, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { DEFAULT_DATA, VaultModel, type PluginData } from "./model";
import { LinksView, StatsView, VIEW_BRANCHES, VIEW_ISLANDS, VIEW_LINKS, VIEW_STATS, VIEW_TODAY } from "./ui/views";
import { HubView } from "./ui/hub";
import { IslandsView } from "./ui/islands-view";
import { BranchesView } from "./ui/branches-view";
import { CaptureModal } from "./ui/capture";
import { WalkModal, walkStart } from "./ui/walk";
import { TILE_IDS } from "./model";
import { LinkModal } from "./ui/link-modal";
import { LANG_NAMES, setLang, t, type Lang } from "./i18n";

export default class MindPlugin extends Plugin {
  data: PluginData = structuredClone(DEFAULT_DATA);
  model!: VaultModel;

  get textCache(): Map<string, string> {
    return this.model.texts;
  }

  async onload(): Promise<void> {
    this.data = Object.assign(structuredClone(DEFAULT_DATA), await this.loadData());
    // tiles added in a newer version join the end of a saved order
    const order = this.data.tiles.order.filter((x) => (TILE_IDS as readonly string[]).includes(x));
    this.data.tiles.order = [...order, ...TILE_IDS.filter((x) => !order.includes(x))];
    setLang(this.data.lang);
    this.model = new VaultModel(this.app, () => this.data, () => this.saveData(this.data));

    this.registerView(VIEW_TODAY, (leaf) => new HubView(leaf, this));
    this.registerView(VIEW_ISLANDS, (leaf) => new IslandsView(leaf, this));
    this.registerView(VIEW_BRANCHES, (leaf) => new BranchesView(leaf, this));
    this.registerView(VIEW_LINKS, (leaf) => new LinksView(leaf, this));
    this.registerView(VIEW_STATS, (leaf) => new StatsView(leaf, this));

    this.addRibbonIcon("brain-circuit", "Mind Architecture", () => void this.open(VIEW_TODAY));
    this.addCommand({ id: "open-today", name: t("cmdToday"), callback: () => void this.open(VIEW_TODAY) });
    this.addCommand({ id: "open-links", name: t("cmdLinks"), callback: () => void this.open(VIEW_LINKS, true) });
    this.addCommand({ id: "open-stats", name: t("cmdStats"), callback: () => void this.open(VIEW_STATS) });
    this.addCommand({ id: "open-islands", name: t("cmdIslands"), callback: () => void this.open(VIEW_ISLANDS) });
    this.addCommand({ id: "capture", name: t("cmdCapture"), callback: () => new CaptureModal(this.app, this).open() });
    this.addCommand({
      id: "walk", name: t("cmdWalk"), callback: () => {
        const start = walkStart(this);
        if (start) new WalkModal(this.app, this, start).open();
      },
    });
    this.addCommand({
      id: "branches",
      name: t("cmdBranches"),
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveFile();
        if (!f || f.extension !== "md") return false;
        if (!checking) void this.openBranches(f.path);
        return true;
      },
    });
    this.addCommand({
      id: "link-with-why",
      name: t("cmdLinkWhy"),
      checkCallback: (checking) => {
        const f = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!f) return false;
        if (!checking) new NotePicker(this, f).open();
        return true;
      },
    });
    this.addSettingTab(new MindSettings(this.app, this));
    this.registerEvent(this.app.workspace.on("file-open", (f) => { if (f && f.extension === "md") this.remember(f.path); }));

    this.app.workspace.onLayoutReady(async () => {
      await this.model.rebuild();
      // The metadata cache keeps updating links after start-up; rebuild when it settles and on every change.
      this.registerEvent(this.app.metadataCache.on("resolved", () => this.model.scheduleRebuild()));
      this.registerEvent(this.app.vault.on("delete", () => this.model.scheduleRebuild()));
      this.registerEvent(this.app.vault.on("rename", () => this.model.scheduleRebuild()));
    });
  }

  private persist = debounce(() => void this.saveData(this.data), 2000, true);

  /** Newest first, unique, ten at most. Called for notes opened anywhere, and for notes peeked in the preview. */
  remember(path: string): void {
    const r = this.data.recent.filter((p) => p !== path);
    r.unshift(path);
    this.data.recent = r.slice(0, 10);
    this.persist();
    this.model.notify();
  }

  /** Recent notes that still exist. */
  recent(n = 3, except?: string): string[] {
    return this.data.recent.filter((p) => p !== except && this.app.vault.getAbstractFileByPath(p) instanceof TFile).slice(0, n);
  }

  async setLanguage(lang: Lang): Promise<void> {
    this.data.lang = lang;
    setLang(lang);
    await this.saveData(this.data);
    // Views re-render in the new language; tab titles follow on the next layout pass.
    this.model.notify();
    this.app.workspace.requestSaveLayout();
  }

  /** One «Ветви» tab, re-pointed at whichever note you ask about. */
  async openBranches(path: string): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(VIEW_BRANCHES)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_BRANCHES, active: true, state: { path } });
    await workspace.revealLeaf(leaf);
  }

  async open(type: string, side = false): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(type)[0] ?? null;
    if (!leaf) {
      leaf = side ? workspace.getRightLeaf(false) : workspace.getLeaf("tab");
      if (!leaf) return;
      await leaf.setViewState({ type, active: true });
    }
    await workspace.revealLeaf(leaf);
  }
}

class NotePicker extends FuzzySuggestModal<TFile> {
  constructor(private plugin: MindPlugin, private from: TFile) {
    super(plugin.app);
    this.setPlaceholder(t("pickNote"));
  }
  getItems(): TFile[] {
    // recently opened notes first: the one you just read is usually the one you want to link
    const rank = new Map(this.plugin.data.recent.map((p, i) => [p, i]));
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f !== this.from)
      .sort((a, b) => (rank.get(a.path) ?? 99) - (rank.get(b.path) ?? 99));
  }
  getItemText(f: TFile): string {
    return f.basename;
  }
  onChooseItem(f: TFile): void {
    new LinkModal(this.app, this.from, f.basename, undefined, this.plugin).open();
  }
}

class MindSettings extends PluginSettingTab {
  constructor(app: App, private plugin: MindPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("setLang"))
      .setDesc(t("setLangDesc"))
      .addDropdown((d) => {
        for (const [code, name] of Object.entries(LANG_NAMES)) d.addOption(code, name);
        d.setValue(this.plugin.data.lang).onChange(async (v) => {
          await this.plugin.setLanguage(v as Lang);
          this.display(); // redraw this page in the new language
        });
      });

    new Setting(containerEl)
      .setName(t("setCaptureFolder"))
      .setDesc(t("setCaptureFolderDesc"))
      .addText((tx) => tx.setValue(this.plugin.data.captureFolder).onChange(async (v) => {
        this.plugin.data.captureFolder = v.trim();
        await this.plugin.saveData(this.plugin.data);
      }));

    new Setting(containerEl)
      .setName(t("setExclude"))
      .setDesc(t("setExcludeDesc"))
      .addTextArea((ta) =>
        ta.setValue(this.plugin.data.excludeFolders.join("\n")).onChange(async (v) => {
          this.plugin.data.excludeFolders = v.split("\n").map((x) => x.trim()).filter(Boolean);
          await this.plugin.saveData(this.plugin.data);
          this.plugin.model.scheduleRebuild();
        }),
      );

    new Setting(containerEl)
      .setName(t("setForget"))
      .setDesc(t("setForgetDesc", { n: this.plugin.data.rejected.length + Object.keys(this.plugin.data.snoozed).length }))
      .addButton((b) =>
        b.setButtonText(t("setForgetBtn")).onClick(async () => {
          this.plugin.data.rejected = [];
          this.plugin.data.snoozed = {};
          await this.plugin.saveData(this.plugin.data);
          this.plugin.model.notify();
          this.display();
        }),
      );
  }
}
