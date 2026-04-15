const crypto = require('crypto');
const db = require('./db');

function uuidv4() { return crypto.randomUUID(); }

async function parseBody(req) {
  if (req.body) return req.body;
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { resolve({}); }
    });
  });
}

module.exports = async (req, res) => {
  try {
    const url = req.url.split('?')[0].replace(/\/+$/, '');
    
    // GET /api/players
    if (req.method === 'GET' && url === '/api/players') {
      const players = await db.loadPlayers();
      return res.status(200).json({ success: true, data: players });
    }
    
    // POST /api/players
    if (req.method === 'POST' && url === '/api/players') {
      const body = await parseBody(req);
      const { roleId, roleName, serverId } = body;
      if (!roleId) return res.status(400).json({ success: false, message: 'roleId là bắt buộc' });
      
      const players = await db.loadPlayers();
      const sid = serverId || '2';
      
      if (players.find(p => p.roleId === roleId.trim() && p.serverId === sid)) {
        return res.status(400).json({ success: false, message: 'Người chơi này đã tồn tại' });
      }
      
      const player = {
        id: uuidv4(),
        roleId: roleId.trim(),
        roleName: (roleName || roleId).trim(),
        serverId: sid,
        createdAt: new Date().toISOString()
      };
      players.push(player);
      await db.savePlayers(players);
      return res.status(200).json({ success: true, data: player });
    }

    return res.status(404).json({ success: false, message: 'Not found', url, method: req.method });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
};
