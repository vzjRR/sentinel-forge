/**
 * Parser for FiveM resource manifests.
 *
 * The manifest format is "semi-declarative Lua": a sequence of statements of the
 * form `directive 'value'`, `directive { 'a', 'b' }`, `directive('value')`, or —
 * for `data_file` — `directive 'TYPE' 'file'`.
 *
 * The parser recognises that shape and nothing more. Real Lua control flow in a
 * manifest is rare and cannot be evaluated without executing it, so a statement
 * the parser does not understand is recorded as unrecognised and skipped, rather
 * than being guessed at or causing the file to be rejected.
 *
 * Directive list verified against
 * https://docs.fivem.net/docs/scripting-reference/resource-manifest/
 */

import { lex, type Token } from './lexer.js';

/** A single declared value, with the position it was declared at. */
export interface ManifestValue {
  readonly value: string;
  readonly line: number;
  readonly column: number;
}

export interface ManifestDirective {
  /** Directive name as written, e.g. `client_scripts`. */
  readonly name: string;
  /** Normalized name: plural and singular forms collapse to one key. */
  readonly key: string;
  readonly values: readonly ManifestValue[];
  readonly line: number;
  readonly column: number;
}

export type ManifestProblemKind =
  | 'UNTERMINATED_STRING'
  | 'UNTERMINATED_COMMENT'
  | 'UNRECOGNISED_STATEMENT'
  | 'EMPTY_DIRECTIVE'
  | 'UNKNOWN_DIRECTIVE';

export interface ManifestProblem {
  readonly kind: ManifestProblemKind;
  readonly message: string;
  readonly line: number;
  readonly column: number;
}

export interface ParsedManifest {
  readonly directives: readonly ManifestDirective[];
  readonly problems: readonly ManifestProblem[];
}

/**
 * Directives whose singular and plural spellings mean the same thing.
 * Both are valid Lua in a manifest and both appear in the wild.
 */
const DIRECTIVE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  client_script: 'client_scripts',
  client_scripts: 'client_scripts',
  server_script: 'server_scripts',
  server_scripts: 'server_scripts',
  shared_script: 'shared_scripts',
  shared_scripts: 'shared_scripts',
  file: 'files',
  files: 'files',
  dependency: 'dependencies',
  dependencies: 'dependencies',
  game: 'games',
  games: 'games',
  provide: 'provides',
  provides: 'provides',
});

/**
 * Directives Sentinel Forge knows about. A directive outside this set is
 * reported as unknown at INFO level only: the manifest format accepts arbitrary
 * metadata keys, and several established frameworks define their own.
 */
export const KNOWN_DIRECTIVES: ReadonlySet<string> = new Set([
  'fx_version',
  'games',
  'client_scripts',
  'server_scripts',
  'shared_scripts',
  'files',
  'ui_page',
  'dependencies',
  'provides',
  'data_file',
  'loadscreen',
  'loadscreen_manual_shutdown',
  'this_is_a_map',
  'server_only',
  'lua54',
  'use_experimental_fxv2_oal',
  'clr_disable_task_scheduler',
  'author',
  'description',
  'version',
  'name',
  'repository',
  'resource_manifest_version',
  'export',
  'exports',
  'server_export',
  'server_exports',
  'replace_level_meta',
  'data_file_extra',
  'before_level_meta',
  'after_level_meta',
  'my_data',
  'escrow_ignore',
  'dependency_check',
  'convar_category',
  'disable_lazy_natives',
]);

/** Directives whose values are file paths or globs, and so may be checked on disk. */
export const FILE_VALUED_DIRECTIVES: ReadonlySet<string> = new Set([
  'client_scripts',
  'server_scripts',
  'shared_scripts',
  'files',
  'ui_page',
  'loadscreen',
]);

export function normalizeDirectiveName(name: string): string {
  return DIRECTIVE_ALIASES[name] ?? name;
}

/**
 * Parses manifest source into directives and problems.
 *
 * The function never throws. A manifest is untrusted input; a parser that can be
 * crashed by it would stop the scan of every other resource on the server.
 */
export function parseManifest(source: string): ParsedManifest {
  const { tokens, diagnostics } = lex(source);
  const directives: ManifestDirective[] = [];
  const problems: ManifestProblem[] = diagnostics.map((diagnostic) => ({
    kind: diagnostic.message.includes('comment')
      ? ('UNTERMINATED_COMMENT' as const)
      : ('UNTERMINATED_STRING' as const),
    message: diagnostic.message,
    line: diagnostic.line,
    column: diagnostic.column,
  }));

  let index = 0;
  const peek = (offset = 0): Token => tokens[index + offset] ?? { type: 'EOF', raw: '', value: '', line: 0, column: 0 };

  /** Skips forward to the next plausible statement start. */
  const recover = (): void => {
    const startLine = peek().line;
    while (peek().type !== 'EOF') {
      index += 1;
      const token = peek();
      if (token.type === 'NAME' && token.line > startLine) return;
      if (token.type === 'EOF') return;
    }
  };

  /** Reads `{ 'a', 'b' }`, returning the string entries it contains. */
  const readTable = (): ManifestValue[] => {
    const values: ManifestValue[] = [];
    index += 1; // consume '{'
    let depth = 1;

    while (peek().type !== 'EOF' && depth > 0) {
      const token = peek();
      if (token.type === 'LBRACE') {
        depth += 1;
        index += 1;
        continue;
      }
      if (token.type === 'RBRACE') {
        depth -= 1;
        index += 1;
        continue;
      }
      if (token.type === 'STRING' && depth === 1) {
        values.push({ value: token.value, line: token.line, column: token.column });
      }
      index += 1;
    }

    return values;
  };

  while (peek().type !== 'EOF') {
    const head = peek();

    if (head.type !== 'NAME') {
      problems.push({
        kind: 'UNRECOGNISED_STATEMENT',
        message: `Unrecognised statement beginning with "${head.raw}". Only declarative manifest directives are analyzed.`,
        line: head.line,
        column: head.column,
      });
      recover();
      continue;
    }

    index += 1;
    const parenthesised = peek().type === 'LPAREN';
    if (parenthesised) index += 1;

    const values: ManifestValue[] = [];

    // A directive takes either a table, or one or more adjacent string literals
    // (`data_file 'TYPE' 'file.meta'`).
    if (peek().type === 'LBRACE') {
      values.push(...readTable());
    } else {
      while (peek().type === 'STRING') {
        const token = peek();
        values.push({ value: token.value, line: token.line, column: token.column });
        index += 1;
        // A concatenation makes the value non-literal; stop rather than
        // reporting half of an expression as if it were the whole path.
        if (peek().type === 'CONCAT') {
          values.pop();
          while (peek().type !== 'EOF' && peek().line === token.line) index += 1;
          break;
        }
        if (peek().type === 'COMMA') index += 1;
      }
    }

    if (parenthesised && peek().type === 'RPAREN') index += 1;
    if (peek().type === 'SEMICOLON') index += 1;

    const key = normalizeDirectiveName(head.value);

    if (values.length === 0) {
      // `name = value` assignments and bare identifiers are not directives.
      if (peek().type === 'EQUALS') {
        recover();
        continue;
      }
      problems.push({
        kind: 'EMPTY_DIRECTIVE',
        message: `Directive "${head.value}" was declared without a value.`,
        line: head.line,
        column: head.column,
      });
      continue;
    }

    if (!KNOWN_DIRECTIVES.has(key)) {
      problems.push({
        kind: 'UNKNOWN_DIRECTIVE',
        message: `Directive "${head.value}" is not recognised. It may be valid but is not analyzed.`,
        line: head.line,
        column: head.column,
      });
    }

    directives.push({ name: head.value, key, values, line: head.line, column: head.column });
  }

  return { directives, problems };
}
