const fs = require('fs');
const path = require('path');

const USE_PG = !!process.env.DATABASE_URL;

// ============== PostgreSQL backend ==============
let pool;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
}

// ============== JSON file backend ==============
const DATA_DIR = path.join(__dirname, 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return fallback; }
}

function writeJson(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============== Unified interface ==============

async function initDb() {
  if (USE_PG) {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS players (
          id UUID PRIMARY KEY,
          role_id TEXT NOT NULL,
          role_name TEXT NOT NULL,
          server_id TEXT NOT NULL DEFAULT '2',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(role_id, server_id)
        )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS history (
          id UUID PRIMARY KEY,
          code TEXT NOT NULL,
          timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          total_players INT NOT NULL DEFAULT 0,
          success_count INT NOT NULL DEFAULT 0,
          fail_count INT NOT NULL DEFAULT 0,
          results JSONB NOT NULL DEFAULT '[]'
        )
      `);
      console.log('✅ PostgreSQL tables initialized');
    } finally {
      client.release();
    }
  } else {
    ensureDataDir();
    console.log('📁 Using JSON file storage (no DATABASE_URL)');
  }
}

// ============== PLAYERS ==============

async function loadPlayers() {
  if (USE_PG) {
    const { rows } = await pool.query(
      'SELECT id, role_id AS "roleId", role_name AS "roleName", server_id AS "serverId", created_at AS "createdAt" FROM players ORDER BY created_at ASC'
    );
    return rows;
  }
  return readJson(PLAYERS_FILE);
}

async function addPlayer({ id, roleId, roleName, serverId }) {
  if (USE_PG) {
    const { rows } = await pool.query(
      `INSERT INTO players (id, role_id, role_name, server_id, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, role_id AS "roleId", role_name AS "roleName", server_id AS "serverId", created_at AS "createdAt"`,
      [id, roleId, roleName, serverId]
    );
    return rows[0];
  }
  const players = readJson(PLAYERS_FILE);
  const player = { id, roleId, roleName, serverId, createdAt: new Date().toISOString() };
  players.push(player);
  writeJson(PLAYERS_FILE, players);
  return player;
}

async function deletePlayer(id) {
  if (USE_PG) {
    const { rowCount } = await pool.query('DELETE FROM players WHERE id = $1', [id]);
    return rowCount > 0;
  }
  const players = readJson(PLAYERS_FILE);
  const filtered = players.filter(p => p.id !== id);
  if (filtered.length === players.length) return false;
  writeJson(PLAYERS_FILE, filtered);
  return true;
}

async function findPlayer(roleId, serverId) {
  if (USE_PG) {
    const { rows } = await pool.query(
      'SELECT id FROM players WHERE role_id = $1 AND server_id = $2',
      [roleId, serverId]
    );
    return rows[0] || null;
  }
  const players = readJson(PLAYERS_FILE);
  return players.find(p => p.roleId === roleId && p.serverId === serverId) || null;
}

// ============== HISTORY ==============

async function loadHistory() {
  if (USE_PG) {
    const { rows } = await pool.query(
      `SELECT id, code, timestamp, total_players AS "totalPlayers",
              success_count AS "successCount", fail_count AS "failCount", results
       FROM history ORDER BY timestamp DESC LIMIT 100`
    );
    return rows;
  }
  return readJson(HISTORY_FILE);
}

async function addHistory({ id, code, totalPlayers, successCount, failCount, results }) {
  if (USE_PG) {
    await pool.query(
      `INSERT INTO history (id, code, timestamp, total_players, success_count, fail_count, results)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
      [id, code, totalPlayers, successCount, failCount, JSON.stringify(results)]
    );
    return;
  }
  const history = readJson(HISTORY_FILE);
  history.unshift({ id, code, timestamp: new Date().toISOString(), totalPlayers, successCount, failCount, results });
  if (history.length > 100) history.length = 100;
  writeJson(HISTORY_FILE, history);
}

async function clearHistory() {
  if (USE_PG) {
    await pool.query('DELETE FROM history');
    return;
  }
  writeJson(HISTORY_FILE, []);
}

module.exports = {
  pool,
  initDb,
  loadPlayers,
  addPlayer,
  deletePlayer,
  findPlayer,
  loadHistory,
  addHistory,
  clearHistory
};
