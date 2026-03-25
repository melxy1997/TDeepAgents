import type { FileInfo, GrepMatch, WriteResult, EditResult, ExecuteResult } from '@tdeepagents/schemas';

/**
 * BackendProtocol — the contract every backend must implement.
 * Mirrors the official DeepAgents BackendProtocol.
 */
export interface BackendProtocol {
  /** List directory entries. Sort by path for deterministic output. */
  lsInfo(path: string): Promise<FileInfo[]>;

  /** Read file content. Returns numbered lines. offset/limit for pagination. */
  read(filePath: string, offset?: number, limit?: number): Promise<string>;

  /** Write a new file (create-only). Returns error on conflict. */
  write(filePath: string, content: string): Promise<WriteResult>;

  /** Edit a file by replacing `oldString` with `newString`. */
  edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult>;

  /** Search for regex pattern in files. Returns structured matches or error string. */
  grepRaw(pattern: string, path?: string, glob?: string): Promise<GrepMatch[] | string>;

  /** Find files matching a glob pattern. */
  globInfo(pattern: string, path?: string): Promise<FileInfo[]>;

  /** Execute a shell command (only available on certain backends). */
  execute?(command: string, cwd?: string): Promise<ExecuteResult>;
}
