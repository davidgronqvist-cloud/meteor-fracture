require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const mongoose = require('mongoose');

const app = express();

// Middleware
app.use(express.json()); // Parses JSON bodies for saving scores
app.use(express.static('public')); // Serves static files from public folder
app.use('/assets', express.static('assets')); //[cite: 3]
app.use('/sounds', express.static('sounds')); //[cite: 3]

// 1. Connect to MongoDB Cloud Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB Cloud successfully!'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// 2. High Score Schema & Database Model
const scoreSchema = new mongoose.Schema({
  name: { type: String, required: true, maxlength: 12 },
  score: { type: Number, required: true },
  playerId: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now }
});

const Score = mongoose.model('Score', scoreSchema);

// 3. Leaderboard API Routes
// GET: Retrieve top 10 scores
app.get('/api/scores', async (req, res) => {
  try {
    const topScores = await Score.find()
      .sort({ score: -1, createdAt: 1 })
      .limit(10)
      .select('name score');
    res.json(topScores.map(entry => ({
      id: String(entry._id),
      name: entry.name,
      score: entry.score
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard scores.' });
  }
});

// GET: Retrieve every score submitted by this browser
app.get('/api/scores/submitted', async (req, res) => {
  const playerId = req.query.playerId;
  if (typeof playerId !== 'string' || playerId.length < 16 || playerId.length > 64) {
    return res.status(400).json({ error: 'A valid player ID is required.' });
  }

  try {
    const submittedScores = await Score.find({ playerId })
      .sort({ createdAt: -1 })
      .select('name score createdAt');
    res.json(submittedScores.map(entry => ({
      id: String(entry._id),
      name: entry.name,
      score: entry.score,
      createdAt: entry.createdAt
    })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch submitted scores.' });
  }
});

// POST: Save a new high score
app.post('/api/scores', async (req, res) => {
  try {
    const { name, score, playerId } = req.body || {};
    const normalizedName = typeof name === 'string' ? name.trim() : '';

    if (!normalizedName || typeof score !== 'number' || !Number.isFinite(score) || score < 0 ||
      typeof playerId !== 'string' || playerId.length < 16 || playerId.length > 64) {
      return res.status(400).json({ error: 'Valid name, score, and player ID are required.' });
    }

    const newScore = new Score({
      name: normalizedName.substring(0, 12),
      score: Math.floor(score),
      playerId
    });

    await newScore.save();
    res.json({
      success: true,
      score: {
        id: String(newScore._id),
        name: newScore.name,
        score: newScore.score,
        createdAt: newScore.createdAt
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save score.' });
  }
});

// Serve Main Game HTML Page[cite: 3]
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html')); //[cite: 3]
});

// Create HTTP and WebSocket Server[cite: 3]
const server = http.createServer(app); //[cite: 3]
const wss = new WebSocket.Server({ server }); //[cite: 3]

const rooms = new Map(); //[cite: 3]

// WebSocket Room Logic for Controller[cite: 3]
wss.on('connection', (ws) => { //[cite: 3]
  let clientRoom = null; //[cite: 3]
  let isHost = false; //[cite: 3]

  ws.on('message', (message) => { //[cite: 3]
    try {
      const data = JSON.parse(message); //[cite: 3]

      if (data.type === 'CREATE_ROOM') { //[cite: 3]
        clientRoom = data.room; //[cite: 3]
        isHost = true; //[cite: 3]
        rooms.set(clientRoom, { host: ws, controller: null }); //[cite: 3]
      } 
      else if (data.type === 'JOIN_ROOM') { //[cite: 3]
        clientRoom = data.room; //[cite: 3]
        isHost = false; //[cite: 3]
        const room = rooms.get(clientRoom); //[cite: 3]
        if (room) { //[cite: 3]
          room.controller = ws; //[cite: 3]
          ws.send(JSON.stringify({ type: 'CONNECTED' })); //[cite: 3]
          if (room.host && room.host.readyState === WebSocket.OPEN) { //[cite: 3]
            room.host.send(JSON.stringify({ type: 'CONNECTED' })); //[cite: 3]
          }
        } else {
          ws.send(JSON.stringify({ type: 'ROOM_NOT_FOUND' })); //[cite: 3]
        }
      } 
      else if (data.type === 'SET_SENSITIVITY') { //[cite: 3]
        const room = rooms.get(clientRoom); //[cite: 3]
        if (room && room.controller && room.controller.readyState === WebSocket.OPEN) { //[cite: 3]
          room.controller.send(JSON.stringify({ type: 'SENSITIVITY', sensitivity: data.sensitivity })); //[cite: 3]
        }
      }
      else if (data.type === 'END_SESSION') { //[cite: 3]
        const room = rooms.get(clientRoom); //[cite: 3]
        if (room) { //[cite: 3]
          if (room.controller && room.controller.readyState === WebSocket.OPEN) { //[cite: 3]
            room.controller.send(JSON.stringify({ type: 'QUIT' })); //[cite: 3]
          }
          room.controller = null; //[cite: 3]
        }
      }
      else if (['POINTER_DELTA', 'POINTER_POSITION', 'RECALIBRATE', 'FIRE'].includes(data.type)) { //[cite: 3]
        const room = rooms.get(clientRoom); //[cite: 3]
        if (room && room.host && room.host.readyState === WebSocket.OPEN) { //[cite: 3]
          room.host.send(JSON.stringify(data)); //[cite: 3]
        }
      }
    } catch (e) {
      console.error('Invalid message:', e); //[cite: 3]
    }
  });

  ws.on('close', () => { //[cite: 3]
    if (clientRoom && rooms.has(clientRoom)) { //[cite: 3]
      if (isHost) { //[cite: 3]
        rooms.delete(clientRoom); //[cite: 3]
      } else {
        const room = rooms.get(clientRoom); //[cite: 3]
        if (room && room.host && room.host.readyState === WebSocket.OPEN) { //[cite: 3]
          room.host.send(JSON.stringify({ type: 'CONTROLLER_DISCONNECTED' })); //[cite: 3]
        }
        if (room) room.controller = null; //[cite: 3]
      }
    }
  });
});

// Port listener (process.env.PORT automatically binds on cloud providers like Render)[cite: 3]
const PORT = process.env.PORT || 4567; //[cite: 3]
server.listen(PORT, () => console.log(`Server running on port ${PORT}`)); //[cite: 3]