const fs = require('fs');
const path = require('path');

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

function loadPlayers() { return readJson(PLAYERS_FILE); }
function savePlayers(players) { writeJson(PLAYERS_FILE, players); }
function loadHistory() { return readJson(HISTORY_FILE); }
function saveHistory(history) { writeJson(HISTORY_FILE, history); }

module.exports = { loadPlayers, savePlayers, loadHistory, saveHistory };
