import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface ZoteroPreferenceFile {
  auto_save_important_papers?: boolean;
}

function defaultPreferencePath(): string {
  if (process.platform === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "UniPaper",
      "zotero.json",
    );
  }
  if (process.platform === "win32") {
    const root = process.env.LOCALAPPDATA || process.env.APPDATA;
    if (root) return join(root, "UniPaper", "zotero.json");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "unipaper", "zotero.json");
}

export class ZoteroAutoSavePreference {
  constructor(private readonly path = defaultPreferencePath()) {}

  async enabled(): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as ZoteroPreferenceFile;
      return parsed.auto_save_important_papers === true;
    } catch {
      return false;
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp-${process.pid}`;
    await writeFile(
      temporary,
      `${JSON.stringify({ auto_save_important_papers: enabled }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporary, this.path);
  }
}
