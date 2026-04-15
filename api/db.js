const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL;
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const USE_KV = !!(KV_URL && KV_TOKEN);

// ============== Upstash Redis REST backend ==============
async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const data = await res.json();
  if (data.result === null || data.result === undefined) return null;
  // Upstash returns string, parse JSON
  try { return JSON.parse(data.result); }
  catch { return data.result; }
}

async function kvSet(key, value) {
  await fetch(`${KV_URL}/set/${key}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(JSON.stringify(value))
  });
}

// ============== Local JSON file backend ==============
const DATA_DIR = IS_VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
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
async function loadPlayers() {
  if (USE_KV) return (await kvGet('players')) || [];
  return readJson(PLAYERS_FILE);
}

async function savePlayers(players) {
  if (USE_KV) return kvSet('players', players);
  writeJson(PLAYERS_FILE, players);
}

async function loadHistory() {
  if (USE_KV) return (await kvGet('history')) || [];
  return readJson(HISTORY_FILE);
}

async function saveHistory(history) {
  if (USE_KV) return kvSet('history', history);
  writeJson(HISTORY_FILE, history);
}

function getMode() {
  if (USE_KV) return 'vercel-kv';
  if (IS_VERCEL) return 'vercel-tmp';
  return 'json-file';
}

module.exports = { loadPlayers, savePlayers, loadHistory, saveHistory, getMode };
