const express = require('express');
const path = require('path');
const handler = require('./api/index');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Route all /api/* to the serverless handler
app.all('/api/{*path}', (req, res) => handler(req, res));

app.listen(PORT, () => {
  const db = require('./api/db');
  console.log(`🎮 VNG Giftcode Bot đang chạy tại http://localhost:${PORT}`);
  console.log(`📦 Storage mode: ${db.getMode()}`);
});
