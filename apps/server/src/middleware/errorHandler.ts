import { type Request, type Response, type NextFunction } from 'express';

export function globalErrorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log full error internally for monitoring & debugging
  console.error({
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    userId: (req as any).user?.userId ?? (req as any).user?.id ?? 'unauthenticated',
    error: err instanceof Error ? err.message : String(err),
    ...(process.env.NODE_ENV !== 'production' && {
      stack: err instanceof Error ? err.stack : undefined,
    }),
  });

  // Never expose implementation details, file paths, or internal stacks to clients
  const statusCode = (err as any)?.status ?? (err as any)?.statusCode ?? 500;
  const is500 = statusCode === 500;

  res.status(statusCode).json({
    error: is500 ? 'INTERNAL_SERVER_ERROR' : ((err as any)?.message ?? 'ERROR'),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'NOT_FOUND',
    path: req.path,
  });
}
