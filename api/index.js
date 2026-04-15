const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('./db');

const app = express();

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ============== API ROUTES ==============

// Get all players
app.get('/api/players', async (req, res) => {
  try {
    const players = await db.loadPlayers();
    res.json({ success: true, data: players });
  } catch (err) {
    console.error('Load players error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// Add a player
app.post('/api/players', async (req, res) => {
  const { roleId, roleName, serverId } = req.body;
  if (!roleId) {
    return res.status(400).json({ success: false, message: 'roleId là bắt buộc' });
  }

  try {
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
    res.json({ success: true, data: player });
  } catch (err) {
    console.error('Add player error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// Delete a player
app.delete('/api/players/:id', async (req, res) => {
  try {
    let players = await db.loadPlayers();
    const before = players.length;
    players = players.filter(p => p.id !== req.params.id);

    if (players.length === before) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy người chơi' });
    }

    await db.savePlayers(players);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete player error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// Import multiple players (bulk)
app.post('/api/players/bulk', async (req, res) => {
  const { roleIds, players: playerEntries, serverId } = req.body;

  let entries = [];
  if (playerEntries && Array.isArray(playerEntries)) {
    entries = playerEntries.map(p => ({
      roleId: (p.roleId || '').trim(),
      roleName: (p.roleName || p.roleId || '').trim()
    })).filter(p => p.roleId);
  } else if (roleIds && Array.isArray(roleIds)) {
    entries = roleIds.map(rid => ({
      roleId: rid.trim(),
      roleName: rid.trim()
    })).filter(p => p.roleId);
  }

  if (entries.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách người chơi không hợp lệ' });
  }

  try {
    const players = await db.loadPlayers();
    const sid = serverId || '2';
    const added = [];
    const skipped = [];

    for (const entry of entries) {
      if (players.find(p => p.roleId === entry.roleId && p.serverId === sid)) {
        skipped.push(entry.roleId);
        continue;
      }

      players.push({
        id: uuidv4(),
        roleId: entry.roleId,
        roleName: entry.roleName || entry.roleId,
        serverId: sid,
        createdAt: new Date().toISOString()
      });
      added.push(entry.roleId);
    }

    await db.savePlayers(players);
    res.json({ success: true, added: added.length, skipped: skipped.length, details: { added, skipped } });
  } catch (err) {
    console.error('Bulk import error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// ============== REDEEM CODE ==============

// Redeem code for ALL players
app.post('/api/redeem', async (req, res) => {
  const { code, delayMs } = req.body;
  if (!code || !code.trim()) {
    return res.status(400).json({ success: false, message: 'Code không được để trống' });
  }

  try {
    const players = await db.loadPlayers();
    if (players.length === 0) {
      return res.status(400).json({ success: false, message: 'Chưa có người chơi nào trong danh sách' });
    }

    const results = [];
    const delay = Math.max(delayMs || 1000, 500);

    for (let i = 0; i < players.length; i++) {
      const player = players[i];

      try {
        const result = await redeemCode({
          code: code.trim(),
          roleId: player.roleId,
          roleName: player.roleName,
          serverId: player.serverId,
          gameCode: '661'
        });

        results.push({
          roleId: player.roleId,
          roleName: player.roleName,
          serverId: player.serverId,
          ...result
        });
      } catch (err) {
        results.push({
          roleId: player.roleId,
          roleName: player.roleName,
          serverId: player.serverId,
          success: false,
          errorCode: -1,
          message: err.message
        });
      }

      if (i < players.length - 1) {
        await sleep(delay);
      }
    }

    // Save to history
    const history = await db.loadHistory();
    const successCount = results.filter(r => r.success).length;
    history.unshift({
      id: uuidv4(),
      code: code.trim(),
      timestamp: new Date().toISOString(),
      totalPlayers: players.length,
      successCount,
      failCount: players.length - successCount,
      results
    });
    if (history.length > 100) history.length = 100;
    await db.saveHistory(history);

    res.json({
      success: true,
      code: code.trim(),
      total: players.length,
      successCount,
      failCount: players.length - successCount,
      results
    });
  } catch (err) {
    console.error('Redeem error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// Redeem code for a specific player
app.post('/api/redeem/single', async (req, res) => {
  const { code, roleId, roleName, serverId } = req.body;
  if (!code || !roleId) {
    return res.status(400).json({ success: false, message: 'Code và roleId là bắt buộc' });
  }

  try {
    const result = await redeemCode({
      code: code.trim(),
      roleId,
      roleName: roleName || roleId,
      serverId: serverId || '2',
      gameCode: '661'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, errorCode: -1, message: err.message });
  }
});

// Get history
app.get('/api/history', async (req, res) => {
  try {
    const history = await db.loadHistory();
    res.json({ success: true, data: history });
  } catch (err) {
    console.error('Load history error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// Clear history
app.delete('/api/history', async (req, res) => {
  try {
    await db.saveHistory([]);
    res.json({ success: true });
  } catch (err) {
    console.error('Clear history error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// ============== EXPORT DATA ==============

app.get('/api/export', async (req, res) => {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      players: await db.loadPlayers(),
      history: await db.loadHistory()
    };
    res.setHeader('Content-Disposition', `attachment; filename="giftcode-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  } catch (err) {
    console.error('Export error:', err.message);
    res.status(500).json({ success: false, message: 'Lỗi server' });
  }
});

// ============== VNG API HELPER ==============

const ERROR_MESSAGES = {
  1: 'Thành công! Kiểm tra hộp thư trong game.',
  1002: 'Không tìm thấy thông tin nhân vật.',
  2102: 'Nhận quà không thành công.',
  2105: 'Nhân vật không tồn tại hoặc đang offline.',
  2106: 'Mã code không tồn tại.',
  2107: 'Mã code đã hết hạn.',
  2108: 'Mã code đã được sử dụng.',
  2109: 'Bạn đã nhận loại mã này rồi.',
  2110: 'Nhập trùng loại mã hoặc mã đã được sử dụng.',
  2111: 'Nhận quà không thành công.',
  2113: 'Không tìm thấy thông tin nhân vật.',
  2114: 'Tài khoản đã bị khóa.',
  2115: 'Định dạng mã không hợp lệ.',
  2116: 'Không tìm thấy dữ liệu.',
  2117: 'Mã đã đạt giới hạn lượt nhập.',
  2119: 'Mã code không hợp lệ.',
  2120: 'Lỗi khi nhận quà.',
  2121: 'Vượt quá số lần nhập cho loại mã này.',
  2126: 'Mã không áp dụng cho server của bạn.',
  2127: 'Đã nhận mã cho chuỗi sự kiện này rồi.'
};

async function redeemCode({ code, roleId, roleName, serverId, gameCode }) {
  const body = JSON.stringify({ serverId, gameCode, roleId, roleName, code });

  const response = await fetch('https://vgrapi-sea.vnggames.com/coordinator/api/v1/code/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'X-Client-Region': 'VN',
      'x-request-id': uuidv4(),
      'Origin': 'https://giftcode.vnggames.com',
      'Referer': 'https://giftcode.vnggames.com/'
    },
    body
  });

  const data = await response.json();

  return {
    success: data.errorCode === 1,
    errorCode: data.errorCode,
    message: ERROR_MESSAGES[data.errorCode] || data.message || data.description || 'Lỗi không xác định',
    rawResponse: data
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============== LOCAL DEV SERVER ==============
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🎮 VNG Giftcode Bot đang chạy tại http://localhost:${PORT}`);
    console.log(`📦 Storage mode: ${db.getMode()}`);
  });
}

module.exports = app;
