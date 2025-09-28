let token = localStorage.getItem('token');
let socket;
let playerTimerInterval = null;
let playerTimerSeconds = 0;
        
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

    function startPlayerTimer(duration, username) {
    playerTimerSeconds = duration;
    const displayContainer = document.getElementById('player-timer-display');
    const countdownEl = document.getElementById('player-countdown');
    const infoEl = document.getElementById('player-timer-info');

    displayContainer.style.display = 'block';
    infoEl.textContent = `${username} muss nun antworten...`;
    countdownEl.textContent = `${playerTimerSeconds}s`;

    // Deaktiviere den Buzzer (falls er durch einen anderen Spieler gebuzzert wurde)
    document.getElementById('buzzer-button').disabled = true;

    if (playerTimerInterval) {
        clearInterval(playerTimerInterval);
    }

    playerTimerInterval = setInterval(() => {
        playerTimerSeconds--;
        countdownEl.textContent = `${playerTimerSeconds}s`;

        if (playerTimerSeconds <= 0) {
            clearInterval(playerTimerInterval);
            playerTimerInterval = null;
            countdownEl.textContent = 'Zeit abgelaufen!';
            // ... (Hier könnten Sie Aktionen hinzufügen, z.B. dem Spieler ein Feedback geben)
        }
    }, 1000);
}

function stopPlayerTimer() {
    if (playerTimerInterval) {
        clearInterval(playerTimerInterval);
        playerTimerInterval = null;
    }
    document.getElementById('player-timer-display').style.display = 'none';
    document.getElementById('player-countdown').textContent = '';
    document.getElementById('player-timer-info').textContent = '';

    // Buzzer sollte beim Buzzer-Reset vom Host wieder aktiviert werden
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

            // NEU: Timer-Start-Signal vom Server empfangen
            socket.on('timerStarted', (data) => {
            startPlayerTimer(data.duration, data.username);
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
            
            // 2. NEU: Empfängt den aktualisierten Punktestand nach jeder Punktevergabe
            socket.on('currentScoreUpdate', (scores) => {
                updateScoreboard(scores);
            });

            // NEU: Spieler hört, bei welcher Frage der Host ist
            socket.on('currentQuestionStatus', (data) => {
            const displayEl = document.getElementById('question-status-display');
            if (data.current > 0) {
            displayEl.textContent = `Frage ${data.current} von ${data.total} läuft.`;
                } else {
            // Fall, wenn das Quiz beendet wird (current: 0)
            displayEl.textContent = 'Quiz beendet oder noch nicht gestartet.';
                }
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
                stopPlayerTimer();
            });

            function updateBuzzerStatus(text) {
                document.getElementById('buzzer-status').textContent = text;
            }
        }

        function buzz() {
            if (socket) {
                socket.emit('buzz');
                document.getElementById('buzzer-button').disabled = true;
                document.getElementById('buzzer-status').textContent = 'Du hast gebuzzert! Warte auf den Host...';
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

        // NEUE FUNKTION: Wird ausgelöst, wenn der Spieler auf "Frage skippen" klickt
function requestSkip() {
    if (socket && socket.connected) {
        // Sende das Event an den Server, das an den Host weitergeleitet wird
        socket.emit('requestSkipQuestion');
        
        // VISUELLES FEEDBACK: Deaktiviere den Button kurzzeitig
        const skipButton = document.getElementById('skip-button');
        skipButton.disabled = true;
        skipButton.textContent = 'Skip angefragt!';
        
        // Re-aktiviere den Button nach 15 Sekunden (damit er nicht für immer blockiert ist)
        setTimeout(() => {
            skipButton.disabled = false;
            skipButton.textContent = 'Frage skippen 🔁';
        }, 15000); // 15 Sekunden Sperre pro Spieler, um Spam zu verhindern
        
    } else {
        alert("Fehler: Verbindung zum Server getrennt.");
    }
}

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

   document.addEventListener('keydown', function(event) {
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