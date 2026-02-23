export type ChangeSurfaceBucket =
  | "source"
  | "test"
  | "docs"
  | "config"
  | "infra"
  | "asset"
  | "unknown";

export type ChangeSurfaceScope =
  | "app"
  | "tests"
  | "docs"
  | "tooling"
  | "infra"
  | "repo"
  | "unknown";

export type ChangeSurfaceLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "yaml"
  | "markdown"
  | "css"
  | "shell"
  | "toml"
  | "text"
  | "binary"
  | "unknown";

export interface ChangeSurfaceFile {
  filePath: string;
  bucket: ChangeSurfaceBucket;
  scope: ChangeSurfaceScope;
  language: ChangeSurfaceLanguage;
  hunkCount: number;
  changedLines: number;
  symbols: string[];
}

export interface ChangeSurfaceBucketCount {
  bucket: ChangeSurfaceBucket;
  fileCount: number;
  hunkCount: number;
  changedLines: number;
}

export interface ChangeSurfaceScopeCount {
  scope: ChangeSurfaceScope;
  fileCount: number;
  hunkCount: number;
  changedLines: number;
}

export interface ChangeSurfaceLanguageCount {
  language: ChangeSurfaceLanguage;
  fileCount: number;
  hunkCount: number;
  changedLines: number;
}

export interface ChangeSurfaceResult {
  files: ChangeSurfaceFile[];
  rankedFilePaths: string[];
  bucketCounts: ChangeSurfaceBucketCount[];
  scopeCounts: ChangeSurfaceScopeCount[];
  languageCounts: ChangeSurfaceLanguageCount[];
}
