import type { DiffCollectionResult } from "./diff-types";
import type {
  ChangeSurfaceBucket,
  ChangeSurfaceBucketCount,
  ChangeSurfaceFile,
  ChangeSurfaceLanguage,
  ChangeSurfaceLanguageCount,
  ChangeSurfaceResult,
  ChangeSurfaceScope,
  ChangeSurfaceScopeCount,
} from "./change-surface-types";

interface MutableSurfaceFile {
  filePath: string;
  hunkCount: number;
  changedLines: number;
  symbols: Set<string>;
}

interface MutableCounts {
  fileCount: number;
  hunkCount: number;
  changedLines: number;
}

const SYMBOL_TOKEN_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g;

const BUCKET_ORDER: readonly ChangeSurfaceBucket[] = [
  "source",
  "test",
  "docs",
  "config",
  "infra",
  "asset",
  "unknown",
];

const SCOPE_ORDER: readonly ChangeSurfaceScope[] = [
  "app",
  "tests",
  "docs",
  "tooling",
  "infra",
  "repo",
  "unknown",
];

const LANGUAGE_ORDER: readonly ChangeSurfaceLanguage[] = [
  "typescript",
  "javascript",
  "json",
  "yaml",
  "markdown",
  "css",
  "shell",
  "toml",
  "text",
  "binary",
  "unknown",
];

const SOURCE_EXTENSIONS = new Set<string>([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "swift",
  "php",
  "cs",
  "c",
  "cc",
  "cpp",
  "h",
  "hh",
  "hpp",
  "scala",
  "lua",
  "sql",
  "sh",
  "bash",
  "zsh",
]);

const CONFIG_EXTENSIONS = new Set<string>([
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "conf",
]);

const BINARY_EXTENSIONS = new Set<string>([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "pdf",
  "zip",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "tar",
  "rar",
  "jar",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
]);

const TEXT_EXTENSIONS = new Set<string>(["txt", "text", "log", "csv", "tsv"]);
const DOC_EXTENSIONS = new Set<string>(["md", "mdx", "rst"]);

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0;
  }

  return left < right ? -1 : 1;
}

function createMutableCounts(): MutableCounts {
  return {
    fileCount: 0,
    hunkCount: 0,
    changedLines: 0,
  };
}

function normalizePathForMatching(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").toLowerCase();
}

function getPathExtension(normalizedPath: string): string | null {
  const lastSegmentStart = normalizedPath.lastIndexOf("/") + 1;
  const fileName = normalizedPath.slice(lastSegmentStart);
  const extensionStart = fileName.lastIndexOf(".");

  if (extensionStart <= 0) {
    return null;
  }

  return fileName.slice(extensionStart + 1);
}

function hasPathSegment(normalizedPath: string, segment: string): boolean {
  return (
    normalizedPath === segment ||
    normalizedPath.startsWith(`${segment}/`) ||
    normalizedPath.includes(`/${segment}/`)
  );
}

function isTestPath(normalizedPath: string): boolean {
  return (
    hasPathSegment(normalizedPath, "__tests__") ||
    hasPathSegment(normalizedPath, "tests") ||
    normalizedPath.includes(".test.") ||
    normalizedPath.includes(".spec.")
  );
}

function isDocsPath(normalizedPath: string): boolean {
  return hasPathSegment(normalizedPath, "docs");
}

function isInfraPath(normalizedPath: string): boolean {
  return (
    hasPathSegment(normalizedPath, ".github") ||
    hasPathSegment(normalizedPath, "infra") ||
    hasPathSegment(normalizedPath, "terraform") ||
    hasPathSegment(normalizedPath, "docker") ||
    hasPathSegment(normalizedPath, "k8s")
  );
}

function isToolingPath(normalizedPath: string): boolean {
  return (
    hasPathSegment(normalizedPath, "scripts") ||
    hasPathSegment(normalizedPath, "tools") ||
    hasPathSegment(normalizedPath, "bin")
  );
}

function isAppPath(normalizedPath: string): boolean {
  return (
    hasPathSegment(normalizedPath, "src") ||
    hasPathSegment(normalizedPath, "app") ||
    hasPathSegment(normalizedPath, "lib") ||
    hasPathSegment(normalizedPath, "packages")
  );
}

function classifyLanguage(filePath: string): ChangeSurfaceLanguage {
  const normalizedPath = normalizePathForMatching(filePath);
  const extension = getPathExtension(normalizedPath);

  if (extension === null) {
    return "unknown";
  }

  if (
    extension === "ts" ||
    extension === "tsx" ||
    extension === "mts" ||
    extension === "cts"
  ) {
    return "typescript";
  }

  if (
    extension === "js" ||
    extension === "jsx" ||
    extension === "mjs" ||
    extension === "cjs"
  ) {
    return "javascript";
  }

  if (extension === "json" || extension === "jsonc") {
    return "json";
  }

  if (extension === "yml" || extension === "yaml") {
    return "yaml";
  }

  if (DOC_EXTENSIONS.has(extension)) {
    return "markdown";
  }

  if (extension === "css" || extension === "scss" || extension === "less") {
    return "css";
  }

  if (extension === "sh" || extension === "bash" || extension === "zsh") {
    return "shell";
  }

  if (extension === "toml") {
    return "toml";
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return "text";
  }

  if (BINARY_EXTENSIONS.has(extension)) {
    return "binary";
  }

  return "unknown";
}

function classifyBucket(filePath: string, language: ChangeSurfaceLanguage): ChangeSurfaceBucket {
  const normalizedPath = normalizePathForMatching(filePath);
  const extension = getPathExtension(normalizedPath);

  if (isTestPath(normalizedPath)) {
    return "test";
  }

  if (isDocsPath(normalizedPath) || language === "markdown") {
    return "docs";
  }

  if (isInfraPath(normalizedPath)) {
    return "infra";
  }

  if (extension !== null && CONFIG_EXTENSIONS.has(extension)) {
    return "config";
  }

  if (extension !== null && SOURCE_EXTENSIONS.has(extension)) {
    return "source";
  }

  if (language === "binary") {
    return "asset";
  }

  return "unknown";
}

function classifyScope(filePath: string): ChangeSurfaceScope {
  const normalizedPath = normalizePathForMatching(filePath);

  if (normalizedPath.length === 0) {
    return "unknown";
  }

  if (isTestPath(normalizedPath)) {
    return "tests";
  }

  if (isDocsPath(normalizedPath)) {
    return "docs";
  }

  if (isToolingPath(normalizedPath)) {
    return "tooling";
  }

  if (isInfraPath(normalizedPath)) {
    return "infra";
  }

  if (isAppPath(normalizedPath)) {
    return "app";
  }

  return "repo";
}

function extractHunkHeaderTail(header: string): string {
  const firstDelimiter = header.indexOf("@@");
  if (firstDelimiter < 0) {
    return "";
  }

  const secondDelimiter = header.indexOf("@@", firstDelimiter + 2);
  if (secondDelimiter < 0) {
    return "";
  }

  return header.slice(secondDelimiter + 2).trim();
}

function extractHeaderTokens(header: string): string[] {
  const headerTail = extractHunkHeaderTail(header);
  if (headerTail.length === 0) {
    return [];
  }

  const tokens = headerTail.match(SYMBOL_TOKEN_PATTERN);
  if (!tokens) {
    return [];
  }

  return tokens.map((token) => token.toLowerCase());
}

function getOrCreateSurfaceFile(
  filesByPath: Map<string, MutableSurfaceFile>,
  filePath: string,
): MutableSurfaceFile {
  const existing = filesByPath.get(filePath);
  if (existing) {
    return existing;
  }

  const next: MutableSurfaceFile = {
    filePath,
    hunkCount: 0,
    changedLines: 0,
    symbols: new Set<string>(),
  };
  filesByPath.set(filePath, next);
  return next;
}

function buildBucketCounts(files: readonly ChangeSurfaceFile[]): ChangeSurfaceBucketCount[] {
  const counts: Record<ChangeSurfaceBucket, MutableCounts> = {
    source: createMutableCounts(),
    test: createMutableCounts(),
    docs: createMutableCounts(),
    config: createMutableCounts(),
    infra: createMutableCounts(),
    asset: createMutableCounts(),
    unknown: createMutableCounts(),
  };

  for (const file of files) {
    const next = counts[file.bucket];
    next.fileCount += 1;
    next.hunkCount += file.hunkCount;
    next.changedLines += file.changedLines;
  }

  return BUCKET_ORDER.flatMap((bucket) => {
    const bucketCounts = counts[bucket];
    if (bucketCounts.fileCount === 0) {
      return [];
    }

    return [
      {
        bucket,
        fileCount: bucketCounts.fileCount,
        hunkCount: bucketCounts.hunkCount,
        changedLines: bucketCounts.changedLines,
      },
    ];
  });
}

function buildScopeCounts(files: readonly ChangeSurfaceFile[]): ChangeSurfaceScopeCount[] {
  const counts: Record<ChangeSurfaceScope, MutableCounts> = {
    app: createMutableCounts(),
    tests: createMutableCounts(),
    docs: createMutableCounts(),
    tooling: createMutableCounts(),
    infra: createMutableCounts(),
    repo: createMutableCounts(),
    unknown: createMutableCounts(),
  };

  for (const file of files) {
    const next = counts[file.scope];
    next.fileCount += 1;
    next.hunkCount += file.hunkCount;
    next.changedLines += file.changedLines;
  }

  return SCOPE_ORDER.flatMap((scope) => {
    const scopeCounts = counts[scope];
    if (scopeCounts.fileCount === 0) {
      return [];
    }

    return [
      {
        scope,
        fileCount: scopeCounts.fileCount,
        hunkCount: scopeCounts.hunkCount,
        changedLines: scopeCounts.changedLines,
      },
    ];
  });
}

function buildLanguageCounts(files: readonly ChangeSurfaceFile[]): ChangeSurfaceLanguageCount[] {
  const counts: Record<ChangeSurfaceLanguage, MutableCounts> = {
    typescript: createMutableCounts(),
    javascript: createMutableCounts(),
    json: createMutableCounts(),
    yaml: createMutableCounts(),
    markdown: createMutableCounts(),
    css: createMutableCounts(),
    shell: createMutableCounts(),
    toml: createMutableCounts(),
    text: createMutableCounts(),
    binary: createMutableCounts(),
    unknown: createMutableCounts(),
  };

  for (const file of files) {
    const next = counts[file.language];
    next.fileCount += 1;
    next.hunkCount += file.hunkCount;
    next.changedLines += file.changedLines;
  }

  return LANGUAGE_ORDER.flatMap((language) => {
    const languageCounts = counts[language];
    if (languageCounts.fileCount === 0) {
      return [];
    }

    return [
      {
        language,
        fileCount: languageCounts.fileCount,
        hunkCount: languageCounts.hunkCount,
        changedLines: languageCounts.changedLines,
      },
    ];
  });
}

/*
 * Deterministic rules:
 * 1. Files are normalized and emitted in filePath ASC order.
 * 2. Symbol tokens come from hunk-header tails and are lowercase/deduped/sorted.
 * 3. Ranked files sort by changedLines DESC, hunkCount DESC, filePath ASC.
 * 4. Category count maps are emitted as ordered entry lists, never object key iteration.
 */
export function classifyChangeSurface(diff: DiffCollectionResult): ChangeSurfaceResult {
  const filesByPath = new Map<string, MutableSurfaceFile>();

  for (const filePath of diff.changedFiles) {
    getOrCreateSurfaceFile(filesByPath, filePath);
  }

  for (const hunk of diff.hunks) {
    const file = getOrCreateSurfaceFile(filesByPath, hunk.filePath);
    file.hunkCount += 1;
    file.changedLines += hunk.oldLines + hunk.newLines;

    for (const token of extractHeaderTokens(hunk.header)) {
      file.symbols.add(token);
    }
  }

  const files: ChangeSurfaceFile[] = [...filesByPath.values()]
    .map((entry) => {
      const language = classifyLanguage(entry.filePath);
      return {
        filePath: entry.filePath,
        bucket: classifyBucket(entry.filePath, language),
        scope: classifyScope(entry.filePath),
        language,
        hunkCount: entry.hunkCount,
        changedLines: entry.changedLines,
        symbols: [...entry.symbols].sort(compareStrings),
      };
    })
    .sort((left, right) => compareStrings(left.filePath, right.filePath));

  const rankedFilePaths = [...files]
    .sort((left, right) => {
      return (
        right.changedLines - left.changedLines ||
        right.hunkCount - left.hunkCount ||
        compareStrings(left.filePath, right.filePath)
      );
    })
    .map((file) => file.filePath);

  return {
    files,
    rankedFilePaths,
    bucketCounts: buildBucketCounts(files),
    scopeCounts: buildScopeCounts(files),
    languageCounts: buildLanguageCounts(files),
  };
}
