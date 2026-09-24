import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

// bcrypt ignores everything after 72 bytes, so longer passwords are refused up front
// rather than silently truncated.
export const MAX_PASSWORD_BYTES = 72;

// Passwords are only ever stored as bcrypt hashes (NFR-7).
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
