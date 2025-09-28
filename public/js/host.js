
        // === GLOBALE VARIABLEN ===
        let token = localStorage.getItem('token'); 
        let socket;
        let firstBuzzerId = null; 
        let currentQuiz = null;
        let currentQuestionIndex = 0;
        let latestPlayerAnswers = {};
        let playerSkipRequests = {}; // NEU: Speichert die Spieler, die skippen möchten
        let timerInterval = null;
        let timerSeconds = 0;

        // === ALLGEMEINE FUNKTIONEN ===

        function logout() {
            localStorage.removeItem('token'); 
            if (socket) {
                socket.disconnect();
            }
            window.location.href = '/'; 
        }

        function updateScoreboard(scores) {
            const tableBody = document.querySelector('#current-scores tbody');
            tableBody.innerHTML = '';
            
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

        function renderLatestAnswers() {
    const answersList = document.getElementById('answers-list');
    answersList.innerHTML = ''; // Liste leeren

    // Gehe durch die gespeicherten letzten Antworten und zeige sie an
    for (const username in latestPlayerAnswers) {
        const answerData = latestPlayerAnswers[username];
        const li = document.createElement('li');
        // Zeige den Zeitstempel (nur Zeit) für Kontext
        const time = new Date(answerData.time).toLocaleTimeString(); 
        li.textContent = `[${username} (${time})]: ${answerData.answer}`;
        answersList.appendChild(li);
    }
}

        // NEUE FUNKTION: Aktualisiert die Anzeige der Skip-Wünsche
// host.js (NACH anderen Funktionen wie updateScoreboard oder renderLatestAnswers)

// NEUE FUNKTION: Aktualisiert die Anzeige der Skip-Wünsche
function renderSkipRequests() {
    const skipCountEl = document.getElementById('skip-count'); 
    const skipListEl = document.getElementById('skip-players-list');
    
    // 🔥 DIESER TEST IST WICHTIG
    if (!skipCountEl || !skipListEl) {
        console.error("❌ Eines der Skip-DOM-Elemente wurde nicht gefunden!");
        return; // Die Funktion stoppt hier.
    }
    // playerSkipRequests ist die globale Variable, die die Spieler speichert
    const players = Object.keys(playerSkipRequests); 
    
    skipListEl.innerHTML = ''; // ✅ Korrektur: skipListEl verwenden

    skipCountEl.textContent = `${players.length} Spieler möchten skippen.`; // ✅ Korrektur: skipCountEl verwenden
    
     // ⬇️ NEUE LOGIK FÜR VISUELLEN ALARM ⬇️
    if (players.length > 0) {
        skipRequestArea.classList.add('skip-active');
    } else {
        skipRequestArea.classList.remove('skip-active');
    }

    players.forEach(username => {
        const li = document.createElement('li');
        // Zeige den Namen und den Zeitpunkt des Wunsches
        li.textContent = `${username} (um ${playerSkipRequests[username]})`;
        list.appendChild(li);
    });
}
        
        function resetBuzzer() {
            if (socket) {
                socket.emit('resetBuzzer');
            }
             stopTimer(); 
        }
// NEUE FUNKTION: Sendet das Event zum Sperren des Buzzers
function lockBuzzer() {
    if (socket) {
        socket.emit('lockBuzzer'); // Sendet das neue Event an den Server
        // Optional: Sofortige visuelle Rückmeldung im Host-Dashboard
        document.getElementById('buzzer-status').textContent = 'Buzzer ist gesperrt.';
    }
}
        
        function triggerScoreAdjustment() {
    // NEU: Wert aus dem Dropdown statt aus dem Textfeld auslesen
    const username = document.getElementById('adj-player-select').value; 
    const amount = parseInt(document.getElementById('adj-amount').value);

    if (!username || username.trim() === '') {
        alert("Bitte wählen Sie einen Spieler aus.");
        return;
    }

    if (isNaN(amount) || amount === 0) {
        alert("Bitte geben Sie einen gültigen, nicht null Betrag ein (z.B. 5 oder -3).");
        return;
    }

    // Sende die manuelle Anpassung an den Server.
    socket.emit('manualScoreAdjustment', {
        username: username, 
        amount: amount
    });

    // Optional: Eingabefeld leeren und Dropdown zurücksetzen
    document.getElementById('adj-amount').value = '';
    document.getElementById('adj-player-select').value = ''; // Setzt den Wert auf ""
}

function scorePlayer(type) {
    if (!socket) return; // Prüfen, ob Socket verbunden ist

    // Sicherstellen, dass die Punkte-Werte als Ganzzahlen gelesen werden
    // Fallback auf 10 bzw. 0, falls die Felder leer sind
    const correctPoints = parseInt(document.getElementById('correctPoints').value, 10) || 10;
    const incorrectPoints = parseInt(document.getElementById('incorrectPoints').value, 10) || 0; 

    let pointsToSend; 
    
    if (type === 'correct') {
        pointsToSend = correctPoints; // Weise den korrekten Wert zu
        playSound('correct');
    } else if (type === 'incorrect') {
        pointsToSend = incorrectPoints; // Weise den inkorrekten Wert zu
        playSound('wrong');
    } else {
        return;
    }
    
    // ZUSÄTZLICHER KONSOLEN-CHECK: Prüfen, ob der Wert wirklich eine Zahl ist
    console.log(`[HOST-Frontend] Sende Typ: ${type}, Wert: ${pointsToSend}`);
    
    // Sende den Zahlenwert und den Typ an den Server
    // Wir verwenden einen neuen Variablennamen ('pointsToSend'), um Scope-Probleme auszuschließen
    socket.emit('scorePlayer', { points: pointsToSend, type: type });

    // Buzzer für die nächste Frage freigeben
    document.getElementById('nextQuestionButton').disabled = false;
}

        // === QUIZ MANAGEMENT FUNKTIONEN ===

        async function uploadQuiz() {
            const fileInput = document.getElementById('quizFileInput');
            const statusEl = document.getElementById('upload-status');
            
            if (!fileInput.files.length) {
                statusEl.textContent = 'Bitte eine JSON-Datei auswählen.';
                return;
            }

            const file = fileInput.files[0];
            const formData = new FormData();
            formData.append('quizFile', file); 
            
            statusEl.textContent = 'Lade hoch...';

            try {
                const response = await fetch('/api/quiz/upload', {
                    method: 'POST',
                    headers: { 
                        'Authorization': `Bearer ${token}` 
                    },
                    body: formData
                });

                const data = await response.json();
                
                if (response.ok) {
                    statusEl.textContent = `✅ ${data.message}`;
                    loadQuizzes(); 
                } else {
                    statusEl.textContent = `❌ Fehler: ${data.message}`;
                }
            } catch (error) {
                console.error('Upload Error:', error);
                statusEl.textContent = 'Verbindungsfehler oder Datei ungültig.';
            }
        }
        
        async function loadQuizzes() {
            const selectEl = document.getElementById('quizSelect');
            const statusEl = document.getElementById('upload-status');
            
            selectEl.innerHTML = '<option value="">-- Wähle ein Quiz --</option>'; 
            document.getElementById('startButton').disabled = true;

            if (!token) {
                statusEl.textContent = 'Fehler: Nicht eingeloggt.';
                return;
            }

            try {
                const response = await fetch('/api/quiz/list', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const quizzes = await response.json();
                
                if (response.ok) {
                    quizzes.forEach(quiz => {
                        const option = document.createElement('option');
                        option.value = quiz._id;
                        option.textContent = `${quiz.title} (${new Date(quiz.createdAt).toLocaleDateString()})`;
                        selectEl.appendChild(option);
                    });
                    if (quizzes.length > 0) {
                         document.getElementById('startButton').disabled = false;
                    }
                } else {
                    statusEl.textContent = `❌ Fehler beim Laden: ${quizzes.message}`;
                }
            } catch (error) {
                console.error('Ladefehler Quiz:', error);
                statusEl.textContent = 'Verbindungsfehler beim Abrufen der Quiz-Liste.';
            }
        }

        async function startQuiz() {
            const quizId = document.getElementById('quizSelect').value;
            
            if (!quizId) return;

            try {
                const response = await fetch(`/api/quiz/${quizId}`, {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const quiz = await response.json();

                if (response.ok) {
                    currentQuiz = quiz;
                    currentQuestionIndex = 0;
                    
                    document.getElementById('quiz-selection-area').style.display = 'none';
                    document.getElementById('question-area').style.display = 'grid';

                    displayQuestion(currentQuestionIndex);
                    resetBuzzer();

                } else {
                    alert(`Fehler beim Laden des Quiz: ${quiz.message}`);
                }
            } catch (error) {
                console.error('Quiz Start Fehler:', error);
            }
        }


        function displayQuestion(index) {
            if (!currentQuiz || index >= currentQuiz.questions.length) {
                document.getElementById('question-display').textContent = 'QUIZ ENDE!';
                document.getElementById('answer-display').textContent = 'Bitte Spiel beenden.';
                document.getElementById('nextQuestionButton').disabled = true;
                // Optional: socket.emit('endGame'); 
                return;
            }
            
            const question = currentQuiz.questions[index];
            const total = currentQuiz.questions.length;

            document.getElementById('current-question-index').textContent = `${index + 1} von ${total} (Punkte: ${question.points || 1})`;
            document.getElementById('question-display').textContent = question.text;
            document.getElementById('answer-display').textContent = 'Antwort: [Klicken Sie auf "Antwort anzeigen"]';

            document.getElementById('showAnswerButton').style.display = 'inline-block';
            document.getElementById('nextQuestionButton').disabled = true;

            // NEU: Sendet die aktuelle Fragennummer an alle Clients
            if (socket) {
                socket.emit('questionUpdate', { 
                    current: index + 1, 
                    total: total 
                });
            }
        }

        function showAnswer() {
            if (!currentQuiz) return;
            const question = currentQuiz.questions[currentQuestionIndex];
            
            document.getElementById('answer-display').textContent = `Antwort: ${question.answer}`;
            document.getElementById('showAnswerButton').style.display = 'none';
            document.getElementById('nextQuestionButton').disabled = false;
        }

        function nextQuestion() {
            currentQuestionIndex++;
            displayQuestion(currentQuestionIndex);
            resetBuzzer(); 
        }

        // === LOGIN & SOCKET FUNKTIONEN ===
        
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

                if (response.ok && data.isHost) {
                    token = data.token;
                    localStorage.setItem('token', token); // Speichern unter dem konsistenten Namen 'token'
                    document.getElementById('welcome-host').textContent = `Willkommen, Host ${username}!`;
                    
                    // Formulare ausblenden (hier, nach erfolgreichem Login)
                    document.getElementById('login-form').style.display = 'none';
                    document.getElementById('host-area').style.display = 'grid';
                    
                    connectSocket();
                    loadQuizzes(); // Lade Quizzes direkt nach dem Login
                } else if (response.ok && !data.isHost) {
                    statusEl.textContent = 'Fehler: Du hast keine Host-Rechte.';
                } else {
                    statusEl.textContent = `Fehler: ${data.message}`;
                }
            } catch (error) {
                statusEl.textContent = 'Verbindungsfehler zum Server.';
            }
        }

        function startTimer(duration, username) {
    // Setze die globale Variable und zeige die Elemente an
    timerSeconds = duration;
    document.getElementById('host-timer-display').style.display = 'block';
    ent.getElementById('timer-player-info').textContent = `${username} muss nun antworten...`;

    // Timer-Anzeige initialisieren
    document.getElementById('timer-countdown').textContent = `${timerSeconds}s`;

    if (timerInterval) {
        clearInterval(timerInterval);
    }

    timerInterval = setInterval(() => {
        timerSeconds--;
        document.getElementById('timer-countdown').textContent = `${timerSeconds}s`;

        if (timerSeconds <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            // Zeige dem Host an, dass der Timer abgelaufen ist
            document.getElementById('timer-countdown').textContent = 'Zeit abgelaufen!';

            // OPTIONAL: Hier könnte ein Event an den Server gesendet werden,
            // um z.B. dem Spieler eine falsche Antwort zu geben, wenn nötig.
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    document.getElementById('host-timer-display').style.display = 'none';
    document.getElementById('timer-countdown').textContent = '';
    document.getElementById('timer-player-info').textContent = '';
}

function connectSocket() {
    if (!token) return;
    
    // 🔑 KORREKTUR: Token muss im 'auth'-Objekt gesendet werden
    socket = io({ 
        auth: { 
            token: token 
        } 
    }); 
    
    // Fügen Sie zur Sicherheit diese Debug-Listener hinzu, 
    // um die Verbindung zu bestätigen oder Fehler zu sehen:
    socket.on('connect', () => {
        console.log("✅ Socket.IO verbunden! Host-Dashboard sollte nun funktionieren.");
    });
    
    socket.on('connect_error', (err) => {
        console.error(`❌ Kritischer Verbindungsfehler: ${err.message}`);
    });

// NEUER LISTENER: Empfängt den Skip-Wunsch vom Server
socket.on('playerSkipRequest', (data) => { 
    if (!data || !data.username) {
        console.error("Ungültige Skip-Anfragedaten erhalten.", data);
        return;
    }
    
    // Speichere den Spieler und den Zeitpunkt.
    playerSkipRequests[data.username] = data.time || new Date().toLocaleTimeString('de-DE'); 
    
    // Aktualisiere die Anzeige
    renderSkipRequests();
});
            
            // Listener für Buzzer-Ereignisse
            socket.on('buzzed', (data) => {
                document.getElementById('buzzer-status').textContent = `🚨 GEBUZZERT: ${data.username}`;
                document.getElementById('buzzer-winner').textContent = data.username;
                document.getElementById('buzz-details').textContent = `${data.username} hat um ${new Date(data.time).toLocaleTimeString()} gebuzzert.`;
                document.getElementById('answer-controls').style.display = 'block';
                playSound('buzz');
            });

            socket.on('newAnswer', (data) => {
    // Speichere die neue Antwort (überschreibt die alte für diesen Spieler)
    latestPlayerAnswers[data.username] = {
        answer: data.answer,
        time: new Date().toISOString() // Speichere den Zeitpunkt
    };
    
    // Rendere die aktualisierte Liste der letzten Antworten
    renderLatestAnswers();
    });

    socket.on('resetQuestion', () => {
                document.getElementById('buzzer-status').textContent = 'Buzzer ist frei.';
                document.getElementById('buzz-details').textContent = 'Warte auf den ersten Buzzer...';
                document.getElementById('answer-controls').style.display = 'none';
                document.getElementById('answers-list').innerHTML = '';
            });

            // NEU: Listener für Live-Tipp-Updates
socket.on('typingUpdate', (data) => {
    const container = document.getElementById('live-typing-updates');
    // Eindeutige ID für den Paragraphen jedes Spielers
    const elementId = `typing-${data.username}`;
    let playerP = document.getElementById(elementId);
    

    // Wenn der Spieler das Feld leert, entferne seine Zeile
    if (data.text.trim() === '' && playerP) {
        playerP.remove();
        return;
    }

// NEU: Timer-Start-Signal vom Server empfangen
    socket.on('timerStarted', (data) => {
        startTimer(data.duration, data.username);
        // Stoppe den Timer, wenn die Antwort ausgewertet wird
        stopTimerOnAnswerDecision(); 
    });

// Listener für das Zurücksetzen der Frage anpassen
socket.on('resetQuestion', () => {
    document.getElementById('buzzer-status').textContent = 'Buzzer ist frei.';
    document.getElementById('buzz-details').textContent = 'Warte auf den ersten Buzzer...';
    document.getElementById('answer-controls').style.display = 'none';
    document.getElementById('answers-list').innerHTML = ''; 
    latestPlayerAnswers = {}; 
    
    // NEU: Skip-Anfragen beim Zurücksetzen der Frage leeren
    playerSkipRequests = {}; 
    renderSkipRequests(); 
});

    // Wenn Text vorhanden ist:
    if (data.text.trim() !== '') {
        // Wenn für diesen Spieler noch keine Zeile existiert, erstelle sie
        if (!playerP) {
            playerP = document.createElement('p');
            playerP.id = elementId;
            playerP.style.margin = '2px 0';
            container.appendChild(playerP);
        }
        // Aktualisiere den Text in der Zeile des Spielers
        playerP.textContent = `${data.username}: ${data.text}`;
    }
});
            // Listener für Punktestand
            socket.on('initialScores', (scores) => { updateScoreboard(scores); });
            socket.on('currentScoreUpdate', (scores) => { updateScoreboard(scores); });
            socket.on('gameEnded', () => { updateScoreboard({}); });
        }

    function playSound(file) {
    const audio = new Audio(`/assets/${file}.mp3`); // Pfad anpassen!
    audio.play().catch(e => console.log("Audio konnte nicht abgespielt werden:", e));
    }

    function stopTimerOnAnswerDecision() {
    // Dies sollte aufgerufen werden, wenn der Host 'Richtig', 'Falsch' oder 'Weiter' klickt.
    // Finde die bestehende Funktion, die nach der Buzzer-Auswertung aufräumt.
    // Im Standard-Code ist das meistens `resetBuzzerState`.

    // FÜGE den stopTimer() AUFRUF IN DIE Funktion `resetBuzzerState` ein!
}



        // === SESSION WIEDERHERSTELLEN BEIM LADEN ===
        if (token) {
            // 1. Formular ausblenden
            document.getElementById('login-form').style.display = 'none';
            
            // 2. Host-Bereich einblenden
            document.getElementById('host-area').style.display = 'grid';
            
            // 3. Verbindung herstellen
            connectSocket();
            loadQuizzes(); // Lade Quizzes direkt nach dem Wiederherstellen
        }

        function endGame() {
    const statusEl = document.getElementById('game-status');
    
    if (confirm("Sind Sie sicher, dass Sie das aktuelle Spiel beenden und die Statistiken speichern möchten? Aktuelle Punkte werden in die ewige Bestenliste übernommen.")) {
        
        // 1. Event zum Speichern an den Server senden
        if (socket && socket.connected) {
            socket.emit('endGame');
            statusEl.textContent = "Speichervorgang eingeleitet...";
        } else {
            statusEl.textContent = "Fehler: Socket-Verbindung ist nicht aktiv.";
            return;
        }

        // 2. Host-UI nach dem Speichern zurücksetzen (visuelles Feedback)
        document.getElementById('buzzer-status').style.display = 'none';
        
        // Da 'answer-controls' nur innerhalb von 'buzzer-status' oder
        // im 'buzzed'-Listener eingeblendet wird, stellen wir sicher,
        // dass der Host nicht in einem gelockten Zustand bleibt.
        const answerControls = document.getElementById('answer-controls');
        if (answerControls) {
             answerControls.style.display = 'none';
        }
        document.getElementById('answers-list').innerHTML = ''; // Antworten leeren
    }
}    