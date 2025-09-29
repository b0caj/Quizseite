// server.js (NEUE, SAUBERE VERSION)

// 1. Core Abhängigkeiten
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
//const mongoose = require('mongoose');
const connectDB = require('./db'); 
const dotenv = require('dotenv');
const quizRoutes = require('./routes/quizRoutes'); 

// 2. Module importieren
const authRoutes = require('./routes/authRoutes');
const statRoutes = require('./routes/statRoutes');
const socketHandler = require('./socket/socketHandler'); // Wichtig: Socket-Logik

// Konfiguration
dotenv.config();
//mongoose.set('strictQuery', true); 
//const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/buzzerdb';
const PORT = process.env.PORT || 3000;

// 3. Setup
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});


// 4. Datenbankverbindung
connectDB();
//mongoose.connect(MONGODB_URI)
//    .then(() => console.log('✅ MongoDB verbunden.'))
//    .catch(err => {
//       console.error('❌ Fehler beim Verbinden der MongoDB:', err.message);
//        process.exit(1);
//    });

// 5. Middleware und Routing
app.use(express.json()); 
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/auth', authRoutes); // http://localhost:3000/api/auth/register
app.use('/api/stats', statRoutes); // http://localhost:3000/api/stats/top-players
app.use('/api/quiz', quizRoutes); // NEU: Quiz-Routen
// ...

// Basis-Route (Für index.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});


// 6. Socket.IO Logik initialisieren
socketHandler(io); // Übergibt die Socket.IO-Instanz an das separate Modul


// 7. Server starten
server.listen(PORT, () => {
    console.log(`🚀 Server läuft auf Port ${PORT}`);
});