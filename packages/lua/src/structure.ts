/**
 * Lua block structure.
 *
 * Rules such as "this loop never yields" need to know where a loop body starts
 * and ends. Deriving that from a full syntax tree would mean writing a complete
 * Lua parser; deriving it from block delimiters is enough for the questions the
 * diagnostic rules actually ask, and it degrades gracefully on source it cannot
 * fully understand.
 *
 * The trade-off is stated openly rather than hidden: this is a block model, not
 * a parse tree. It knows which tokens are inside a loop body. It does not know
 * types, scopes, or what a variable holds. Every rule built on it documents the
 * false positives that follow from that limit.
 */

import type { LuaToken } from './lexer.js';

export type BlockKind = 'DO' | 'THEN' | 'ELSE' | 'FUNCTION' | 'REPEAT';

export interface Block {
  readonly kind: BlockKind;
  /** Token index of the keyword that opened the block. */
  readonly openIndex: number;
  /** Token index of the keyword that closed it, or -1 when unterminated. */
  readonly closeIndex: number;
  /** Nesting depth, 0 for a top-level block. */
  readonly depth: number;
}

export type LoopKind = 'WHILE' | 'FOR' | 'REPEAT';

export interface Loop {
  readonly kind: LoopKind;
  /** Token index of `while`, `for` or `repeat`. */
  readonly keywordIndex: number;
  readonly line: number;
  readonly column: number;
  /** First token index inside the body. */
  readonly bodyStart: number;
  /** Last token index inside the body, exclusive. */
  readonly bodyEnd: number;
  /**
   * Condition tokens for `while` and `repeat`, empty for `for`.
   * Used to distinguish a bounded loop from a continuous one.
   */
  readonly conditionTokens: readonly LuaToken[];
  /** Loop nesting depth, 0 for an outermost loop. */
  readonly depth: number;
  /** True when the block was never closed, so the body range is a best effort. */
  readonly unterminated: boolean;
}

export interface StructureResult {
  readonly blocks: readonly Block[];
  readonly loops: readonly Loop[];
  /** True when block delimiters did not balance, so ranges are approximate. */
  readonly unbalanced: boolean;
}

interface OpenBlock {
  readonly kind: BlockKind;
  readonly openIndex: number;
  readonly depth: number;
  /** Set when this block is a loop body, so the loop can be completed on close. */
  readonly loop?: { kind: LoopKind; keywordIndex: number; conditionTokens: LuaToken[]; depth: number };
}

/**
 * Derives block and loop structure from a token stream.
 *
 * `elseif` and `else` are treated as closing the current branch and opening the
 * next, which keeps the stack balanced across an if/elseif/else chain without
 * needing to model the chain itself.
 */
export function analyzeStructure(tokens: readonly LuaToken[]): StructureResult {
  const blocks: Block[] = [];
  const loops: Loop[] = [];
  const stack: OpenBlock[] = [];
  let unbalanced = false;
  let loopDepth = 0;

  /** Pending loop keyword awaiting its `do`, e.g. `while cond do`. */
  let pendingLoop: { kind: LoopKind; keywordIndex: number; conditionTokens: LuaToken[] } | null = null;

  const closeBlock = (closeIndex: number): OpenBlock | undefined => {
    const open = stack.pop();
    if (open === undefined) {
      unbalanced = true;
      return undefined;
    }
    blocks.push({ kind: open.kind, openIndex: open.openIndex, closeIndex, depth: open.depth });
    if (open.loop !== undefined) {
      loopDepth = Math.max(0, loopDepth - 1);
      loops.push({
        kind: open.loop.kind,
        keywordIndex: open.loop.keywordIndex,
        line: tokens[open.loop.keywordIndex]?.line ?? 0,
        column: tokens[open.loop.keywordIndex]?.column ?? 0,
        bodyStart: open.openIndex + 1,
        bodyEnd: closeIndex,
        conditionTokens: open.loop.conditionTokens,
        depth: open.loop.depth,
        unterminated: false,
      });
    }
    return open;
  };

  for (const token of tokens) {
    if (token.type !== 'KEYWORD') {
      if (pendingLoop !== null) pendingLoop.conditionTokens.push(token);
      continue;
    }

    switch (token.value) {
      case 'while':
      case 'for':
        pendingLoop = { kind: token.value === 'while' ? 'WHILE' : 'FOR', keywordIndex: token.index, conditionTokens: [] };
        break;

      case 'repeat': {
        // `repeat` opens its own body directly; the condition follows `until`.
        stack.push({
          kind: 'REPEAT',
          openIndex: token.index,
          depth: stack.length,
          loop: { kind: 'REPEAT', keywordIndex: token.index, conditionTokens: [], depth: loopDepth },
        });
        loopDepth += 1;
        break;
      }

      case 'do': {
        const loop = pendingLoop;
        pendingLoop = null;
        stack.push({
          kind: 'DO',
          openIndex: token.index,
          depth: stack.length,
          ...(loop === null
            ? {}
            : { loop: { kind: loop.kind, keywordIndex: loop.keywordIndex, conditionTokens: loop.conditionTokens, depth: loopDepth } }),
        });
        if (loop !== null) loopDepth += 1;
        break;
      }

      case 'then':
        pendingLoop = null;
        stack.push({ kind: 'THEN', openIndex: token.index, depth: stack.length });
        break;

      case 'elseif':
        // Closes the previous branch; its own `then` opens the next.
        closeBlock(token.index);
        break;

      case 'else':
        closeBlock(token.index);
        stack.push({ kind: 'ELSE', openIndex: token.index, depth: stack.length });
        break;

      case 'function':
        pendingLoop = null;
        stack.push({ kind: 'FUNCTION', openIndex: token.index, depth: stack.length });
        break;

      case 'end':
        closeBlock(token.index);
        break;

      case 'until':
        closeBlock(token.index);
        break;

      default:
        if (pendingLoop !== null) pendingLoop.conditionTokens.push(token);
        break;
    }
  }

  // Anything still open means the source did not balance. The ranges are kept,
  // running to end of file, and flagged so rules can lower their confidence.
  while (stack.length > 0) {
    unbalanced = true;
    const open = stack.pop();
    if (open === undefined) break;
    blocks.push({ kind: open.kind, openIndex: open.openIndex, closeIndex: -1, depth: open.depth });
    if (open.loop !== undefined) {
      loops.push({
        kind: open.loop.kind,
        keywordIndex: open.loop.keywordIndex,
        line: tokens[open.loop.keywordIndex]?.line ?? 0,
        column: tokens[open.loop.keywordIndex]?.column ?? 0,
        bodyStart: open.openIndex + 1,
        bodyEnd: tokens.length - 1,
        conditionTokens: open.loop.conditionTokens,
        depth: open.loop.depth,
        unterminated: true,
      });
    }
  }

  loops.sort((a, b) => a.keywordIndex - b.keywordIndex);
  blocks.sort((a, b) => a.openIndex - b.openIndex);

  return { blocks, loops, unbalanced };
}

/**
 * True when a `while`/`repeat` condition is a constant that never ends the loop
 * (`while true`, `while 1`, `repeat … until false`).
 *
 * A loop with a real condition is not continuous: it terminates when the
 * condition changes, so "no yield in the body" is not by itself a defect there.
 */
export function isContinuousCondition(kind: LoopKind, conditionTokens: readonly LuaToken[]): boolean {
  const meaningful = conditionTokens.filter((token) => token.type !== 'EOF');
  if (kind === 'FOR') return false;
  if (meaningful.length !== 1) return false;

  const only = meaningful[0];
  if (only === undefined) return false;
  if (kind === 'WHILE') return only.value === 'true' || only.value === '1';
  return false;
}

/** Tokens inside a loop body, as a slice of the token array. */
export function bodyTokens(tokens: readonly LuaToken[], loop: Loop): readonly LuaToken[] {
  return tokens.slice(loop.bodyStart, Math.max(loop.bodyStart, loop.bodyEnd));
}

/**
 * The innermost loop whose body contains `tokenIndex`, or `undefined`.
 *
 * The range is inclusive of `bodyStart`: the first token inside a loop body is
 * in the loop, which is exactly where a per-iteration call tends to sit.
 */
export function enclosingLoop(loops: readonly Loop[], tokenIndex: number): Loop | undefined {
  let innermost: Loop | undefined;
  for (const loop of loops) {
    if (tokenIndex < loop.bodyStart || tokenIndex >= loop.bodyEnd) continue;
    if (innermost === undefined || loop.bodyStart > innermost.bodyStart) innermost = loop;
  }
  return innermost;
}
