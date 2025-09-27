const mongoose = require('mongoose');

const PlayerSchema = new mongoose.Schema({
    // Authentifizierung und Identifikation
    username: {
        type: String,
        required: [true, 'Ein Benutzername ist erforderlich.'],
        unique: true,
        trim: true,
    },
    passwordHash: { // Wir speichern den Hash, NIEMALS das Klartextpasswort
        type: String,
        required: [true, 'Ein Passwort-Hash ist erforderlich.'],
    },
    isHost: {
        type: Boolean,
        default: false,
    },
    
    // Gesamtstatistiken (kumuliert über alle Spiele)
    totalGamesPlayed: {
        type: Number,
        default: 0,
    },
    totalFirstBuzzes: { // Wie oft der Spieler am schnellsten war
        type: Number,
        default: 0,
    },
    totalPoints: {
        type: Number,
        default: 0,
    },
    // NEU: Zähler für richtige und falsche Antworten
    totalCorrectAnswers: {
        type: Number,
        default: 0,
    },
    totalWrongAnswers: {
        type: Number,
        default: 0,
    },
}, {
    timestamps: true // Fügt createdAt und updatedAt hinzu
});

module.exports = mongoose.model('Player', PlayerSchema);