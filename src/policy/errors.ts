/** One problem with a policy: where it is, and what is wrong. */
export type AtsPolicyIssue = {
  /** Dotted path to the offending field, e.g. `rules.3.weight`. */
  path: string;
  message: string;
};

/**
 * Raised when a policy or locale pack fails the schema, or a call names a region, language or
 * target ATS the policy does not have. `issues` stays structured so the host decides what to log.
 */
export class AtsPolicyError extends Error {
  readonly issues: AtsPolicyIssue[];

  constructor(message: string, issues: AtsPolicyIssue[]) {
    super(message);
    this.name = "AtsPolicyError";
    this.issues = issues;

    Object.setPrototypeOf(this, new.target.prototype);

    // V8 only; typed locally because the package compiles without Node's lib.
    const capture = (Error as unknown as { captureStackTrace?: (t: object, c: unknown) => void })
      .captureStackTrace;
    if (capture) capture(this, this.constructor);
  }
}
