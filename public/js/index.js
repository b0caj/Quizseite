let token = localStorage.getItem('token');
let socket;
let countdownInterval = null;
const TIMER_DURATION = 10; // 10 Sekunden
let wbmCountdownInterval = null;
let revealedWbmAnswers = [];

async function handleLogin() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const statusEl = document.getElementById('login-status');

    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            const isHost = data.isHost; // NEU: Host-Status aus der Antwort abrufen

            token = data.token;
            localStorage.setItem('token', token);
            statusEl.textContent = 'Login erfolgreich!';

            // Registrierungsbereich ausblenden
            document.getElementById('register-area').style.display = 'none';

            // 🔑 WICHTIGE LOGIK: Host weiterleiten
            if (isHost) {
                statusEl.textContent = 'Host-Login erfolgreich! Weiterleitung zur Host-Zentrale...';
                // Leite den Host zur Host-Seite weiter
                window.location.href = '/host.html';
            } else {
                // Spieler: Bleibt auf dieser Seite und verbindet den Buzzer
                statusEl.textContent = 'Login erfolgreich! Verbinde mit Buzzerraum...';
                connectSocket();
            }
        } else {
            statusEl.textContent = `Fehler: ${data.message}`;
        }
    } catch (error) {
        statusEl.textContent = 'Verbindungsfehler zum Server.';
    }
}

async function handleRegister() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const statusEl = document.getElementById('register-status');

    // Einfache Frontend-Validierung
    if (!username || !password) {
        statusEl.textContent = 'Bitte Benutzername und Passwort eingeben.';
        return;
    }

    try {
        // Der korrigierte API-Pfad für die Registrierung
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            statusEl.textContent = `✅ Registrierung erfolgreich! Sie können sich nun als ${username} anmelden.`;
            // Optional: Felder leeren
            document.getElementById('reg-username').value = '';
            document.getElementById('reg-password').value = '';
        } else {
            statusEl.textContent = `❌ Fehler bei der Registrierung: ${data.message}`;
        }
    } catch (error) {
        statusEl.textContent = 'Verbindungsfehler zum Server während der Registrierung.';
        console.error('Registrierungsfehler:', error);
    }
}

function connectSocket() {
    if (!token) {
        document.getElementById('login-status').textContent = 'Fehler: Kein Token vorhanden.';
        return;


        socket = io('/buzzer', { query: { token } });


        // 1. NEU: Empfängt den gesamten Punktestand beim Verbinden
        socket.on('initialScores', (scores) => {
            updateScoreboard(scores);
        });

        // 2. NEU: Empfängt den aktualisierten Punktestand nach jeder Punktevergabe
        socket.on('currentScoreUpdate', (scores) => {
            updateScoreboard(scores);
        });

        socket.on('correctAnswer', (data) => {
            // Console-Ausgabe zur Bestätigung
            console.log(`✅ KORREKT gewertet! Punkte: ${data.points}`);
            playSound('correct'); // <-- Löst den Sound aus
        });

        // NEU: Spieler hört, wenn die Antwort als FALSCH gewertet wird
        socket.on('wrongAnswer', (data) => {
            // Console-Ausgabe zur Bestätigung
            console.log(`❌ FALSCH gewertet! Punkte: ${data.points}`);
            playSound('wrong'); // <-- Löst den Sound aus
        });
    }

    // Verbindung herstellen und das Token mitsenden
    socket = io({
        query: { token: token }
    });

    document.getElementById('login-form').style.display = 'none';
    document.getElementById('buzzer-area').style.display = 'block';
    document.getElementById('welcome-message').textContent = `Hallo ${document.getElementById('username').value}!`;

    const answerInput = document.getElementById('answer-input');
    answerInput.addEventListener('input', () => {
        if (socket) {
            // Sende ein neues Event 'playerTyping' mit dem aktuellen Text
            socket.emit('playerTyping', { text: answerInput.value });
        }
    });

    socket.on('connect', () => {
        // NEU: Token an den Server zur Authentifizierung senden
        if (token) {
            socket.emit('authenticate', token);
        }
    });

    socket.on('gameModeChanged', (mode) => {
        const classicArea = document.getElementById('classicBuzzerArea');
        const wbmArea = document.getElementById('wbm-bidding-area');

        if (mode === 'BIETEN_MEHR') {
            if (classicArea) classicArea.style.display = 'none';
            if (wbmArea) wbmArea.style.display = 'block';
            console.log(`[PLAYER] UI auf Modus ${mode} umgeschaltet.`);
            // Bei Modus-Wechsel Timer und Bid-Controls zurücksetzen/verstecken
            document.getElementById('wbm-prep-timer').style.display = 'none';
            document.getElementById('wbm-bid-controls').style.display = 'none';
            document.getElementById('wbm-answer-info').style.display = 'none';
        } else { // BUZZER
            if (classicArea) classicArea.style.display = 'block';
            if (wbmArea) wbmArea.style.display = 'none';
            console.log(`[PLAYER] UI auf Modus ${mode} umgeschaltet.`);
        }
        // Stellt sicher, dass der Timer gestoppt wird, falls er lief
        if (wbmCountdownInterval) clearInterval(wbmCountdownInterval);
    });

    socket.on('wbmRoundReset', () => {
        // Leere die globale Liste der aufgedeckten Antworten
        revealedWbmAnswers = [];

        if (wbmCountdownInterval) {
            clearInterval(wbmCountdownInterval);
            wbmCountdownInterval = null; // Setze die Variable zurück
        }

        // 🔑 NEU: 2. Die Timer-Anzeige zurücksetzen
        const display = document.getElementById('wbm-countdown-display');
        if (display) {
            display.textContent = "00:00";
        }

        // Leere den Container auf der index.html
        const container = document.getElementById('wbm-revealed-answers');
        if (container) {
            container.innerHTML = '';
        }

        // Setze alle WBM-spezifischen Anzeigen auf der Spielerseite zurück
        document.getElementById('wbm-category-display').textContent = 'Warten auf Host...';
        document.getElementById('wbm-error-counter').textContent = 'Fehler: 0/3';
        document.getElementById('wbm-bid-info').textContent = 'Warten auf Kategorie-Start.';

        // Blende alle unnötigen Elemente aus oder setze sie zurück (z.B. Gebots-Eingabe)
        // ...

        console.log('WBM-Rundenzustand und Timer zurückgesetzt.');
    });

    // NEU: Listener für den Start einer WBM-Runde
    socket.on('wbmRoundStarted', (data) => {
        document.getElementById('wbm-category-display').textContent = data.category;
        document.getElementById('wbm-bid-status').textContent = '';

        // --- Phasensteuerung ---
        if (data.phase === 'PREP') { // Vorbereitungsphase (5 Minuten)
            document.getElementById('wbm-prep-timer').style.display = 'block';
            document.getElementById('wbm-bid-controls').style.display = 'none';
            document.getElementById('wbm-answer-info').style.display = 'none';
            startWbmCountdown(5 * 60); // 5 Minuten Timer starten
        } else if (data.phase === 'BIDDING') { // Bietphase
            if (wbmCountdownInterval) clearInterval(wbmCountdownInterval); // Timer stoppen
            document.getElementById('wbm-prep-timer').style.display = 'none';
            document.getElementById('wbm-bid-controls').style.display = 'block';
            document.getElementById('wbm-bid-status').textContent = 'Bietphase aktiv!';
        }
    });

    socket.on('wbmAnswerRevealed', (data) => {
        // data sollte jetzt { answer: string, originalIndex: number } sein
        if (data.answer && typeof data.originalIndex === 'number') {
            updateWbmRevealedAnswers(data.answer, data.originalIndex);
        }
    });

    // NEU: Listener für ein neues Höchstgebot
    socket.on('newHighBid', (data) => {
        document.getElementById('current-high-bid-value').textContent = data.bid;
        document.getElementById('current-high-bidder').textContent = data.bidder;
        // Visuelles Feedback für den Spieler, der gerade dran ist (optional)
    });

    socket.on('wbmAuctionWon', (data) => {
        const wbmArea = document.getElementById('wbm-bidding-area');
        const prepTimer = document.getElementById('wbm-prep-timer');
        const bidControls = document.getElementById('wbm-bid-controls');
        const answerInfo = document.getElementById('wbm-answer-info');

        if (wbmArea && bidControls && answerInfo) {
            // 1. Alle anderen WBM-Bereiche ausblenden
            prepTimer.style.display = 'none';
            bidControls.style.display = 'none';

            // 2. Zuschlags-Meldung einblenden
            answerInfo.style.display = 'block';

            // 3. Details aktualisieren
            document.getElementById('wbm-final-bid').textContent = data.bid;

            console.log(`[PLAYER] AUCTION WON! Gebot: ${data.bid} für Kategorie: ${data.category}.`);
        }

        // Timer stoppen, falls er noch läuft
        if (wbmCountdownInterval) clearInterval(wbmCountdownInterval);
    });

    socket.on('biddingPhaseConcluded', (data) => {
        // Wenn es einen Gewinner gab und es NICHT der aktuelle Spieler ist
        if (data.finalBidderId && data.finalBidderId !== currentPlayers[socket.id]?.id) {
            const wbmArea = document.getElementById('wbm-bidding-area');
            const bidControls = document.getElementById('wbm-bid-controls');
            const prepTimer = document.getElementById('wbm-prep-timer');
            const answerInfo = document.getElementById('wbm-answer-info');

            if (wbmArea && bidControls && prepTimer && answerInfo) {
                // Alle Eingabebereiche ausblenden
                prepTimer.style.display = 'none';
                bidControls.style.display = 'none';
                answerInfo.style.display = 'none';

                // Status-Nachricht setzen
                document.getElementById('wbm-bid-status').textContent =
                    `Zuschlag an ${data.finalBidder} mit ${data.finalBid} Antworten erteilt. Runde beendet.`;
            }
        } else if (!data.finalBidderId) {
            // Fall: Keiner hat geboten
            document.getElementById('wbm-bid-status').textContent = 'Keine Gebote abgegeben. Runde beendet.';
        }
        // Timer stoppen
        if (wbmCountdownInterval) clearInterval(wbmCountdownInterval);
    });

    socket.on('wbmRoundConcluded', (data) => {
        const wbmArea = document.getElementById('wbm-bidding-area');
        if (!wbmArea) return;

        // Alle dynamischen WBM-Bereiche ausblenden
        document.getElementById('wbm-prep-timer').style.display = 'none';
        document.getElementById('wbm-bid-controls').style.display = 'none';
        document.getElementById('wbm-answer-info').style.display = 'none';

        const finalStatus = document.createElement('p');
        finalStatus.classList.add('status-message');

        // Nachricht basierend auf dem Ergebnis erstellen
        if (data.success && data.winnerId === currentPlayers[socket.id]?.id) {
            // Gewinner, der das Gebot erfüllt hat
            finalStatus.innerHTML = `🎉 **Runde erfolgreich!** Du hast ${data.correctAnswers} von ${data.finalBid} Antworten geliefert und **+${data.points} Punkte** erhalten.`;
            finalStatus.style.color = 'var(--success-color)';
        } else if (!data.success && data.winnerId === currentPlayers[socket.id]?.id) {
            // Gewinner, der das Gebot NICHT erfüllt hat
            finalStatus.innerHTML = `❌ **Gebot nicht erfüllt!** Du hast nur ${data.correctAnswers} von ${data.finalBid} Antworten geliefert und **${data.points} Punkte** erhalten.`;
            finalStatus.style.color = 'var(--danger-color)';
        } else {
            // Für alle anderen Spieler
            const outcome = data.success ? 'erfüllt' : 'nicht erfüllt';
            finalStatus.innerHTML = `Runde abgeschlossen. ${data.winner} hat ${data.correctAnswers} von ${data.finalBid} Antworten geliefert und das Gebot **${outcome}**. Sie erhielten **${data.points} Punkte**.`;
        }

        // Status-Bereich leeren und den finalen Status hinzufügen
        const bidStatus = document.getElementById('wbm-bid-status');
        bidStatus.innerHTML = '';
        bidStatus.appendChild(finalStatus);

        // Timer stoppen
        if (wbmCountdownInterval) clearInterval(wbmCountdownInterval);
    });
    socket.on('scoreUpdate', (scores) => {
        console.log('[HOST] Punkte-Update erhalten:', scores);
        // Ruft die Funktion auf, die die Tabelle neu zeichnet
        updateScoreboard(scores);
    });

    // NEU: Spieler hört, wenn eine korrekte Antwort gewertet wird
    socket.on('correctAnswer', (data) => {
        console.log(`✅ KORREKT gewertet! Punkte: ${data.points}`);
        playSound('correct');
    });

    // NEU: Spieler hört, wenn die Antwort als FALSCH gewertet wird
    socket.on('wrongAnswer', (data) => {
        console.log(`❌ FALSCH gewertet! Punkte: ${data.points}`);
        playSound('wrong');
    });

    socket.on('newQuestionStarted', () => {
        // 1. Skip-Button zurücksetzen und reaktivieren
        const skipButton = document.getElementById('skip-button');
        skipButton.textContent = "Frage überspringen anfragen";
        skipButton.disabled = false;

        // 2. UI-Elemente zurücksetzen/anzeigen
        document.getElementById('buzzer-area').style.display = 'block';
        document.getElementById('skip-controls').style.display = 'block';
        document.getElementById('answer-submission-area').style.display = 'none';

        // 3. Status-Nachricht aktualisieren
        document.getElementById('buzzer-status').textContent = "BUZZ READY! Warte auf dein Signal.";
    });

    // 2. NEU: Empfängt den aktualisierten Punktestand nach jeder Punktevergabe
    socket.on('currentScoreUpdate', (scores) => {
        updateScoreboard(scores);
    });

    // Server sendet den aktuellen Zustand
    socket.on('gameState', (state) => {
        if (state.buzzerLocked) {
            updateBuzzerStatus(`Buzzer ist gesperrt. ${state.firstBuzzer} hat gebuzzert.`);
            document.getElementById('buzzer-button').disabled = true;
        }
    });

    // Server signalisiert, dass jemand gebuzzert hat
    socket.on('buzzed', (data) => {
        updateBuzzerStatus(`📢 ${data.username} hat gebuzzert!`);
        document.getElementById('buzzer-button').disabled = true;
        playSound('buzz');
        startBuzzerTimer();
    });

    // Server signalisiert Zurücksetzung (kommt später vom Host)
    socket.on('resetQuestion', () => {
        updateBuzzerStatus('Warte auf die nächste Frage...');
        document.getElementById('buzzer-button').disabled = false;
        stopBuzzerTimer();
    });

    socket.on('gameEnded', () => {
        // Leert die Tabelle und setzt den Status zurück
        updateScoreboard({});
        document.getElementById('question-progress').style.display = 'none';
        document.getElementById('buzzer-status').textContent = "Das Spiel ist beendet. Warten auf den Host...";
    });

    // 3. Optional: Tabelle beim Spielende zurücksetzen (nur für index.html und host.html)
    //socket.on('gameEnded', () => {
    // updateScoreboard({}); // Leert die Tabelle
    // document.getElementById('question-progress').style.display = 'none';
    //  });

    function updateBuzzerStatus(text) {
        document.getElementById('buzzer-status').textContent = text;
    }
}

function buzz() {
    const buzzerButton = document.getElementById('buzzer-button');
    const statusEl = document.getElementById('buzzer-status');

    // 1. Client-seitige Sofort-Sperre
    if (buzzerButton.disabled) {
        return; // Verhindert Doppelklicks
    }

    // UI sofort ändern, um Latenz zu überbrücken
    buzzerButton.disabled = true;
    //buzzerButton.textContent = "GEBUZZT";
    statusEl.textContent = "Warte auf Serverbestätigung...";

    // Spielen Sie den Sound sofort ab
    // Stellen Sie sicher, dass Ihre playSound-Funktion (wenn vorhanden) hier aufgerufen wird:
    playSound('buzz');

    // 2. Event an den Server senden
    if (socket && socket.connected) {
        socket.emit('buzz');
    }
}

function submitAnswer() {
    const answerText = document.getElementById('answer-input').value;
    if (socket && answerText) {
        socket.emit('submitAnswer', { text: answerText });
        document.getElementById('answer-input').value = '';
    }
}

function startBuzzerTimer() {
    let timeLeft = TIMER_DURATION;
    const timerDisplay = document.getElementById('buzzer-timer');
    const timerContainer = document.getElementById('buzzer-timer-container');

    // 1. UI vorbereiten
    if (timerContainer) {
        timerContainer.style.display = 'block';
    }

    // Stoppt jeden vorherigen Timer
    //stopBuzzerTimer();

    // 2. Startet den Countdown
    countdownInterval = setInterval(() => {
        timeLeft -= 1;
        timerDisplay.textContent = timeLeft;
        timerDisplay.classList.remove('timer-flash'); // Entfernt den Flash für konstante Anzeige

        // Visuelles Feedback bei geringer Zeit
        if (timeLeft <= 5) {
            timerDisplay.classList.add('timer-flash'); // Fügt Flash-Effekt hinzu
        }

        // Timer abgelaufen
        if (timeLeft <= 0) {
            stopBuzzerTimer();
            timerDisplay.textContent = 'ZEIT ABGELAUFEN!';
            timerDisplay.classList.remove('timer-flash');

            // Optional: Senden Sie ein Event an den Server, dass der Timer abgelaufen ist (nur Host-Seite)
            if (typeof isHost !== 'undefined' && isHost) {
                // Nur wenn es sich um den Host handelt, könnte ein Server-Event gesendet werden
                // z.B. socket.emit('timesUp');
            }
        }
    }, 1000);
}

function stopBuzzerTimer() {
    // 1. ZUERST den laufenden Interval-Zähler stoppen und Variable leeren
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null; // Wichtig: Muss auf null gesetzt werden, damit der nächste Start funktioniert
    }

    // 2. DOM-Elemente zurücksetzen/ausblenden
    const timerContainer = document.getElementById('buzzer-timer-container');
    const timerDisplay = document.getElementById('buzzer-timer');

    if (timerContainer) {
        timerContainer.style.display = 'none'; // Timer ausblenden
    }
    if (timerDisplay) {
        timerDisplay.textContent = TIMER_DURATION; // Zähler auf 10 zurücksetzen
        timerDisplay.classList.remove('timer-flash'); // Optional: Visuellen Effekt entfernen
    }
}
// public/index.html (Innerhalb des <script> Tags)

// NEUE LOGOUT-FUNKTION
function logout() {
    localStorage.removeItem('token');
    if (socket) {
        socket.disconnect();
    }
    // Ansichtsmodi zurücksetzen
    document.getElementById('buzzer-area').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('login-status').textContent = 'Erfolgreich abgemeldet.';
    token = null; // Wichtig: Auch die JavaScript-Variable zurücksetzen
}


function updateScoreboard(scores) {
    const tableBody = document.querySelector('#current-scores tbody');
    tableBody.innerHTML = '';

    // Konvertiere das gameScores-Objekt in ein Array und sortiere es nach Punkten (absteigend)
    const sortedScores = Object.values(scores).sort((a, b) => b.points - a.points);

    if (sortedScores.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="2">Noch keine Punkte vergeben.</td></tr>';
        return;
    }

    sortedScores.forEach(scoreData => {
        const row = tableBody.insertRow();
        row.innerHTML = `
            <td>${scoreData.username}</td>
            <td>${scoreData.points}</td>
        `;
    });
}

function playSound(file) {
    const audio = new Audio(`/assets/${file}.mp3`); // Pfad anpassen!
    audio.play().catch(e => console.log("Audio konnte nicht abgespielt werden:", e));
}

document.addEventListener('keydown', function (event) {
    // Prüfen, ob die Leertaste (key code 32) gedrückt wurde
    if (event.key === ' ' || event.keyCode === 32) {

        const activeElement = document.activeElement;
        const tagName = activeElement.tagName.toLowerCase();

        // Verhindere das Buzzern, wenn der Fokus auf einem Eingabefeld liegt.
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeElement.isContentEditable) {
            // Wenn der Benutzer gerade tippt, soll die Leertaste das normale Leerzeichen einfügen
            return;
        }

        // Verhindere das Standardverhalten der Leertaste (z.B. Scrollen der Seite)
        event.preventDefault();

        // Simuliere den Klick auf den Buzzer-Button
        // Die buzz()-Funktion wird ausgeführt, wenn der Buzzer-Bereich sichtbar ist
        if (document.getElementById('buzzer-area').style.display === 'block') {
            buzz();
        }
    }
});

if (token) {
    // 1. Zuerst die Formulare ausblenden, falls sie sichtbar sind
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-area').style.display = 'none';

    // 2. Verbindung herstellen
    connectSocket();
}

function requestSkip() {
    if (socket && socket.connected) {
        socket.emit('requestSkip');

        const skipButton = document.getElementById('skip-button');
        skipButton.textContent = "Anfrage gesendet! 👍";
        skipButton.disabled = true; // Button deaktivieren, damit man nur einmal pro Frage voten kann
    }
}
socket.on('resetQuestion', () => {
    // Stellen Sie sicher, dass dies beim Start einer neuen Frage aufgerufen wird
    const skipButton = document.getElementById('skip-button');
    skipButton.textContent = "Frage überspringen anfragen";
    skipButton.disabled = false;
    //stopBuzzerTimer()
});

// NEU: Steuerung der Sichtbarkeit der Skip-Funktion
socket.on('buzzerReady', () => {
    document.getElementById('skip-controls').style.display = 'block';
    stopBuzzerTimer();
});

socket.on('buzzerLocked', () => {
    document.getElementById('skip-controls').style.display = 'none';
});


// NEU: Listener für den Fragenfortschritt vom Host
socket.on('questionProgressUpdate', (data) => {
    const progressElement = document.getElementById('question-progress');
    const currentDisplay = document.getElementById('current-question-display');
    const totalDisplay = document.getElementById('total-questions-display');

    if (data.currentQuestion && data.totalQuestions) {
        currentDisplay.textContent = data.currentQuestion;
        totalDisplay.textContent = data.totalQuestions;
        // Anzeige einblenden, wenn die Daten verfügbar sind
        progressElement.style.display = 'block';
    } else {
        progressElement.style.display = 'none';
    }
});

// Funktion zum Senden des Gebots an den Server
function submitBid() {
    const bidValue = parseInt(document.getElementById('wbm-bid-input').value, 10);
    const bidStatus = document.getElementById('wbm-bid-status');

    if (socket && socket.connected && bidValue > 0) {
        // Gebotsanforderung an den Server senden
        socket.emit('submitBid', bidValue);
        bidStatus.textContent = `Dein Gebot (${bidValue}) wurde gesendet.`;
        document.getElementById('wbm-bid-input').value = '';
    } else {
        bidStatus.textContent = 'Bitte gib ein Gebot größer als 0 ein.';
    }
}

function startWbmCountdown(durationInSeconds) {
    let timer = durationInSeconds;
    const display = document.getElementById('wbm-countdown-display');

    if (wbmCountdownInterval) clearInterval(wbmCountdownInterval);

    wbmCountdownInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        display.textContent = minutes + ":" + seconds;

        if (--timer < 0) {
            clearInterval(wbmCountdownInterval);
            display.textContent = "Zeit abgelaufen!";
            // Hier könnte der Server über das Ende der Vorbereitung informiert werden,
            // aber wir lassen das vorerst dem Host überlassen.
        }
    }, 1000);
}
function updateWbmRevealedAnswers(answer, originalIndex) {
    const container = document.getElementById('wbm-revealed-answers');
    if (!container) return;

    // 1. Fügen Sie die neue Antwort der Liste hinzu (überprüfen Sie, ob sie bereits da ist, um Duplikate zu vermeiden)
    const existing = revealedWbmAnswers.find(a => a.originalIndex === originalIndex);
    if (!existing) {
        // Hinzufügen der Antwort mit dem ursprünglichen Index
        revealedWbmAnswers.push({ answer, originalIndex });
    } else if (answer !== existing.answer) {
        // Optional: Antwort aktualisieren, falls sich der Text geändert hat, aber der Index gleich ist
        existing.answer = answer;
    } else {
        // Antwort ist bereits bekannt und identisch, nichts tun
        return;
    }

    // 2. Sortieren Sie die Antworten nach dem ursprünglichen Index (aufsteigend)
    revealedWbmAnswers.sort((a, b) => a.originalIndex - b.originalIndex);

    // 3. Den Container leeren und die sortierte Liste neu rendern
    container.innerHTML = '';

    revealedWbmAnswers.forEach((data) => {
        const answerEl = document.createElement('li');
        answerEl.className = 'wbm-revealed-answer-item neon-text';

        // Die Nummerierung basiert jetzt auf dem Original-Index (0-basiert + 1)
        answerEl.textContent = `Antwort #${data.originalIndex + 1}: ${data.answer}`;

        container.appendChild(answerEl);
    });
}