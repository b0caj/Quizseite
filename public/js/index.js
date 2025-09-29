let token = localStorage.getItem('token');
let socket;

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

        // 3. Optional: Tabelle beim Spielende zurücksetzen (nur für index.html und host.html)
        socket.on('gameEnded', () => {
            updateScoreboard({}); // Leert die Tabelle
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
    });

    // Server signalisiert Zurücksetzung (kommt später vom Host)
    socket.on('resetQuestion', () => {
        updateBuzzerStatus('Warte auf die nächste Frage...');
        document.getElementById('buzzer-button').disabled = false;
    });

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
});

// NEU: Steuerung der Sichtbarkeit der Skip-Funktion
socket.on('buzzerReady', () => {
    document.getElementById('skip-controls').style.display = 'block';
});

socket.on('buzzerLocked', () => {
    document.getElementById('skip-controls').style.display = 'none';
});