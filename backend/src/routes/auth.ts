/**
 * Authentication Routes — /api/auth/*
 * Handles user registration, login, and token refresh.
 */

import { Router, Request, Response } from 'express';
import { UserModel } from '../db/UserModel';
import { signToken, requireAuth, AuthenticatedRequest } from '../middleware/auth';

export function createAuthRouter(): Router {
  const router = Router();

  // POST /api/auth/register
  router.post('/register', async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    if (typeof username !== 'string' || username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    try {
      const user = await UserModel.create(username, password);
      const token = signToken({ userId: user.id, username: user.username });
      return res.status(201).json({ user, token });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('already taken')) {
        return res.status(409).json({ error: message });
      }
      return res.status(500).json({ error: 'Registration failed' });
    }
  });

  // POST /api/auth/login
  router.post('/login', async (req: Request, res: Response) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    try {
      const user = await UserModel.verifyPassword(username, password);
      if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      const token = signToken({ userId: user.id, username: user.username });
      return res.json({
        user: { id: user.id, username: user.username, createdAt: user.createdAt },
        token,
      });
    } catch (err: unknown) {
      return res.status(500).json({ error: 'Login failed' });
    }
  });

  // GET /api/auth/me — return current user from token
  router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = UserModel.findById(req.user!.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({ user });
  });

  // POST /api/auth/refresh — issue a new token from a valid existing token
  router.post('/refresh', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const user = UserModel.findById(req.user!.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const newToken = signToken({ userId: user.id, username: user.username });
    return res.json({ token: newToken });
  });

  return router;
}
