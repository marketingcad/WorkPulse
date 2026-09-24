/**
 * Domain errors carry a stable machine code and a category that the HTTP layer
 * maps to a status code. Messages are safe to show to end users.
 */
export type ErrorCategory =
  | 'validation' // 400
  | 'unauthenticated' // 401
  | 'forbidden' // 403
  | 'not_found' // 404
  | 'conflict' // 409
  | 'business_rule' // 422
  | 'rate_limited'; // 429

export class DomainError extends Error {
  constructor(
    public readonly category: ErrorCategory,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const notFound = (resource: string) =>
  new DomainError('not_found', `${resource}_not_found`, `${resource.replace(/_/g, ' ')} not found`);

export const forbidden = (message = 'You do not have permission to perform this action') =>
  new DomainError('forbidden', 'forbidden', message);

export const conflict = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError('conflict', code, message, details);

export const businessRule = (code: string, message: string, details?: Record<string, unknown>) =>
  new DomainError('business_rule', code, message, details);

export const validation = (message: string, details?: Record<string, unknown>) =>
  new DomainError('validation', 'validation_error', message, details);
