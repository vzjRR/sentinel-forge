#!/usr/bin/env node
/**
 * `sentinel` executable.
 *
 * Keeps process concerns — argv slicing, warning routing, exit — out of `run`,
 * which stays a pure function of its inputs so it can be tested in-process.
 *
 * © 2026 Talal Al Ghafri. All Rights Reserved.
 */

import { run } from '../run.js';

/**
 * Node prints an ExperimentalWarning the first time `node:sqlite` is used.
 * The warning is expected and documented (docs/COMPATIBILITY.md); printing it
 * on every invocation would train operators to ignore warnings. Every other
 * warning is still shown.
 */
function routeExpectedWarnings(): void {
  const defaultListeners = process.listeners('warning');
  process.removeAllListeners('warning');
  process.on('warning', (warning: Error) => {
    if (warning.name === 'ExperimentalWarning' && warning.message.includes('SQLite')) return;
    for (const listener of defaultListeners) {
      listener(warning);
    }
  });
}

routeExpectedWarnings();

const exitCode = await run({ argv: process.argv.slice(2) });
process.exitCode = exitCode;
