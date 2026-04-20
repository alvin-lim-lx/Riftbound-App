/**
 * JWT Authentication Middleware
 * Verifies Bearer token and attaches decoded payload to req.user.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET ?? 'riftbound-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

export interface JwtPayload {
  userId: string;
  username: string;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/** Middleware: requires a valid JWT. Returns 401 if missing/invalid. */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = header.slice('Bearer '.length);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Token expired or invalid' });
    return;
  }

  req.user = payload;
  next();
}

/** Middleware: accepts a valid JWT if present, but does not require it. */
export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  const header = req.headers['authorization'];
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}
