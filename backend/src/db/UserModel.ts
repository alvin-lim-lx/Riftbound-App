/**
 * User Model — CRUD operations with bcrypt password hashing.
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from './database';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  username: string;
  createdAt: number;
}

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row['id'] as string,
    username: row['username'] as string,
    passwordHash: row['password_hash'] as string,
    createdAt: row['created_at'] as number,
  };
}

export class UserModel {
  static async create(username: string, password: string): Promise<PublicUser> {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      throw new Error(`Username '${username}' is already taken`);
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const id = `user_${uuidv4()}`;
    const now = Date.now();

    db.prepare(`
      INSERT INTO users (id, username, password_hash, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, username, passwordHash, now);

    return { id, username, createdAt: now };
  }

  static async verifyPassword(username: string, password: string): Promise<User | null> {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;

    const user = rowToUser(row);
    const valid = await bcrypt.compare(password, user.passwordHash);
    return valid ? user : null;
  }

  static findById(id: string): PublicUser | null {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const u = rowToUser(row);
    return { id: u.id, username: u.username, createdAt: u.createdAt };
  }

  static findByUsername(username: string): PublicUser | null {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | Record<string, unknown>
      | undefined;
    if (!row) return null;
    const u = rowToUser(row);
    return { id: u.id, username: u.username, createdAt: u.createdAt };
  }
}
