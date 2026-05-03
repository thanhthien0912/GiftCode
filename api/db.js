const { MongoClient } = require('mongodb');

// ============== Connection ==============

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'giftcode';

let cachedClient = null;
let indexesEnsured = false;

async function getDb() {
  if (cachedClient) return cachedClient.db(DB_NAME);
  cachedClient = new MongoClient(MONGO_URI);
  await cachedClient.connect();
  const db = cachedClient.db(DB_NAME);
  if (!indexesEnsured) {
    try {
      await db.collection('history').createIndex({ timestamp: -1 });
      await db.collection('history').createIndex({ id: 1 });
      await db.collection('players').createIndex({ id: 1 });
      await db.collection('players').createIndex({ roleId: 1, serverId: 1 });
      indexesEnsured = true;
    } catch (e) {
      // Index creation lỗi không nên chặn app
      console.warn('Index ensure warning:', e.message);
    }
  }
  return db;
}

// ============== Players ==============

async function loadPlayers() {
  const db = await getDb();
  return db.collection('players').find({}, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
}

async function savePlayers(players) {
  const db = await getDb();
  const col = db.collection('players');
  await col.deleteMany({});
  if (players.length > 0) await col.insertMany(players);
}

async function addPlayer(player) {
  const db = await getDb();
  await db.collection('players').insertOne({ ...player });
}

async function removePlayer(id) {
  const db = await getDb();
  const result = await db.collection('players').deleteOne({ id });
  return result.deletedCount > 0;
}

async function findPlayer(roleId, serverId) {
  const db = await getDb();
  return db.collection('players').findOne({ roleId, serverId });
}

// ============== History ==============

async function loadHistory() {
  const db = await getDb();
  return db.collection('history').find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).toArray();
}

async function saveHistory(history) {
  const db = await getDb();
  const col = db.collection('history');
  await col.deleteMany({});
  if (history.length > 0) await col.insertMany(history);
}

async function addHistory(entry) {
  const db = await getDb();
  await db.collection('history').insertOne({ ...entry });
}

async function clearHistory() {
  const db = await getDb();
  await db.collection('history').deleteMany({});
}

async function removeHistory(id) {
  const db = await getDb();
  const result = await db.collection('history').deleteOne({ id });
  return result.deletedCount > 0;
}

module.exports = {
  loadPlayers, savePlayers, addPlayer, removePlayer, findPlayer,
  loadHistory, saveHistory, addHistory, clearHistory, removeHistory
};
