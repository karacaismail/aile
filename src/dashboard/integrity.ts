/** A rejected source is different from a temporary network failure. */
export class BudgetIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetIntegrityError';
  }
}
