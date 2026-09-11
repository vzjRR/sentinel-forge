/**
 * The dashboard's view of the analysis context.
 *
 * The scan cache and the recorded-history reader live in
 * `@sentinel-forge/engine`, because the MCP server needs exactly the same two
 * things and a second implementation would be a second set of bugs.
 *
 * What is dashboard-specific is the one fact a page has to display and the
 * engine has no business knowing: the address this process is listening on.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { AnalysisContext, type AnalysisContextOptions } from '@sentinel-forge/engine';

export type { CachedScan, StoredHistory } from '@sentinel-forge/engine';

export interface DashboardContextOptions extends Omit<AnalysisContextOptions, 'command'> {
  /** Address the dashboard is listening on, shown on the settings page. */
  readonly boundTo: string;
}

export class DashboardContext extends AnalysisContext {
  private readonly listeningOn: string;

  constructor(options: DashboardContextOptions) {
    super({ ...options, command: 'dashboard' });
    this.listeningOn = options.boundTo;
  }

  get boundTo(): string {
    return this.listeningOn;
  }
}
