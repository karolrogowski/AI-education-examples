/**
 * cacheService.js — sessionStorage cache with per-entry TTL.
 *
 * Rules (enforced by callers, not this module):
 *   - Only cache successful responses. Never cache null / error results.
 *   - TTL is set per entry so different data types can have different lifetimes.
 *
 * Storage format per key:
 *   { data: <any JSON-serialisable value>, expiresAt: <unix ms timestamp> }
 */

const PREFIX = 'price_cache_';

/**
 * Read a cached entry. Returns the stored data, or null if missing / expired.
 * Expired entries are removed from storage on read.
 */
export function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, expiresAt } = JSON.parse(raw);
    if (Date.now() > expiresAt) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Write a value to cache with a TTL in milliseconds.
 * Silently skips if sessionStorage is unavailable or full.
 */
export function cacheSet(key, data, ttlMs) {
  try {
    sessionStorage.setItem(
      PREFIX + key,
      JSON.stringify({ data, expiresAt: Date.now() + ttlMs }),
    );
  } catch {
    // Storage quota exceeded or unavailable — degrade gracefully
  }
}