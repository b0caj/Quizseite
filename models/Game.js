const mongoose = require('mongoose');

const GameSchema = new mongoose.Schema({
    datePlayed: {
        type: Date,
        default: Date.now,
    },
    
    // Array speichert die detaillierten Ergebnisse der Teilnehmer
    playersResults: [{
        // Referenz zum Spieler-Modell, um den Spieler zu identifizieren
        playerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Player',
            required: true,
        },
        pointsScored: { // Punkte in DIESEM Spiel
            type: Number,
            default: 0,
        },
        firstBuzzes: { // Anzahl der ersten Buzzes in DIESEM Spiel
            type: Number,
            default: 0,
        },
    }],
    
    // Ergebnis des gesamten Spiels
    winnerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player',
        required: false, // Kann am Anfang null sein
    },
});

module.exports = mongoose.model('Game', GameSchema);