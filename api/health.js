module.exports = (req, res) => {
  res.json({
    ok: true,
    env: {
      VERCEL: process.env.VERCEL || 'not set',
      BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN ? 'set' : 'not set',
      NODE_VERSION: process.version
    }
  });
};
