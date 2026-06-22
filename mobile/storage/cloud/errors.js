export class CloudNotImplementedError extends Error {
  constructor(method) {
    super(
      `Cloud storage adapter is not implemented yet (method: ${method}). ` +
        'Weight entries and workout notes sync; other domains land later.'
    );
    this.name = 'CloudNotImplementedError';
    this.method = method;
  }
}

export class BootstrapError extends Error {
  constructor(message, { step, cause } = {}) {
    super(message);
    this.name = 'BootstrapError';
    this.step = step;
    if (cause) this.cause = cause;
  }
}
