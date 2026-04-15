module.exports = async (req, res) => {
  try {
    const bodyType = typeof req.body;
    const hasBody = !!req.body;
    let parsed = null;
    
    if (req.body && typeof req.body === 'object') {
      parsed = req.body;
    } else if (typeof req.body === 'string') {
      parsed = JSON.parse(req.body);
    } else {
      // try reading stream
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString('utf-8');
      parsed = raw ? JSON.parse(raw) : null;
    }

    res.status(200).json({ 
      ok: true, 
      method: req.method, 
      url: req.url,
      bodyType,
      hasBody,
      parsed,
      headers: { 'content-type': req.headers['content-type'] }
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message, stack: err.stack });
  }
};
