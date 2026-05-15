export class LyricalContextError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 500) {
    super(message);
    this.name = "LyricalContextError";
    this.code = code;
    this.status = status;
  }
}

export function toPublicError(error: unknown) {
  if (error instanceof LyricalContextError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
        },
      },
    };
  }

  const developmentMessage =
    process.env.NODE_ENV === "development" && error instanceof Error
      ? error.message
      : null;

  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message:
          developmentMessage ?? "Something went wrong while loading references.",
      },
    },
  };
}
