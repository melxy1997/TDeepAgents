import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { FileInfo, GrepMatch, WriteResult, EditResult, ExecuteResult } from '@tdeepagents/schemas';
import type { BackendProtocol } from './protocol.js';

const execAsync = promisify(exec);

/**
 * FilesystemBackend — reads/writes real files on local disk.
 *
 * Options:
 * - rootDir: base directory for all operations
 * - virtualMode: if true, sandboxes paths (blocks .., ~, absolute paths outside root)
 * - enableExecute: if true, allows shell command execution
 */
export class FilesystemBackend implements BackendProtocol {
  private rootDir: string;
  private virtualMode: boolean;
  private enableExecute: boolean;

  constructor(options: { rootDir: string; virtualMode?: boolean; enableExecute?: boolean }) {
    this.rootDir = path.resolve(options.rootDir);
    this.virtualMode = options.virtualMode ?? false;
    this.enableExecute = options.enableExecute ?? true;
  }

  async lsInfo(dirPath: string): Promise<FileInfo[]> {
    const resolved = this.resolvePath(dirPath);
    try {
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      const results: FileInfo[] = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // skip hidden files by default
        const fullPath = path.join(resolved, entry.name);
        try {
          const stat = await fs.stat(fullPath);
          results.push({
            path: this.toVirtualPath(fullPath),
            isDir: entry.isDirectory(),
            size: entry.isFile() ? stat.size : undefined,
            modifiedAt: stat.mtime.toISOString(),
          });
        } catch {
          results.push({
            path: this.toVirtualPath(fullPath),
            isDir: entry.isDirectory(),
          });
        }
      }

      return results.sort((a, b) => a.path.localeCompare(b.path));
    } catch {
      return [];
    }
  }

  async read(filePath: string, offset = 0, limit = 2000): Promise<string> {
    const resolved = this.resolvePath(filePath);
    try {
      const content = await fs.readFile(resolved, 'utf-8');
      const lines = content.split('\n');
      const sliced = lines.slice(offset, offset + limit);
      return sliced.map((line, i) => `${offset + i + 1}: ${line}`).join('\n');
    } catch {
      return `Error: File '${filePath}' not found`;
    }
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    const resolved = this.resolvePath(filePath);
    try {
      await fs.access(resolved);
      return { error: `File '${filePath}' already exists. Use edit to modify it.` };
    } catch {
      // File doesn't exist — good, create it
    }

    try {
      await fs.mkdir(path.dirname(resolved), { recursive: true });
      await fs.writeFile(resolved, content, 'utf-8');
      return { path: this.toVirtualPath(resolved) };
    } catch (e: any) {
      return { error: `Failed to write '${filePath}': ${e.message}` };
    }
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<EditResult> {
    const resolved = this.resolvePath(filePath);
    let content: string;
    try {
      content = await fs.readFile(resolved, 'utf-8');
    } catch {
      return { error: `File '${filePath}' not found` };
    }

    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      return { error: `String not found in '${filePath}'` };
    }
    if (occurrences > 1 && !replaceAll) {
      return {
        error: `Multiple occurrences found (${occurrences}). Use replaceAll=true or provide a more specific string.`,
      };
    }

    const newContent = replaceAll
      ? content.replaceAll(oldString, newString)
      : content.replace(oldString, newString);

    await fs.writeFile(resolved, newContent, 'utf-8');
    return {
      path: this.toVirtualPath(resolved),
      occurrences: replaceAll ? occurrences : 1,
    };
  }

  async grepRaw(pattern: string, searchPath?: string, glob?: string): Promise<GrepMatch[] | string> {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'g');
    } catch (e: any) {
      return `Invalid regex pattern: ${e.message}`;
    }

    const dir = searchPath ? this.resolvePath(searchPath) : this.rootDir;
    const matches: GrepMatch[] = [];

    const walkAndGrep = async (currentDir: string) => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walkAndGrep(fullPath);
          } else if (entry.isFile()) {
            if (glob) {
              const { minimatch } = await import('minimatch');
              if (!minimatch(entry.name, glob) && !minimatch(fullPath, glob)) continue;
            }
            try {
              const content = await fs.readFile(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                  matches.push({
                    path: this.toVirtualPath(fullPath),
                    line: i + 1,
                    text: lines[i],
                  });
                }
                regex.lastIndex = 0;
              }
            } catch {
              // skip binary files
            }
          }
        }
      } catch {
        // skip inaccessible dirs
      }
    };

    await walkAndGrep(dir);
    return matches;
  }

  async globInfo(pattern: string, searchPath = '/'): Promise<FileInfo[]> {
    const { minimatch } = await import('minimatch');
    const dir = this.resolvePath(searchPath);
    const results: FileInfo[] = [];

    const walk = async (currentDir: string) => {
      try {
        const entries = await fs.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const fullPath = path.join(currentDir, entry.name);
          const virtualPath = this.toVirtualPath(fullPath);

          if (entry.isDirectory()) {
            await walk(fullPath);
          }

          if (minimatch(virtualPath, pattern) || minimatch(entry.name, pattern)) {
            try {
              const stat = await fs.stat(fullPath);
              results.push({
                path: virtualPath,
                isDir: entry.isDirectory(),
                size: entry.isFile() ? stat.size : undefined,
                modifiedAt: stat.mtime.toISOString(),
              });
            } catch {
              results.push({ path: virtualPath, isDir: entry.isDirectory() });
            }
          }
        }
      } catch {
        // skip
      }
    };

    await walk(dir);
    return results;
  }

  async execute(command: string, cwd?: string): Promise<ExecuteResult> {
    if (!this.enableExecute) {
      return { stdout: '', stderr: 'Execute is disabled on this backend', exitCode: 1 };
    }

    const execCwd = cwd ? this.resolvePath(cwd) : this.rootDir;
    const MAX_OUTPUT = 100_000;

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: execCwd,
        timeout: 60_000,
        maxBuffer: MAX_OUTPUT * 2,
      });

      const truncatedStdout = stdout.length > MAX_OUTPUT;
      const truncatedStderr = stderr.length > MAX_OUTPUT;

      return {
        stdout: truncatedStdout ? stdout.slice(0, MAX_OUTPUT) : stdout,
        stderr: truncatedStderr ? stderr.slice(0, MAX_OUTPUT) : stderr,
        exitCode: 0,
        truncated: truncatedStdout || truncatedStderr,
      };
    } catch (e: any) {
      return {
        stdout: (e.stdout ?? '').slice(0, MAX_OUTPUT),
        stderr: (e.stderr ?? e.message ?? '').slice(0, MAX_OUTPUT),
        exitCode: e.code ?? 1,
      };
    }
  }

  // ─── Path Helpers ─────────────────────────────────────────────────

  private resolvePath(p: string): string {
    if (this.virtualMode) {
      // Sandbox: block .., ~, and absolute paths outside root
      const cleaned = p.replace(/\.\./g, '').replace(/~/g, '');
      return path.resolve(this.rootDir, cleaned.startsWith('/') ? cleaned.slice(1) : cleaned);
    }

    if (path.isAbsolute(p)) return p;
    return path.resolve(this.rootDir, p);
  }

  private toVirtualPath(absPath: string): string {
    if (absPath.startsWith(this.rootDir)) {
      const relative = absPath.slice(this.rootDir.length);
      return relative.startsWith('/') ? relative : '/' + relative;
    }
    return absPath;
  }
}
