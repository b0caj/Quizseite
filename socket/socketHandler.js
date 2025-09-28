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
let skipRequests = { count: 0, playerIds: new Set() };
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
    io.on('connection', async (socket) => {
        // 1. JWT-Prüfung beim Verbindungsaufbau
        // Der Client muss das Token über die Query-Parameter mitsenden
        const token = socket.handshake.query.token;

        if (!token) {
            console.log(`❌ Verbindung blockiert: Kein Token gesendet (${socket.id})`);
            socket.disconnect();
            return;
        }



        let user;
        try {
            // Wir verwenden dieselbe JWT_SECRET wie für die API
            user = jsonwebtoken.verify(token, process.env.JWT_SECRET);

            // Füge den identifizierten Benutzer zu den aktuell verbundenen Spielern hinzu
            currentPlayers[socket.id] = {
                id: user.id,
                username: user.username,
                isHost: user.isHost
            };

            socket.on('authenticate', async (token) => {
                if (!token) {
                    socket.emit('authError', 'Kein Token vorhanden.');
                    return;
                }

                try {
                    const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);
                    const playerId = decoded.id; // Das ist die MongoDB _id
                    const playerDoc = await Player.findById(playerId);

                    if (!playerDoc || playerDoc.isHost) {
                        socket.emit('authError', 'Ungültige ID oder Host-Konto.');
                        return;
                    }

                    // 🔑 1. KRITISCH: Zuweisung der ID zum Socket
                    socket.playerId = playerId;

                    // 🔑 2. KRITISCH: Eintrag in die globale Liste (für currentPlayers[playerId].username)
                    currentPlayers[playerId] = {
                        id: playerId,
                        username: playerDoc.username,
                        socketId: socket.id,
                    };

                    // 3. Initialisierung der Punktestände, falls nötig
                    if (!gameScores[playerId]) {
                        gameScores[playerId] = { username: playerDoc.username, points: 0, firstBuzzes: 0, correct: 0, wrong: 0 };
                    } else {
                        // Bei Reconnect den Namen aktualisieren
                        gameScores[playerId].username = playerDoc.username;
                    }

                    socket.emit('authSuccess', { username: playerDoc.username });
                    emitPlayerListToHost(io);
                    io.emit('initialScores', gameScores);

                } catch (error) {
                    console.error("Socket-Authentifizierungsfehler:", error.message);
                    socket.emit('authError', 'Authentifizierung fehlgeschlagen.');
                }
            });


            socket.on('requestSkip', () => {
                const playerId = socket.playerId;

                // 1. Prüfen, ob eine gültige Player ID am Socket vorhanden ist
                if (!playerId) {
                    console.log(`❌ Skip-Anfrage abgelehnt: Socket hat keine Player-ID.`);
                    return;
                }

                // 2. ROBUSTER ZUGRIFF: Spieler-Objekt aus der globalen Map abrufen
                const player = currentPlayers[playerId];

                // Fallback für den Benutzernamen (falls das Spieler-Objekt in currentPlayers fehlt)
                // Dies sollte nur passieren, wenn ein Timing-Problem vorliegt
                const usernameForLog = player ? player.username : `Unbekannter Spieler (ID: ${playerId})`;

                if (!player) {
                    console.log(`❌ Skip-Anfrage abgelehnt: Spieler ${usernameForLog} fehlt in der globalen Liste.`);
                    return;
                }

                // 3. Prüfen, ob der Spieler bereits gevotet hat
                if (skipRequests.playerIds.has(playerId)) {
                    console.log(`❌ Spieler ${usernameForLog} hat bereits für den Skip gevotet.`);
                    // Optional: Hier könnten Sie eine Rückmeldung an den Client senden, dass er schon gevotet hat.
                    return;
                }

                // 4. Zähler erhöhen und Spieler-ID speichern
                skipRequests.count++;
                skipRequests.playerIds.add(playerId);

                // 5. Logging mit dem robusten Namen
                console.log(`➡️ Skip-Anfrage von ${usernameForLog}. Aktueller Zähler: ${skipRequests.count}`);

                // 6. Host aktualisieren
                io.emit('skipCountUpdate', { count: skipRequests.count });
            });


            // NEU: Host-Steuerung zum expliziten Sperren des Buzzers
            socket.on('lockBuzzer', () => {
                // 1. Host-Verifizierung
                if (!user.isHost) {
                    console.log('❌ UNBEFUGTER ZUGRIFF: Buzzer-Sperrung abgelehnt.');
                    return;
                }

                if (!buzzerLocked) {
                    buzzerLocked = true;
                    firstBuzzer = null; // Stellt sicher, dass kein vorheriger Buzzer-Gewinner übrig bleibt
                    currentAnswers = []; // Antworten zurücksetzen

                    // Sende den Zustand an alle Clients
                    // Sie könnten ein allgemeines 'gameState'-Event oder ein spezifisches 'buzzed'-Event senden.
                    // Da es sich um eine manuelle Sperrung handelt, senden wir ein State-Update.
                    io.emit('gameState', {
                        buzzerLocked: true,
                        firstBuzzer: null
                    });

                    // Alternativ: Das 'buzzed'-Event mit einem generischen Text senden, um das Frontend der Spieler auszulösen
                    // io.emit('buzzed', { username: 'Der Host', time: new Date().toISOString() }); 

                    console.log(`🔒 HOST: Buzzer wurde von ${user.username} GESPERRT.`);
                }
            });



            // NEU: Sende den gesamten aktuellen Punktestand beim Verbinden
            socket.emit('initialScores', gameScores);

            console.log(`✅ Benutzer verbunden: ${user.username} (${socket.id}). Host: ${user.isHost}`);

            // Sende den aktuellen Zustand an den neuen Spieler
            socket.emit('gameState', {
                buzzerLocked,
                firstBuzzer: firstBuzzer ? firstBuzzer.username : null // Sende nur den Namen
            });

        } catch (err) {
            console.log(`❌ Verbindung blockiert: Token ungültig (${socket.id})`);
            socket.disconnect();
            return;
        }

        emitPlayerListToHost(io);

        // ----------------------------------------------------
        // 2. BUZZER LOGIK (Spieler-Event)
        // ----------------------------------------------------
        socket.on('buzz', () => {
            // Nur Spieler dürfen buzzern, kein Host
            if (user.isHost) return;

            if (!buzzerLocked) {
                buzzerLocked = true;
                firstBuzzer = {
                    id: user.id,
                    username: user.username,
                    timestamp: new Date().toISOString()
                };
                //currentAnswers = []; // Antworten für die neue Frage zurücksetzen

                // Broadcast an ALLE (auch den Host): Jemand hat gebuzzert!
                io.emit('buzzed', {
                    username: firstBuzzer.username,
                    time: firstBuzzer.timestamp
                });

                console.log(`🔔 BUZZ: ${firstBuzzer.username} ist am Zug.`);
            }
        });

        // ----------------------------------------------------
        // 3. ANTWORT SENDEN LOGIK (Spieler-Event)
        // ----------------------------------------------------
        socket.on('submitAnswer', (answer) => {
            if (user.isHost) return;


            // Speichere die offizielle Antwort, falls der Host eine Historie braucht
            currentAnswers.push({
                playerId: user.id,
                username: user.username,
                answer: answer.text,
                time: new Date().toISOString()
            });

            // Sende die Antwort NUR an den Host zur Entscheidung
            // (Hier musst du später wissen, welche Socket-ID der Host hat, 
            // vorerst senden wir es an alle und der Host-Client filtert.)
            io.emit('newAnswer', { username: user.username, answer: answer.text });

            console.log(`✉️ Antwort erhalten von ${user.username}: ${answer.text}`);
        });

        // NEU: Live-Tippen-Event vom Spieler empfangen und an alle weiterleiten
        socket.on('playerTyping', (data) => {
            // Sicherstellen, dass nur Spieler-Eingaben verarbeitet werden
            if (user.isHost) return;

            // Sende die Eingabe an alle Clients. Der Host wird darauf reagieren.
            // Wichtig: Wir senden den Benutzernamen mit, damit der Host weiß, WER tippt.
            io.emit('typingUpdate', {
                username: currentPlayers[socket.id].username, // Greife auf den gespeicherten Usernamen zu
                text: data.text
            });
        });

        // NEU: Manueller Punkteabzug/Hinzufügung durch den Host
        socket.on('manualScoreAdjustment', (data) => {
            // 1. Host-Verifizierung
            // Wir verlassen uns auf das von der JWT-Middleware hinzugefügte socket.user-Objekt
            if (!user || !user.isHost) {
                console.log('❌ UNBEFUGTER ZUGRIFF: Score-Anpassung abgelehnt.');
                return;
            }

            const { username, amount } = data;

            // 2. Finde die Spieler-ID anhand des Benutzernamens in currentPlayers
            let playerIdToAdjust = null;
            let foundPlayer = null;

            // Durchsuche alle aktuell verbundenen Spieler
            for (const socketId in currentPlayers) {
                if (currentPlayers[socketId].username === username) {
                    // Die ID, die wir benötigen, ist die Benutzer-ID (user.id), 
                    // nicht die Socket-ID.
                    playerIdToAdjust = currentPlayers[socketId].id;
                    foundPlayer = currentPlayers[socketId];
                    break;
                }
            }

            if (playerIdToAdjust && typeof amount === 'number' && amount !== 0) {

                // NEU: Wenn der Spieler in gameScores noch nicht existiert, initialisiere ihn mit 0 Punkten.
                if (!gameScores[playerIdToAdjust]) {
                    gameScores[playerIdToAdjust] = {
                        points: 0,
                        firstBuzzes: 0,
                        username: username, // Verwende den Benutzernamen aus dem Request
                        correct: 0,
                        wrong: 0
                    };
                }

                // 3. Punkte anpassen
                gameScores[playerIdToAdjust].points += amount;

                console.log(`✅ HOST: Punkte von ${username} manuell angepasst um ${amount}. Neuer Score: ${gameScores[playerIdToAdjust].points}`);

                // 4. Aktualisierten Scoreboard an alle senden
                io.emit('currentScoreUpdate', gameScores);
            } else {
                console.log(`⚠️ HOST: Anpassung fehlgeschlagen. Spieler ${username} nicht gefunden (nur noch verbundene Spieler) oder ungültiger Betrag.`);
            }
        });

        // ----------------------------------------------------
        // 4. VERBINDUNG TRENNEN
        // ----------------------------------------------------
        socket.on('disconnect', () => {
            delete currentPlayers[socket.id];
            console.log(`🔌 Benutzer getrennt: ${user.username} (${socket.id})`);
            // HIER EINFÜGEN: Nach dem Löschen des Spielers
            delete currentPlayers[socket.id];

            // Sende die aktualisierte Liste nach Trennung
            emitPlayerListToHost(io);
        });

        socket.on('resetBuzzer', () => {
            // Nur Hosts dürfen zurücksetzen
            if (!user.isHost) return;

            if (buzzerLocked) {
                buzzerLocked = false;
                firstBuzzer = null;
                //currentAnswers = []; // Wichtig: Temporäre Antworten löschen

                // Broadcast an ALLE: Der Buzzer ist wieder frei!
                io.emit('resetQuestion');

                console.log(`🔄 HOST: Buzzer wurde von ${user.username} zurückgesetzt.`);

                // Sende auch ein Event zum Zurücksetzen der Spieler-UI (Skip-Button)
                // Wir verwenden hier das existierende Event, um die Spieler-UI zu resetten:
                io.emit('buzzerReady');
            }
        });

        socket.on('nextQuestion', () => {
            console.log("🔄 HOST: Fragenwechsel eingeleitet.");

            // 1. Server-Zustände für Buzzer zurücksetzen
            buzzerLocked = false;
            firstBuzzer = null;
            currentAnswers = []; // Antworten aus der letzten Frage leeren

            // 2. Skip-Zähler zurücksetzen (WICHTIG!)
            skipRequests.count = 0;
            skipRequests.playerIds.clear();

            // 3. Host über den Reset informieren (Skip-Anzeige auf 0 setzen)
            io.emit('skipCountUpdate', { count: 0 });

            // 4. Alle Spieler informieren, dass eine neue Frage gestartet wurde
            // Dies löst den Reset des Skip-Buttons beim Spieler aus.
            io.emit('newQuestionStarted');

            // Optional: Buzzer freigeben (falls 'buzzerReady' nicht durch ein anderes Event gesendet wird)
            io.emit('buzzerReady');
        });

        // ----------------------------------------------------
        // 6. HOST-STEUERUNG: Spieler bewerten/punkten
        // ----------------------------------------------------
        // server.js (Innerhalb des io.on('connection', ...) Blocks)

        // 6. HOST-STEUERUNG: Spieler bewerten/punkten (AKTUALISIERT)
        // socket/socketHandler.js (Ersetze den gesamten Block 'scorePlayer')

        socket.on('scorePlayer', ({ type, points }) => {

            // Prüfe, ob es der Host ist und ob überhaupt jemand gebuzzert hat
            if (!user.isHost || !firstBuzzer) return;

            // *** WICHTIGE FIX: Konvertiere den Punktwert in eine Ganzzahl (Integer) ***
            // Dadurch wird eine String-Konkatenation (z.B. "0" + "10" = "010") verhindert.
            const scorePoints = Math.floor(Number(points));

            // Prüfe nur auf NaN/null/undefined und setze auf 0 als Fallback
            if (isNaN(scorePoints)) {
                console.error("Ungültiger Punktewert vom Host empfangen: ", points);
                return; // Oder setze auf 0, je nach gewünschtem Verhalten
            }

            // Die Korrektheit wird direkt vom Host-Klick abgeleitet
            const isCorrect = (type === 'correct');

            // Sicherstellen, dass der Score-Eintrag existiert
            if (!gameScores[firstBuzzer.id]) {
                gameScores[firstBuzzer.id] = { points: 0, firstBuzzes: 0, username: firstBuzzer.username, correct: 0, wrong: 0 };
            }

            // Korrekte mathematische Addition des Zahlenwerts!
            gameScores[firstBuzzer.id].points += scorePoints;
            gameScores[firstBuzzer.id].firstBuzzes += 1;



            if (isCorrect) {
                gameScores[firstBuzzer.id].correct += 1;
            } else {
                gameScores[firstBuzzer.id].wrong += 1;
            }

            // Aktualisiere das Scoreboard für alle Clients
            io.emit('currentScoreUpdate', gameScores);

            // Sende spezifisches Event für Sound-Feedback (basierend auf 'type')
            if (isCorrect) {
                io.emit('correctAnswer', { username: firstBuzzer.username, points: scorePoints });
            } else {
                io.emit('wrongAnswer', { username: firstBuzzer.username, points: scorePoints });
            }

            console.log(`💰 HOST: ${firstBuzzer.username} als ${type} gewertet. Erhält ${scorePoints} Punkte. Neuer Score: ${gameScores[firstBuzzer.id].points}`);

            // Buzzer für die nächste Frage zurücksetzen
            buzzerLocked = false;
            firstBuzzer = null;
            currentAnswers = [];
            io.emit('resetQuestion');
        });

        // 7. HOST-STEUERUNG: SPIEL BEENDEN und STATISTIKEN SPEICHERN
        socket.on('endGame', async () => {
            if (!user.isHost) return;




            // 1. Game-Historie speichern (Dieser Teil sollte vorhanden sein)
            const playersResults = Object.keys(gameScores).map(id => ({
                playerId: id,
                username: gameScores[id].username,
                points: gameScores[id].points,
                firstBuzzes: gameScores[id].firstBuzzes,
                // Fügen Sie hier weitere Felder wie correct/wrong hinzu, falls Sie sie in der Game-Historie speichern wollen
            }));

            // Finde den Gewinner
            // ... (Ihre Winner-Logik) ...
            let winner = null;
            let maxPoints = -1;
            for (const id in gameScores) {
                if (gameScores[id].points > maxPoints) {
                    maxPoints = gameScores[id].points;
                    winner = id;
                }
            }

            const newGame = new Game({
                playersResults,
                winnerId: winner
            });
            await newGame.save();
            console.log(`🎉 SPIEL BEENDET. Ergebnisse in der Game-Historie gespeichert. Gewinner: ${winner}`);

            // ----------------------------------------------------
            // !!! KRITISCHE KORREKTUR BEGINNT HIER !!!
            // ----------------------------------------------------

            // 2. IDs aller Spieler definieren, die Punkte gesammelt haben (Behebt den ReferenceError)
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


            // 3. Globalen Zustand zurücksetzen und alle informieren
            gameScores = {}; // Spielpunkte leeren
            io.emit('gameEnded', { winnerId: winner }); // Alle Clients informieren

            // Optional: Host-Frontend kann nach diesem Event auf die Statistik-Seite umleiten
        });
    });
}