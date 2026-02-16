import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ColumnStorage, StorageProvider } from "columnar";

export function fileSystemStorage(dir: string): StorageProvider {
  return (name: string): ColumnStorage => {
    const colDir = join(dir, name);
    let cachedLength: number | null = null;

    function countFiles(): number {
      let n = 0;
      while (existsSync(join(colDir, `${n}.txt`))) {
        n++;
      }
      return n;
    }

    return {
      get(step: number): string | undefined {
        try {
          return readFileSync(join(colDir, `${step}.txt`), "utf-8");
        } catch {
          return undefined;
        }
      },

      push(value: string): void {
        mkdirSync(colDir, { recursive: true });
        const step = cachedLength ?? countFiles();
        writeFileSync(join(colDir, `${step}.txt`), value);
        cachedLength = step + 1;
      },

      get length(): number {
        if (cachedLength === null) {
          cachedLength = countFiles();
        }
        return cachedLength;
      },
    };
  };
}
