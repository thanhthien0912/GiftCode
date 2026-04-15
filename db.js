const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDb() {
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

    console.log('✅ Database tables initialized');
  } finally {
    client.release();
  }
}

// ============== PLAYERS ==============

async function loadPlayers() {
  const { rows } = await pool.query(
    'SELECT id, role_id AS "roleId", role_name AS "roleName", server_id AS "serverId", created_at AS "createdAt" FROM players ORDER BY created_at ASC'
  );
  return rows;
}

async function addPlayer({ id, roleId, roleName, serverId }) {
  const { rows } = await pool.query(
    `INSERT INTO players (id, role_id, role_name, server_id, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, role_id AS "roleId", role_name AS "roleName", server_id AS "serverId", created_at AS "createdAt"`,
    [id, roleId, roleName, serverId]
  );
  return rows[0];
}

async function deletePlayer(id) {
  const { rowCount } = await pool.query('DELETE FROM players WHERE id = $1', [id]);
  return rowCount > 0;
}

async function findPlayer(roleId, serverId) {
  const { rows } = await pool.query(
    'SELECT id FROM players WHERE role_id = $1 AND server_id = $2',
    [roleId, serverId]
  );
  return rows[0] || null;
}

// ============== HISTORY ==============

async function loadHistory() {
  const { rows } = await pool.query(
    `SELECT id, code, timestamp, total_players AS "totalPlayers",
            success_count AS "successCount", fail_count AS "failCount", results
     FROM history ORDER BY timestamp DESC LIMIT 100`
  );
  return rows;
}

async function addHistory({ id, code, totalPlayers, successCount, failCount, results }) {
  await pool.query(
    `INSERT INTO history (id, code, timestamp, total_players, success_count, fail_count, results)
     VALUES ($1, $2, NOW(), $3, $4, $5, $6)`,
    [id, code, totalPlayers, successCount, failCount, JSON.stringify(results)]
  );
}

async function clearHistory() {
  await pool.query('DELETE FROM history');
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
