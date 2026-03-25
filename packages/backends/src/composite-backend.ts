import type { FileInfo, GrepMatch, WriteResult, EditResult, ExecuteResult } from '@tdeepagents/schemas';
import type { BackendProtocol } from './protocol.js';

/**
 * CompositeBackend — routes file operations to different backends based on path prefix.
 *
 * Example:
 *   new CompositeBackend({
 *     default: stateBackend,
 *     routes: { '/memories/': storeBackend }
 *   })
 */
export class CompositeBackend implements BackendProtocol {
  private defaultBackend: BackendProtocol;
  private routes: Array<{ prefix: string; backend: BackendProtocol }>;

  constructor(options: { default: BackendProtocol; routes?: Record<string, BackendProtocol> }) {
    this.defaultBackend = options.default;
    this.routes = Object.entries(options.routes ?? {})
      .map(([prefix, backend]) => ({ prefix, backend }))
      .sort((a, b) => b.prefix.length - a.prefix.length); // longest prefix first
  }

  private getBackend(path: string): BackendProtocol {
    for (const route of this.routes) {
      if (path.startsWith(route.prefix)) {
        return route.backend;
      }
    }
    return this.defaultBackend;
  }

  async lsInfo(path: string): Promise<FileInfo[]> {
    return this.getBackend(path).lsInfo(path);
  }

  async read(filePath: string, offset?: number, limit?: number): Promise<string> {
    return this.getBackend(filePath).read(filePath, offset, limit);
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    return this.getBackend(filePath).write(filePath, content);
  }

  async edit(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll?: boolean,
  ): Promise<EditResult> {
    return this.getBackend(filePath).edit(filePath, oldString, newString, replaceAll);
  }

  async grepRaw(pattern: string, path?: string, glob?: string): Promise<GrepMatch[] | string> {
    // Search across all backends and merge results
    const results: GrepMatch[] = [];
    const searched = new Set<BackendProtocol>();

    const defaultResult = await this.defaultBackend.grepRaw(pattern, path, glob);
    if (typeof defaultResult === 'string') return defaultResult;
    results.push(...defaultResult);
    searched.add(this.defaultBackend);

    for (const route of this.routes) {
      if (searched.has(route.backend)) continue;
      searched.add(route.backend);
      const routeResult = await route.backend.grepRaw(pattern, path ?? route.prefix, glob);
      if (Array.isArray(routeResult)) {
        results.push(...routeResult);
      }
    }

    return results;
  }

  async globInfo(pattern: string, path?: string): Promise<FileInfo[]> {
    const results: FileInfo[] = [];
    const searched = new Set<BackendProtocol>();

    results.push(...(await this.defaultBackend.globInfo(pattern, path)));
    searched.add(this.defaultBackend);

    for (const route of this.routes) {
      if (searched.has(route.backend)) continue;
      searched.add(route.backend);
      results.push(...(await route.backend.globInfo(pattern, path ?? route.prefix)));
    }

    return results;
  }

  async execute(command: string, cwd?: string): Promise<ExecuteResult> {
    // Execute on default backend if it supports it
    if (this.defaultBackend.execute) {
      return this.defaultBackend.execute(command, cwd);
    }
    return { stdout: '', stderr: 'No backend supports execute', exitCode: 1 };
  }
}
