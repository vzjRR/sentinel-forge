/**
 * CLI exit-code contract.
 *
 * Exit codes are a stable automation surface. They are documented in
 * docs/CLI.md § Exit codes and must not be redefined without a major version
 * bump.
 */

export const EXIT_CODES = {
  /** Completed successfully with no findings above the configured threshold. */
  SUCCESS: 0,
  /** Completed successfully; findings were reported. Not an error. */
  FINDINGS: 1,
  /**
   * The request could not be carried out as given: invalid arguments, invalid
   * configuration, an unreadable server path, or an operation that this build
   * does not provide.
   */
  INVALID_INPUT: 2,
  /** An unexpected internal error. Always accompanied by an error id. */
  INTERNAL_ERROR: 3,
  /**
   * A security-sensitive failure: a path escaped the permitted root, an
   * integrity check failed, or redaction could not be guaranteed.
   */
  SECURITY_FAILURE: 4,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const EXIT_CODE_DESCRIPTIONS: Readonly<Record<ExitCode, string>> = Object.freeze({
  0: 'Success — no findings above the configured threshold.',
  1: 'Findings detected — the command completed and reported findings.',
  2: 'Invalid input, invalid configuration, or an operation this build does not provide.',
  3: 'Internal error — an unexpected failure; an error id is included in the output.',
  4: 'Security-sensitive failure — the operation was stopped to avoid an unsafe action.',
});

export function describeExitCode(code: ExitCode): string {
  return EXIT_CODE_DESCRIPTIONS[code];
}
