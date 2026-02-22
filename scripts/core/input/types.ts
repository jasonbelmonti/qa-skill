export interface NormalizeOptions {
  cwd?: string;
  resolveRealpath?: (path: string) => Promise<string>;
  getOriginRemoteUrl?: (repoRoot: string) => Promise<string | null>;
}
