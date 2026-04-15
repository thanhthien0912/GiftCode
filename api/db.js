const { MongoClient } = require('mongodb');

// ============== Connection ==============

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.MONGODB_DB || 'giftcode';

let cachedClient = null;

async function getDb() {
  if (cachedClient) return cachedClient.db(DB_NAME);
  cachedClient = new MongoClient(MONGO_URI);
  await cachedClient.connect();
  return cachedClient.db(DB_NAME);
}

// ============== Players ==============

async function loadPlayers() {
  const db = await getDb();
  return db.collection('players').find({}, { projection: { _id: 0 } }).toArray();
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
  return db.collection('history').find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 }).limit(100).toArray();
}

async function saveHistory(history) {
  const db = await getDb();
  const col = db.collection('history');
  await col.deleteMany({});
  if (history.length > 0) await col.insertMany(history);
}

async function addHistory(entry) {
  const db = await getDb();
  const col = db.collection('history');
  await col.insertOne({ ...entry });
  // Keep max 100
  const count = await col.countDocuments();
  if (count > 100) {
    const oldest = await col.find().sort({ timestamp: 1 }).limit(count - 100).toArray();
    const ids = oldest.map(h => h._id);
    await col.deleteMany({ _id: { $in: ids } });
  }
}

async function clearHistory() {
  const db = await getDb();
  await db.collection('history').deleteMany({});
}

module.exports = {
  loadPlayers, savePlayers, addPlayer, removePlayer, findPlayer,
  loadHistory, saveHistory, addHistory, clearHistory
};
