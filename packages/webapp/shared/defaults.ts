import type { SessionConfig } from "./types.js";

export const PRESET_COLORS = [
  "#e06c75", // Rose
  "#e5c07b", // Amber
  "#61afef", // Blue
  "#c678dd", // Purple
  "#56b6c2", // Teal
  "#98c379", // Green
  "#d19a66", // Orange
  "#e88cba", // Pink
] as const;

export function displayName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export const DEFAULT_CONFIG: SessionConfig = [];
