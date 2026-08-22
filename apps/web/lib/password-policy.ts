/**
 * The rules every path that writes a password shares.
 *
 * They used to be literals repeated in each route, which is how the reset
 * route came to hash at cost 10 while account creation used 12 — a weaker
 * hash on the one flow you reach precisely because you lost access.
 */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * bcrypt work factor. Raising it re-hashes nothing: the cost is stored inside
 * each hash, so passwords written earlier keep verifying at their own cost
 * and move up the next time they are set.
 */
export const BCRYPT_COST = 12;
