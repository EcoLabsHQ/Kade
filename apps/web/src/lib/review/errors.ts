/**
 * Errors for the Admin review write path.
 *
 * Kept out of the `'use server'` action module: Next.js only permits async
 * function exports from a `'use server'` file, and these are classes.
 */

export class NotAReviewerError extends Error {
  constructor() {
    super('This account is not a reviewer.');
    this.name = 'NotAReviewerError';
  }
}

export class InvalidReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidReviewError';
  }
}
