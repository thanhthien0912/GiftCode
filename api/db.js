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

async function addPlayer(player) {
  const db = await getDb();
  await db.collection('players').insertOne({ ...player });
}

async function findPlayer(roleId, serverId) {
  const db = await getDb();
  return db.collection('players').findOne({ roleId, serverId });
}

// ============== History ==============

async function loadHistory(limit) {
  const db = await getDb();
  let cursor = db.collection('history').find({}, { projection: { _id: 0 } }).sort({ timestamp: -1 });
  if (limit) cursor = cursor.limit(limit);
  return cursor.toArray();
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
  loadPlayers, addPlayer, findPlayer,
  loadHistory, addHistory, clearHistory, removeHistory
};
