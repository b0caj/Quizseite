// socket/socketHandler.js

const jsonwebtoken = require('jsonwebtoken');
const Player = require('../models/Player');
const Game = require('../models/Game');
const Quiz = require('../models/Quiz');
//const stats = gameScores[playerId]; 

// --- Globaler Spielzustand (MUSST DU VON server.js HIERHER VERSCHIEBEN) ---
let gameScores = {};
let buzzerLocked = false;
let firstBuzzer = null;
let currentPlayers = {};
let currentAnswers = [];
let currentQuiz = null;
let currentQuestionIndex = 0; // Ebenfalls nützlich für den Server


let skipRequests = { count: 0, playerIds: new Set() };
// NEU: Zustand für den Spielmodus
let gameMode = 'BUZZER';
let wbmState = {
    category: null,
    bids: {}, // { playerId: bidValue, ... }
    currentBidderId: null,
    currentBid: 0,
    maxErrors: 3,// Max. Fehler, bevor die Runde verloren ist (wie im Video)
    wbmAnswers: [],          // Die komplette Liste der Antworten (wird beim Rundenstart geladen)
    revealedWbmAnswers: []   // Die Antworten, die bereits aufgedeckt wurden
};
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

            socket.on('setGameMode', (mode) => {
                // Sicherstellen, dass der Modus gültig ist
                if (mode === 'BUZZER' || mode === 'BIETEN_MEHR') {
                    gameMode = mode;
                    // Host-Nachricht zurücksenden, um die UI im Host-Browser zu aktualisieren
                    socket.emit('gameModeSet', mode);
                    // Alle Spieler informieren, damit sie ihre UI anpassen können (nächster Schritt)
                    io.emit('gameModeChanged', mode);

                    console.log(`[SERVER] Spielmodus auf ${mode} gesetzt. Clients informiert.`);
                }
            });

            // Listener für den Host, um eine WBM-Runde zu starten
            // socketHandler.js: AKTUALISIERTER LISTENER FÜR RUNDENSTART

            // Listener für den Host, um eine WBM-Runde zu starten
            socket.on('startWbmRound', async (data) => {
                // Stellen Sie sicher, dass sich der Server im richtigen Modus befindet
                if (gameMode !== 'BIETEN_MEHR') return;

                // Wir gehen davon aus, dass der Host die Quiz-ID übermittelt
                const { quizId, category } = data;

                // Optional: Überprüfen Sie, ob der Absender der Host ist
                // if (!user || !user.isHost) return; 

                if (!quizId) {
                    console.error('[SERVER] WBM-Startfehler: Keine Quiz-ID angegeben.');
                    return;
                }

                try {
                    // 1. Quiz aus der Datenbank laden (nur die wbmAnswers und Kategorie)
                    // Wir suchen das Quiz anhand der ID.
                    const loadedQuiz = await Quiz.findById(quizId).select('wbmAnswers').exec();

                    if (!loadedQuiz) {
                        console.error(`[SERVER] WBM-Startfehler: Quiz mit ID ${quizId} nicht gefunden.`);
                        socket.emit('hostError', `Quiz mit ID ${quizId} nicht gefunden.`);
                        return;
                    }

                    // 2. Antworten aus dem geladenen Dokument abrufen
                    // ANNAHME: wbmAnswers ist ein Array von Strings (gemäß Quiz.js Schema).
                    const answers = loadedQuiz.wbmAnswers || [];

                    // 3. Zustand für neue Runde zurücksetzen und setzen
                    wbmState.category = category;
                    wbmState.bids = {};
                    wbmState.currentBid = 0;
                    wbmState.currentBidderId = null;
                    wbmState.currentBidderUsername = null;

                    // *** WICHTIG: Antworten im Server-Zustand speichern ***
                    wbmState.wbmAnswers = answers;
                    wbmState.revealedWbmAnswers = []; // Array der bereits aufgedeckten Antworten zurücksetzen

                    currentQuiz = loadedQuiz;

                    // 4. Antworten NUR an den Host senden (zum Aufdecken)
                    // Host erhält die vollständige Liste. Spieler erhalten nur die Kategorie.
                    if (user.isHost) {
                        // Sende die rohen Antworten zur Verarbeitung im Host-Client
                        socket.emit('wbmAnswersLoaded', {
                            answers: wbmState.wbmAnswers
                        });
                        console.log(`✅ WBM: ${wbmState.wbmAnswers.length} Antworten an Host gesendet.`);
                    }

                    // 5. Spieler und Host über Start der Vorbereitungsphase informieren
                    io.emit('wbmRoundStarted', { category: category, phase: 'PREP' });
                    socket.emit('newHighBid', { bidder: 'niemand', bid: 0, allBids: {} });

                    console.log(`[SERVER] WBM-Runde gestartet: ${category} (Vorbereitung)`);

                    // 6. Timer für Bietphase (bleibt gleich)
                    const PREP_TIME_MS = 5 * 60 * 1000;

                    setTimeout(() => {
                        io.emit('wbmRoundStarted', { category: category, phase: 'BIDDING' });
                        console.log(`[SERVER] WBM: Vorbereitungszeit abgelaufen. Bietphase aktiv.`);
                    }, PREP_TIME_MS);

                } catch (error) {
                    console.error('[SERVER] Fehler beim Laden des Quiz für WBM-Start:', error);
                    socket.emit('hostError', 'Fehler beim Laden der WBM-Antworten.');
                }
            });

            socket.on('startNewWbmRound', () => {
                // Nur der Host darf diesen Befehl senden. (Stellen Sie sicher, dass dies durch Authentifizierung geschützt ist,
                // oder verlassen Sie sich auf die Client-Logik, die nur dem Host den Button zeigt.)

                // 1. Den WBM-Zustand zurücksetzen
                wbmState = {
                    category: null,
                    bids: {},
                    currentBidderId: null,
                    currentBid: 0,
                    maxErrors: 3,
                    wbmAnswers: [],
                    revealedWbmAnswers: []
                };

                console.log(`✅ WBM-Zustand zurückgesetzt. Neue Runde bereit.`);

                // 2. Spieler über den Neustart der Runde informieren
                // Wir senden ein leeres Array für die Antworten und setzen den Zustand zurück.
                io.emit('wbmRoundReset');

                // 3. Optional: Den Spielmodus zurücksetzen, falls er auf 'WBM_RUNNING' war
                // gameMode = 'BUZZER'; // Nur falls der Modus global gesteuert wird
            });

            socket.on('wbmRoundStarted', (data) => {
                // WICHTIG: Prüfen, ob die Phase 'PREP' ist (Vorbereitungsphase)
                if (data.phase === 'PREP') {
                    console.log('WBM Round Started Event empfangen. Starte Host-Timer.');
                    // Ruft die neue Funktion auf
                    startWbmHostCountdown(5 * 60);
                } else if (data.phase === 'BIDDING') {
                    // Timer stoppen und Container ausblenden, wenn die Bietphase beginnt
                    if (wbmHostCountdownInterval) clearInterval(wbmHostCountdownInterval);
                    const container = document.getElementById('wbm-host-timer-container');
                    if (container) container.style.display = 'none';
                }
            });

            socket.on('revealWbmAnswer', ({ answerIndex }) => {
                // Host-Prüfung (falls implementiert)
                // if (socket.user && !socket.user.isHost) return; 

                const answer = wbmState.wbmAnswers[answerIndex];

                if (!answer || wbmState.revealedWbmAnswers.includes(answer)) {
                    console.log(`Fehler: Ungültiger Index ${answerIndex} oder Antwort bereits aufgedeckt.`);
                    return;
                }

                if (currentQuiz.gameMode === 'BIETEN_MEHR') {
                    wbmState.wbmAnswers = Quiz.wbmAnswers; // Array of strings
                    wbmState.revealedWbmAnswers = [];
                    socket.emit('wbmAnswersLoaded', { answers: wbmState.wbmAnswers }); // NUR an den Host senden
                }

                // Zustand aktualisieren
                wbmState.revealedWbmAnswers.push(answer);

                // Antwort aufgedeckt
                const answerToReveal = answer;
                // Sende die aufgedeckte Antwort an ALLE (Host und Spieler)
                io.emit('wbmAnswerRevealed', {
                    answer: answerToReveal,
                    originalIndex: answerIndex // <-- Hier senden wir den Index mit
                });

                console.log(`✅ WBM Antwort ${answerIndex} ('${answer}') aufgedeckt.`);
            });

            // Listener für Spieler, die ein Gebot abgeben
            socket.on('submitBid', (bidValue) => {
                if (gameMode !== 'BIETEN_MEHR') return;

                const playerId = currentPlayers[socket.id].id;
                const username = currentPlayers[socket.id].username;

                // 1. Validierung des Gebots
                if (typeof bidValue !== 'number' || bidValue <= wbmState.currentBid) {
                    socket.emit('wbmBidRejected', 'Dein Gebot muss höher sein als das aktuelle Höchstgebot.');
                    return;
                }

                // 2. Zustand aktualisieren (Speicherung für alle Gebote)
                wbmState.bids[playerId] = {
                    bid: bidValue,
                    username: username,
                    playerId: playerId
                };

                // 3. Höchstgebot aktualisieren
                wbmState.currentBid = bidValue;
                wbmState.currentBidderId = playerId;
                wbmState.currentBidderUsername = username;

                // 4. Alle (inkl. Host) über das neue Höchstgebot informieren
                // Wir senden die gesamte Liste der abgegebenen Gebote an den Host (updateWbmBidTable)
                io.emit('newHighBid', {
                    bidder: username,
                    bid: bidValue,
                    allBids: wbmState.bids // NEU: Alle Gebote für Host-Tabelle senden
                });
                console.log(`[SERVER] WBM: Neues Höchstgebot: ${username} bietet ${bidValue}.`);
            });

            socket.on('stopBiddingPhase', () => {
                if (gameMode !== 'BIETEN_MEHR') return;

                // Daten des finalen Bieters
                const finalBidder = wbmState.currentBidderUsername;
                const finalBid = wbmState.currentBid;
                const finalBidderId = wbmState.currentBidderId;

                if (finalBidderId) {
                    console.log(`[SERVER] WBM: Biet-Phase beendet. Zuschlag an ${finalBidder} mit Gebot ${finalBid}.`);

                    // Spieler informieren
                    io.emit('biddingPhaseConcluded', {
                        finalBidder: finalBidder,
                        finalBid: finalBid,
                        finalBidderId: finalBidderId
                    });

                    // UI-Update nur für den Spieler, der den Zuschlag erhalten hat
                    io.to(currentPlayers[finalBidderId].socketId).emit('wbmAuctionWon', {
                        bid: finalBid,
                        category: wbmState.category
                    });

                } else {
                    // Fall: Kein Gebot abgegeben
                    io.emit('biddingPhaseConcluded', { finalBidder: null });
                    console.log('[SERVER] WBM: Biet-Phase beendet. Kein Gebot abgegeben.');
                }

                /* Zustand für nächste Runde zurücksetzen, aber Kategorie beibehalten, bis Host neue startet
                wbmState.currentBid = 0;
                wbmState.currentBidderId = null;
                wbmState.bids = {}; */
            });

            socket.on('submitWbmRoundScore', (data) => {
                // Prüfen, ob wir im WBM-Modus sind und ein Gewinner feststeht
                if (gameMode !== 'BIETEN_MEHR' || !wbmState.currentBidderId) {
                    console.log('[SERVER] WBM: Fehler beim Eintragen der Punkte. Modus falsch oder kein Bieter.');
                    return;
                }

                const { correctAnswers, correctPoints, incorrectPoints } = data;
                const playerId = wbmState.currentBidderId;
                const finalBid = wbmState.currentBid;
                const username = wbmState.currentBidderUsername;
                let pointsAwarded = 0;
                let success = false;

                // 1. Punkte berechnen (WBM Logik)
                if (correctAnswers >= finalBid) {
                    // Gebot erfüllt oder übertroffen: Punkte basierend auf dem Gebot * Host-Regel vergeben
                    pointsAwarded = finalBid * correctPoints;
                    success = true;
                    console.log(`[SERVER] WBM: ${username} hat Gebot (${finalBid}) erfüllt. +${pointsAwarded} Punkte.`);
                } else {
                    // Gebot nicht erfüllt: Host-Regel für falsche Antwort (Strafe) anwenden
                    pointsAwarded = incorrectPoints;
                    success = false;
                    console.log(`[SERVER] WBM: ${username} hat Gebot (${finalBid}) nicht erfüllt (${correctAnswers} korr.). ${pointsAwarded} Punkte.`);
                }

                // 2. Punkte im Spielstand aktualisieren
                if (!gameScores[playerId]) {
                    gameScores[playerId] = {
                        username: username,
                        points: 0,
                        firstBuzzes: 0,
                        correct: 0,
                        wrong: 0,
                    };
                }
                gameScores[playerId].points += pointsAwarded;

                // 3. WBM-Statistiken aktualisieren (WBM wird als "Antwort" gezählt)
                if (success) {
                    gameScores[playerId].correct += 1;
                } else {
                    gameScores[playerId].wrong += 1;
                }

                // 4. Clients informieren (Scoreboard-Update)
                io.emit('scoreUpdate', gameScores);

                // 5. Host und Spieler über Rundenende informieren (Reset)
                io.emit('wbmRoundConcluded', {
                    success: success,
                    winner: username,
                    points: pointsAwarded,
                    finalBid: finalBid,
                    correctAnswers: correctAnswers,
                    winnerId: playerId // Für die Spieler-UI
                });

                // 6. Globalen WBM-Zustand zurücksetzen
                wbmState.category = null;
                wbmState.bids = {};
                wbmState.currentBid = 0;
                wbmState.currentBidderId = null;
                wbmState.currentBidderUsername = null;
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

        socket.on('questionProgressUpdate', (data) => {
            // Verwende socket.broadcast.emit, um die Daten an ALLE ANDEREN
            // verbundenen Clients (die Spieler) zu senden, aber nicht zurück an den Host (den Sender).
            socket.broadcast.emit('questionProgressUpdate', data);
            console.log(`[SERVER] Fortschritt gebroadcastet: Frage ${data.currentQuestion}/${data.totalQuestions}`);
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
                correctAnswers: stats.correct || 0,
                wrongAnswers: stats.wrong || 0,
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