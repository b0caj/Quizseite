// routes/statRoutes.js

const express = require('express');
const router = express.Router();
const Player = require('../models/Player');
const { protect, hostProtect } = require('../middleware/auth'); // Middleware importieren

// Route: GET /api/stats/top-players (öffentlich sichtbar für eingeloggte Spieler)
// Route: GET /api/stats/top-players (öffentlich sichtbar für eingeloggte Spieler)
router.get('/top-players', protect, async (req, res) => {
    try {
        const topPlayers = await Player.find()
            // NEU: Hinzufügen der Felder totalCorrectAnswers und totalWrongAnswers
            .select('username totalGamesPlayed totalFirstBuzzes totalPoints totalCorrectAnswers totalWrongAnswers')
            .sort({ totalPoints: -1, totalFirstBuzzes: -1 })
            .limit(10); 

        res.status(200).json(topPlayers); // Die Daten werden nun an stats.html gesendet

    } catch (error) {
        console.error('Fehler beim Abrufen der Statistiken:', error);
        res.status(500).json({ message: 'Ein Serverfehler ist aufgetreten.' });
    }
});


// Beispiel für die geschützte Host-Route, die wir getestet haben:
router.get('/host/dashboard', protect, hostProtect, (req, res) => {
    res.status(200).json({ 
        message: `Willkommen im Host-Dashboard, ${req.user.username}!`,
        adminAccess: true
    });
});


module.exports = router;