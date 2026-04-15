module.exports = async (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const db = require('./db');
    const testId = uuidv4();
    const url = req.url;
    const method = req.method;
    const players = await db.loadPlayers();
    res.status(200).json({ ok: true, mode: db.getMode(), testId, url, method, playerCount: players.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
};
