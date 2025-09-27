// routes/authRoutes.js

const express = require('express');
const router = express.Router(); // Router-Instanz
const bcrypt = require('bcryptjs');
const jsonwebtoken = require('jsonwebtoken');
const Player = require('../models/PLayer'); // Import des Player-Modells

// Route: POST /api/register
router.post('/register', async (req, res) => {
    // [HIER GESAMTEN CODE DER /api/register ROUTE EINFÜGEN]
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Bitte Benutzername und Passwort angeben.' });

    try {
        const existingPlayer = await Player.findOne({ username });
        if (existingPlayer) return res.status(409).json({ message: 'Dieser Benutzername ist bereits vergeben.' });

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const newPlayer = new Player({ username, passwordHash });
        await newPlayer.save();
        res.status(201).json({ message: 'Registrierung erfolgreich!', playerId: newPlayer._id, username: newPlayer.username });

    } catch (error) {
        console.error('Fehler bei der Registrierung:', error);
        res.status(500).json({ message: 'Ein Serverfehler ist aufgetreten.' });
    }
});

// Route: POST /api/login
router.post('/login', async (req, res) => {
    // [HIER GESAMTEN CODE DER /api/login ROUTE EINFÜGEN]
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: 'Bitte Benutzername und Passwort angeben.' });

    try {
        const player = await Player.findOne({ username });
        if (!player) return res.status(401).json({ message: 'Ungültige Zugangsdaten.' });

        const isMatch = await bcrypt.compare(password, player.passwordHash);
        if (!isMatch) return res.status(401).json({ message: 'Ungültige Zugangsdaten.' });

        const payload = { id: player._id, username: player.username, isHost: player.isHost };

        const token = jsonwebtoken.sign(
            payload,
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.status(200).json({ message: 'Login erfolgreich!', token: token, isHost: player.isHost });

    } catch (error) {
        console.error('Fehler beim Login:', error);
        res.status(500).json({ message: 'Ein Serverfehler ist aufgetreten.' });
    }
});


module.exports = router;