// Simple accounts for a handful of testers: username + password checked
// against the users table. A login returns a signed ticket that the browser
// sends with every request; it is verified without any database write.
// Changing a password or disabling a user makes their tickets stop working.

export const ADMIN_ID = "admin";
const ITERATIONS = 10000;
const TICKET_DAYS = 60;
const encoder = new TextEncoder();

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(text) {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text) {
  return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
}

export async function hashPassword(password, salt = toHex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt };
}

function sameText(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
}

// The signing secret lives in the settings table, created on first use.
async function signingKey(env) {
  let secret = (await env.DB.prepare(`SELECT value FROM settings WHERE key = 'auth_secret'`).first())?.value;
  if (!secret) {
    secret = toHex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('auth_secret', ?)`).bind(secret).run();
    secret = (await env.DB.prepare(`SELECT value FROM settings WHERE key = 'auth_secret'`).first()).value;
  }
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env, body) {
  return base64url(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(body)))));
}

// The ticket carries the first characters of the password hash, so a new
// password invalidates every ticket issued before it.
async function issueTicket(env, user) {
  const body = base64url(JSON.stringify({ u: user.id, v: user.password_hash.slice(0, 12), e: Date.now() + TICKET_DAYS * 86400000 }));
  return `${body}.${await sign(env, body)}`;
}

export function userFromRow(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    isAdmin: row.role === "admin",
    // Games a tester may track; empty means any game.
    assignedGames: parseGameList(row.locked_game),
    disabled: Boolean(row.disabled),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null
  };
}

export async function needsSetup(env) {
  return !(await env.DB.prepare(`SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`).first());
}

export function cleanUsername(value) {
  const username = String(value || "").trim();
  if (!/^[A-Za-z0-9_]{2,32}$/.test(username)) {
    throw new AuthError("Username must be 2-32 letters, numbers or _.", 400);
  }
  return username;
}

export function cleanPassword(value) {
  const password = String(value || "");
  if (password.length < 4 || password.length > 200) {
    throw new AuthError("Password must be at least 4 characters.", 400);
  }
  return password;
}

export function parseGameList(value) {
  return [...new Set(String(value ?? "").split(/[\s,]+/).filter(Boolean))];
}

// Accepts an array or "9079, 9084"; stored as a comma-separated list.
export function cleanGameList(value) {
  const games = Array.isArray(value) ? value.map((game) => String(game).trim()).filter(Boolean) : parseGameList(value);
  for (const game of games) {
    if (!/^\d{1,20}$/.test(game)) throw new AuthError(`Game number must be digits only: ${game}`, 400);
  }
  return [...new Set(games)];
}

export async function createUser(env, { id, username, password, role = "tester", assignedGames = [] }) {
  const lockedGame = assignedGames.length ? assignedGames.join(",") : null;
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(`
    INSERT INTO users (id, username, password_hash, salt, role, locked_game, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, username, hash, salt, role, lockedGame, new Date().toISOString()).run();
  return userFromRow(await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first());
}

export async function login(env, username, password) {
  const row = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(String(username || "").trim()).first();
  const { hash } = await hashPassword(String(password || ""), row?.salt || "no-such-user");
  if (!row || !sameText(hash, row.password_hash)) throw new AuthError("Wrong username or password.");
  if (row.disabled) throw new AuthError("This account is switched off. Ask the admin.", 403);
  await env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).bind(new Date().toISOString(), row.id).run();
  return { ticket: await issueTicket(env, row), user: userFromRow(row) };
}

// Who is calling: a login ticket, or the service token (ADMIN_TOKEN) used by
// the GitHub archive job, which acts as the admin. Null when neither.
export async function userFromRequest(env, request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;
  if (env.ADMIN_TOKEN && sameText(token, env.ADMIN_TOKEN)) {
    const admin = await env.DB.prepare(`SELECT * FROM users WHERE role = 'admin' LIMIT 1`).first();
    return admin ? userFromRow(admin) : { id: ADMIN_ID, username: "admin", role: "admin", isAdmin: true, assignedGames: [], disabled: false, service: true };
  }

  const [body, signature] = token.split(".");
  if (!body || !signature || !sameText(signature, await sign(env, body))) return null;
  let claims;
  try {
    claims = JSON.parse(fromBase64url(body));
  } catch {
    return null;
  }
  if (!claims?.u || !(claims.e > Date.now())) return null;
  const row = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(claims.u).first();
  if (!row || row.disabled || row.password_hash.slice(0, 12) !== claims.v) return null;
  return userFromRow(row);
}
