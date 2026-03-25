import type { FileInfo, GrepMatch, WriteResult, EditResult } from '@tdeepagents/schemas';
import type { BackendProtocol } from './protocol.js';

interface FileEntry {
  content: string;
  createdAt: string;
  modifiedAt: string;
}

/**
 * StateBackend — ephemeral in-memory backend.
 * Files stored in a Map. Default backend for quick agent runs.
 * Mirrors the official StateBackend that stores files in LangGraph agent state.
 */
export class StateBackend implements BackendProtocol {
  private files = new Map<string, FileEntry>();

  constructor(initialFiles?: Record<string, { content: string }>) {
    if (initialFiles) {
      const now = new Date().toISOString();
      for (const [path, data] of Object.entries(initialFiles)) {
        this.files.set(this.normalizePath(path), {
          content: data.content,
          createdAt: now,
          modifiedAt: now,
        });
      }
    }
  }

  async lsInfo(path: string): Promise<FileInfo[]> {
    const normalizedPath = this.normalizePath(path);
    const entries: FileInfo[] = [];
    const seen = new Set<string>();

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(normalizedPath)) continue;

      const relative = filePath.slice(normalizedPath.length);
      const parts = relative.split('/').filter(Boolean);

      if (parts.length === 0) continue;

      if (parts.length === 1) {
        // Direct file child
        const file = this.files.get(filePath)!;
        entries.push({
          path: filePath,
          isDir: false,
          size: file.content.length,
          modifiedAt: file.modifiedAt,
        });
      } else {
        // Directory child — show only direct subdirectory
        const dirPath = normalizedPath + parts[0] + '/';
        if (!seen.has(dirPath)) {
          seen.add(dirPath);
          entries.push({ path: dirPath, isDir: true });
        }
      }
    }

    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(filePath: string, offset = 0, limit = 2000): Promise<string> {
    const normalized = this.normalizePath(filePath);
    const file = this.files.get(normalized);
    if (!file) {
      return `Error: File '${filePath}' not found`;
    }

    const lines = file.content.split('\n');
    const sliced = lines.slice(offset, offset + limit);
    return sliced.map((line, i) => `${offset + i + 1}: ${line}`).join('\n');
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    const normalized = this.normalizePath(filePath);

    if (this.files.has(normalized)) {
      return { error: `File '${filePath}' already exists. Use edit to modify it.` };
    }

    const now = new Date().toISOString();
    this.files.set(normalized, { content, createdAt: now, modifiedAt: now });

    return {
      path: normalized,
      filesUpdate: { [normalized]: { content, createdAt: now, modifiedAt: now } },
    };
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): Promise<EditResult> {
    const normalized = this.normalizePath(filePath);
    const file = this.files.get(normalized);

    if (!file) {
      return { error: `File '${filePath}' not found` };
    }

    const occurrences = file.content.split(oldString).length - 1;

    if (occurrences === 0) {
      return { error: `String not found in '${filePath}'` };
    }

    if (occurrences > 1 && !replaceAll) {
      return {
        error: `Multiple occurrences found (${occurrences}). Use replaceAll=true or provide a more specific string.`,
      };
    }

    const newContent = replaceAll
      ? file.content.replaceAll(oldString, newString)
      : file.content.replace(oldString, newString);

    const now = new Date().toISOString();
    file.content = newContent;
    file.modifiedAt = now;

    return {
      path: normalized,
      filesUpdate: { [normalized]: { content: newContent, modifiedAt: now } },
      occurrences: replaceAll ? occurrences : 1,
    };
  }

  async grepRaw(pattern: string, path?: string, glob?: string): Promise<GrepMatch[] | string> {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'g');
    } catch (e: any) {
      return `Invalid regex pattern: ${e.message}`;
    }

    const matches: GrepMatch[] = [];
    const searchPath = path ? this.normalizePath(path) : '/';

    for (const [filePath, file] of this.files.entries()) {
      if (!filePath.startsWith(searchPath)) continue;

      if (glob) {
        const { minimatch } = await import('minimatch');
        if (!minimatch(filePath, glob)) continue;
      }

      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ path: filePath, line: i + 1, text: lines[i] });
        }
        regex.lastIndex = 0; // reset for global regex
      }
    }

    return matches;
  }

  async globInfo(pattern: string, path = '/'): Promise<FileInfo[]> {
    const { minimatch } = await import('minimatch');
    const results: FileInfo[] = [];

    for (const [filePath, file] of this.files.entries()) {
      if (!filePath.startsWith(path)) continue;

      if (minimatch(filePath, pattern) || minimatch(filePath.slice(path.length), pattern)) {
        results.push({
          path: filePath,
          isDir: false,
          size: file.content.length,
          modifiedAt: file.modifiedAt,
        });
      }
    }

    return results;
  }

  /** Access files map (for state serialization) */
  getFiles(): Map<string, FileEntry> {
    return this.files;
  }

  /** Write or overwrite a file (bypass create-only constraint) — used for internal ops */
  writeForce(filePath: string, content: string): void {
    const normalized = this.normalizePath(filePath);
    const now = new Date().toISOString();
    this.files.set(normalized, {
      content,
      createdAt: this.files.get(normalized)?.createdAt ?? now,
      modifiedAt: now,
    });
  }

  private normalizePath(p: string): string {
    if (!p.startsWith('/')) return '/' + p;
    if (!p.endsWith('/') && !p.includes('.') && !this.files.has(p)) {
      // Check if it's a directory path (has children)
      for (const key of this.files.keys()) {
        if (key.startsWith(p + '/')) return p + '/';
      }
    }
    return p;
  }
}
