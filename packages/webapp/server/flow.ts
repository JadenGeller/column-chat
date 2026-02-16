import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { Column, DerivedColumn, StorageProvider } from "columnar";
import type { SessionConfig, ColumnConfig } from "../shared/types.js";
import {
  createSessionFromConfig as _createSessionFromConfig,
  createColumnFromConfig as _createColumnFromConfig,
} from "../shared/flow.js";

const model: LanguageModel = anthropic("claude-sonnet-4-5-20250929");

export function createColumnFromConfig(
  cfg: ColumnConfig,
  columnMap: Map<string, Column>,
  storage: StorageProvider
): DerivedColumn {
  return _createColumnFromConfig(cfg, columnMap, storage, model);
}

export function createSessionFromConfig(config: SessionConfig) {
  return _createSessionFromConfig(config, model);
}
