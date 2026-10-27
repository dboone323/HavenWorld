import { type Request, type Response, type NextFunction } from 'express';

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const reqUser = (req as Request & { user?: { userId?: string; id?: string } }).user;
  const errObj = err as { status?: number; statusCode?: number; message?: string } | undefined;

  // Log full error internally for monitoring & debugging
  console.error({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    userId: reqUser?.userId ?? reqUser?.id ?? 'unauthenticated',
    error: err instanceof Error ? err.message : String(err),
    ...(process.env.NODE_ENV !== 'production' && {
      stack: err instanceof Error ? err.stack : undefined,
    }),
  });

  // Never expose implementation details, file paths, or internal stacks to clients
  const statusCode = errObj?.status ?? errObj?.statusCode ?? 500;
  const is500 = statusCode === 500;

  res.status(statusCode).json({
    error: is500 ? 'INTERNAL_SERVER_ERROR' : (errObj?.message ?? 'ERROR'),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'NOT_FOUND',
    path: req.path,
  });
}
