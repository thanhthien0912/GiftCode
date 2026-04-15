const { put, get } = require('@vercel/blob');
const fs = require('fs');
const path = require('path');

const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

// ============== Local JSON file backend ==============
const DATA_DIR = path.join(__dirname, '..', 'data');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonLocal(file, fallback = []) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { return fallback; }
}

function writeJsonLocal(file, data) {
  ensureDataDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============== Vercel Blob backend ==============
async function readBlob(key, fallback = []) {
  try {
    const result = await get(key, { access: 'public' });
    if (!result || result.statusCode === 304) return fallback;
    const reader = result.stream.getReader();
    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString('utf-8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeBlob(key, data) {
  await put(key, JSON.stringify(data, null, 2), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true
  });
}

// ============== Unified interface ==============

async function loadPlayers() {
  if (USE_BLOB) return readBlob('players.json');
  return readJsonLocal(PLAYERS_FILE);
}

async function savePlayers(players) {
  if (USE_BLOB) return writeBlob('players.json', players);
  writeJsonLocal(PLAYERS_FILE, players);
}

async function loadHistory() {
  if (USE_BLOB) return readBlob('history.json');
  return readJsonLocal(HISTORY_FILE);
}

async function saveHistory(history) {
  if (USE_BLOB) return writeBlob('history.json', history);
  writeJsonLocal(HISTORY_FILE, history);
}

function getMode() {
  return USE_BLOB ? 'vercel-blob' : 'json-file';
}

module.exports = { loadPlayers, savePlayers, loadHistory, saveHistory, getMode };
