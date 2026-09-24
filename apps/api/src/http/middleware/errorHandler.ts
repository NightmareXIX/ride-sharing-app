import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, type ErrorBody } from '../errors.js';

// Errors raised by express.json() carry a `type`; see the body-parser docs.
interface BodyParserError extends Error {
  type: string;
  status: number;
}

function isBodyParserError(err: unknown): err is BodyParserError {
  return err instanceof Error && typeof (err as Partial<BodyParserError>).type === 'string';
}

function toResponse(err: unknown): { status: number; body: ErrorBody } {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined && { details: err.details }),
        },
      },
    };
  }

  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Some fields are missing or invalid.',
          details: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
    };
  }

  if (isBodyParserError(err) && err.status < 500) {
    const message =
      err.type === 'entity.parse.failed'
        ? 'The request body is not valid JSON.'
        : err.type === 'entity.too.large'
          ? 'The request body is too large.'
          : 'The request body could not be read.';
    return { status: 400, body: { error: { code: 'VALIDATION_ERROR', message } } };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
      },
    },
  };
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ErrorBody = {
    error: { code: 'NOT_FOUND', message: 'This route does not exist.' },
  };
  res.status(404).json(body);
};

// Last middleware in the chain: every error leaves the API in the same envelope, and
// internal details stay in the logs rather than the response.
export const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, body } = toResponse(err);
  if (status >= 500) {
    // pino-http picks this up and logs the request at error level with the stack.
    res.err = err instanceof Error ? err : new Error(String(err));
  }
  res.status(status).json(body);
};
