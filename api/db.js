const fs = require('fs');
const path = require('path');

const IS_VERCEL = !!process.env.VERCEL;
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

async function loadPlayers() { return readJson(PLAYERS_FILE); }
async function savePlayers(players) { writeJson(PLAYERS_FILE, players); }
async function loadHistory() { return readJson(HISTORY_FILE); }
async function saveHistory(history) { writeJson(HISTORY_FILE, history); }
function getMode() { return IS_VERCEL ? 'vercel-tmp' : 'json-file'; }

module.exports = { loadPlayers, savePlayers, loadHistory, saveHistory, getMode };
