module.exports = async (req, res) => {
  try {
    const db = require('./db');
    const players = await db.loadPlayers();
    res.status(200).json({ ok: true, mode: db.getMode(), playerCount: players.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
};
