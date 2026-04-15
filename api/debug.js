module.exports = async (req, res) => {
  try {
    const handler = require('./index');
    await handler(req, res);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
};
