// socket/socketHandler.js

const jsonwebtoken = require('jsonwebtoken');
const Player = require('../models/Player');
const Game = require('../models/Game');

// --- Globaler Spielzustand (MUSST DU VON server.js HIERHER VERSCHIEBEN) ---
let buzzerLocked = false;
let firstBuzzer = null; 
let currentPlayers = {}; 
let currentAnswers = []; 
let gameScores = {}; 
let buzzerTimer = null; // Speichert den setInterval Handler
const BUZZER_TIME = 10; // 10 Sekunden
let currentTimerSeconds = 0;
// --- End Globaler Spielzustand ---

function emitPlayerListToHost(io) {
    // Filtere die Liste, um nur die Spieler-Informationen (ID und Name) zu senden
    const players = Object.values(currentPlayers).map(player => ({
        id: player.id, // Die Spieler-ID
        username: player.username // Der Spielername
    }));

    // Sende die Liste nur an den Host (oder alle, wenn der Host-Socket schwer zu filtern ist)
    // Wir senden an alle, und lassen das Frontend filtern (einfachere Implementierung)
    io.emit('playerListUpdate', players);
    console.log(`📡 Spielerliste an Clients gesendet. Aktuell verbunden: ${players.length}`);
}



// Hauptfunktion, die von server.js aufgerufen wird
module.exports = (io) => {
    
    // HIER GESAMTEN io.on('connection', ...) BLOCK EINFÜGEN
    // Wichtig: Entferne den 'async' aus der Funktion, wenn du ihn nicht brauchst.
io.on('connection', async (socket) => { // async, da wir DB-Zugriffe im connect-Block haben
    let user = null; 
    let token = socket.handshake.auth.token;

    // 1. Authentifizierung & User-Daten laden
    if (token) {
        try {
            const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);
            user = await Player.findById(decoded.id).select('-password');
            
            if (user) {
                // Spieler oder Host zur globalen Liste hinzufügen
                currentPlayers[socket.id] = { 
                    id: user._id.toString(), 
                    username: user.username, 
                    isHost: user.isHost,
                    socketId: socket.id
                };
                console.log(`👤 ${user.username} verbunden. Host: ${user.isHost}`);
                
                // Host mit Spielzustand und Listen aktualisieren
                if (user.isHost) {
                    socket.emit('gameState', {
                        buzzerLocked,
                        firstBuzzer: firstBuzzer ? currentPlayers[firstBuzzer].username : null,
                        gameScores
                    });
                }
                
                // Initialer Scoreboard- und Player-List-Update
                io.emit('updateScoreboard', gameScores);
                emitPlayerListToHost(io);
            }
        } catch (error) {
            console.log('❌ Auth-Fehler oder Spieler nicht gefunden:', error.message);
            socket.emit('authError', 'Ungültiges oder abgelaufenes Token.');
            socket.disconnect();
            return;
        }
    }


    // 2. Client-Events verarbeiten

    socket.on('buzz', () => {
        if (!user || user.isHost) return; // Hosts können nicht buzzern
        if (buzzerLocked) {
            socket.emit('buzzerLocked', { firstBuzzer: currentPlayers[firstBuzzer].username });
            return;
        }

        buzzerLocked = true;
        firstBuzzer = socket.id;

        // Score-Objekt initialisieren, falls nicht vorhanden
        if (!gameScores[user.id]) {
            gameScores[user.id] = { username: user.username, points: 0, firstBuzzes: 0, correct: 0, wrong: 0 };
        }
        gameScores[user.id].firstBuzzes++; // Zähle den Buzzer-Vorgang

        // Clients über den gebuzzten Spieler informieren
        const buzzerData = {
            username: user.username,
            buzzerLocked: true,
            playerId: user.id
        };
        
        // Sende das Event an alle
        io.emit('buzzed', buzzerData);
        console.log(`🚨 BUZZ: ${user.username} hat gebuzzert.`);

        // --- NEU: Timer-Start-Events senden ---
        const timerDuration = 10; // 10 Sekunden Zeit für die Antwort
        io.emit('timerStarted', { duration: timerDuration, username: user.username });
        // ------------------------------------
    });
    
    // --- NEU: Listener für abgelaufenen Timer ---
    socket.on('timerExpired', () => {
        // Nur der Host kann diesen Event senden, um den Zustand zurückzusetzen
        if (!user || !user.isHost) return;
        
        console.log(`⏱️ HOST: Timer abgelaufen. Setze Spielzustand zurück.`);
        
        // 1. Zustand zurücksetzen (entsperrt den Buzzer)
        buzzerLocked = false;
        firstBuzzer = null;
        currentAnswers = []; // Gesammelte Antworten zurücksetzen

        // 2. Clients informieren
        io.emit('gameState', {
            buzzerLocked: false,
            firstBuzzer: null,
            gameScores // Sendet auch die aktuellen Scores
        });
        
        // 3. Informiere die Spieler, dass sie ihren Timer stoppen sollen
        io.emit('resetBuzzer'); 
    });
    // ------------------------------------------

    socket.on('submitAnswer', (answerText) => {
        if (!user || user.isHost || socket.id !== firstBuzzer || !buzzerLocked) return;

        console.log(`📝 ANTWORT: ${user.username} hat geantwortet: ${answerText}`);
        
        // Antwort speichern und an Host senden
        const answer = {
            username: user.username,
            answer: answerText,
            timestamp: Date.now()
        };
        currentAnswers.push(answer);
        
        // Sende die Antwort nur an den Host (könnte gefiltert werden, indem man nur den Host-Socket anspricht)
        io.emit('latestAnswer', answer); 
    });

    socket.on('scoreAnswer', ({ playerId, isCorrect, correctPoints, incorrectPoints }) => {
        if (!user || !user.isHost) return; // Nur der Host darf werten
        if (!buzzerLocked) return; // Nur werten, wenn der Buzzer gesperrt ist (es also einen Buzzer gab)

        const scoreChange = isCorrect ? parseInt(correctPoints) : parseInt(incorrectPoints);
        
        // Stelle sicher, dass das Score-Objekt existiert
        if (!gameScores[playerId]) {
             // Sollte nicht passieren, wenn der Buzzer-Flow korrekt war
             gameScores[playerId] = { username: currentPlayers[firstBuzzer]?.username || 'Unbekannt', points: 0, firstBuzzes: 0, correct: 0, wrong: 0 };
        }
        
        // Punkte aktualisieren
        gameScores[playerId].points += scoreChange;
        
        // Richtige/Falsche Zähler aktualisieren
        if (isCorrect) {
            gameScores[playerId].correct++;
        } else {
            gameScores[playerId].wrong++;
        }

        console.log(`✅ WERTUNG: Spieler ${gameScores[playerId].username} erhält ${scoreChange} Punkte. Neues Score: ${gameScores[playerId].points}`);

        // Zustand zurücksetzen
        buzzerLocked = false;
        firstBuzzer = null;
        currentAnswers = []; // Antworten leeren

        // Clients informieren
        io.emit('updateScoreboard', gameScores);
        io.emit('gameState', {
            buzzerLocked: false,
            firstBuzzer: null
        });
        
        // --- NEU: Informiere die Clients, dass der Timer gestoppt und der Buzzer freigegeben werden soll ---
        io.emit('resetBuzzer'); 
        // -------------------------------------------------------------------------------------------------
    });
    
    socket.on('requestSkip', () => {
        if (!user || user.isHost) return;

        // Informiere nur den Host, wer geskippt hat.
        // Die Logik, wann wirklich geskippt wird, liegt beim Host.
        io.emit('playerSkipRequest', { username: user.username });
        console.log(`⏭️ SKIP: ${user.username} möchte skippen.`);
    });
    
    socket.on('endGame', async () => {
        if (!user || !user.isHost) return;
        
        // Finde den Gewinner
        let winner = null;
        let maxPoints = -Infinity;
        for (const id in gameScores) {
            if (gameScores[id].points > maxPoints) {
                maxPoints = gameScores[id].points;
                winner = id;
            }
        }
        
        // 1. Speichere das Spiel in der Datenbank
        const newGame = new Game({
            date: new Date(),
            scores: gameScores,
            winner: winner,
            host: user._id
        });
        await newGame.save();
        console.log(`💾 HOST: Spiel ${newGame._id} gespeichert.`);

        // 2. Filtere nur Spieler, die Punkte gesammelt haben (Behebt den ReferenceError)
        const playerIds = Object.keys(gameScores); 

        console.log(`📊 HOST: Aktualisiere kumulierte Statistiken für ${playerIds.length} Spieler...`);

        // 3. Kumulierte Spieler-Statistiken (Player-Modell) aktualisieren
        for (const playerId of playerIds) { 
            // Wir verwenden || 0, um sicherzustellen, dass auch neue Spieler ohne alle Zähler korrekt gespeichert werden
            const stats = gameScores[playerId];

            await Player.findByIdAndUpdate(playerId, {
                $inc: {
                    totalGamesPlayed: 1, // Spielanzahl um 1 erhöhen
                    totalPoints: stats.points, // Gesamtpunkte addieren
                    totalFirstBuzzes: stats.firstBuzzes, // Gesamt-Buzzes addieren
                    
                    // NEU: Hinzufügen der richtigen/falschen Antworten
                    totalCorrectAnswers: stats.correct || 0,
                    totalWrongAnswers: stats.wrong || 0
                }
            });
        }
        console.log(`✅ HOST: Kumulierte Spieler-Statistiken aktualisiert.`);

        // 4. Globalen Zustand zurücksetzen und alle informieren
        gameScores = {}; // Spielpunkte leeren
        io.emit('gameEnded', { winnerId: winner }); // Alle Clients informieren
    });
    
    
    socket.on('disconnect', () => {
        if (user) {
            delete currentPlayers[socket.id];
            console.log(`🚪 ${user.username} getrennt. Aktive Spieler: ${Object.keys(currentPlayers).length}`);
            
            // Wenn der gebuzzte Spieler trennt, Buzzer entsperren und Timer zurücksetzen
            if (firstBuzzer === socket.id) {
                buzzerLocked = false;
                firstBuzzer = null;
                io.emit('gameState', { buzzerLocked: false, firstBuzzer: null });
                io.emit('resetBuzzer'); // Timer-Reset senden
            }
            
            emitPlayerListToHost(io);
        }
    });
});
};