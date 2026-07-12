export class DataLayerError extends Error {
  override readonly name = 'DataLayerError';

  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(`Supabase operation failed: ${operation}`, { cause });
  }
}

export class UnauthenticatedError extends Error {
  override readonly name = 'UnauthenticatedError';

  constructor() {
    super('Authentication is required');
  }
}

export class InvalidStoragePathError extends Error {
  override readonly name = 'InvalidStoragePathError';

  constructor(readonly value: string) {
    super(`Invalid pitch media path component: ${value}`);
  }
}

export class InvalidDraftUpdateError extends Error {
  override readonly name = 'InvalidDraftUpdateError';

  constructor() {
    super('At least one editable draft field is required');
  }
}
