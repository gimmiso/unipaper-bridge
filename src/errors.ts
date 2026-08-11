export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserInputError";
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class UpstreamError extends Error {
  readonly service: string;
  readonly status: number | undefined;

  constructor(service: string, message: string, status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.service = service;
    this.status = status;
  }
}

export function publicErrorMessage(error: unknown): string {
  if (
    error instanceof UserInputError ||
    error instanceof ConfigurationError ||
    error instanceof UpstreamError
  ) {
    return error.message;
  }

  return "The request could not be completed. Check the input and try again.";
}
