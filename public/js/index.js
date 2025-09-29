let token = localStorage.getItem('token');
let socket;
let countdownInterval = null;
const TIMER_DURATION = 10; // 10 Sekunden

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
            const isHost = data.isHost;

            token = data.token;
            localStorage.setItem('token', token);

            // Registrierungsbereich ausblenden (wird in login.html eh nur kurz angezeigt)
            // document.getElementById('register-area').style.display = 'none'; // Diese Zeile kann in login.html entfallen

            if (isHost) {
                statusEl.textContent = 'Host-Login erfolgreich! Weiterleitung zur Host-Zentrale...';
                window.location.href = '/host.html';
            } else {
                // 🔑 NEU: Weiterleitung zur separaten Spielerseite
                statusEl.textContent = 'Login erfolgreich! Weiterleitung zum Buzzerraum...';
                window.location.href = '/player.html';
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
    }

    // Verbindung herstellen und das Token mitsenden
    socket = io({
        query: { token: token }
    });

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

    // 🔑 NEU: Benutzername nach erfolgreicher Authentifizierung setzen
    socket.on('authSuccess', (data) => {
        const welcomeMessage = document.getElementById('welcome-message');
        if (welcomeMessage) {
            welcomeMessage.textContent = `Hallo ${data.username}!`;
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
    window.location.href = '/login.html';
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

const isPlayerPage = document.getElementById('buzzer-area') !== null;
const isLoginPage = document.getElementById('login-form') !== null;

if (token) {
    if (isPlayerPage) {
        // 1. Wenn ein Token vorhanden ist und wir auf der Spielerseite sind: Socket verbinden
        connectSocket();
        
        // Formulare ausblenden (wird auf player.html ignoriert, da sie fehlen)
        if (document.getElementById('login-form')) document.getElementById('login-form').style.display = 'none';
        if (document.getElementById('register-area')) document.getElementById('register-area').style.display = 'none';
        
    } else if (isLoginPage) {
        // 2. Wenn ein Token vorhanden ist, aber wir auf der login.html sind: 
        // Direkt zur Spielerseite weiterleiten
        window.location.href = '/login.html';
    }
} else {
    // 3. Wenn kein Token vorhanden ist und wir auf der Spielerseite sind: 
    // Zur Login-Seite zurückleiten (Sicherheitsmaßnahme)
    if (isPlayerPage) {
        window.location.href = '/login.html';
    }
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

if (document.getElementById('buzzer-area')) {
    if (token) {
        // Wenn ein Token vorhanden ist und wir auf der Spielerseite sind, Socket verbinden
        connectSocket();
    } else {
        // Wenn kein Token vorhanden ist, aber wir versuchen, auf die Spielerseite zuzugreifen
        alert('Nicht angemeldet. Weiterleitung zum Login.');
        window.location.href = '/login.html'; // Oder '/index.html', je nachdem, wie Sie die Login-Seite nennen
    }
}
