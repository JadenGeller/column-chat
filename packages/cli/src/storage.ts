import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ColumnStorage } from "columnar";

export function createFileSystemStorage(dir: string): ColumnStorage {
  let cachedLength: number | null = null;

  function countFiles(): number {
    let n = 0;
    while (existsSync(join(dir, `${n}.txt`))) {
      n++;
    }
    return n;
  }

  return {
    get(step: number): string | undefined {
      const filePath = join(dir, `${step}.txt`);
      try {
        return readFileSync(filePath, "utf-8");
      } catch {
        return undefined;
      }
    },

    push(value: string): void {
      mkdirSync(dir, { recursive: true });
      const step = cachedLength ?? countFiles();
      writeFileSync(join(dir, `${step}.txt`), value);
      cachedLength = step + 1;
    },

    get length(): number {
      if (cachedLength === null) {
        cachedLength = countFiles();
      }
      return cachedLength;
    },
  };
}
