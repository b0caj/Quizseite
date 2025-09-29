
// === GLOBALE VARIABLEN ===
let token = localStorage.getItem('token');
let socket;
let firstBuzzerId = null;
let currentQuiz = null;
let currentQuestionIndex = 0;
let countdownInterval = null;
const TIMER_DURATION = 10; // 10 Sekunden

// === ALLGEMEINE FUNKTIONEN ===

function logout() {
    localStorage.removeItem('token');
    if (socket) {
        socket.disconnect();
    }
    window.location.href = '/login.html';
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

function resetBuzzer() {
    if (socket) {
        socket.emit('resetBuzzer');
    }
    stopBuzzerTimer();
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
            sendQuestionProgress();

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
    sendQuestionProgress();
    if (socket && socket.connected) {
        // Sendet das Event an den Server, der dann alle Clients informiert
        socket.emit('nextQuestion');
    }
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

function connectSocket() {
    if (!token) return;

    socket = io({ query: { token: token } });

    socket.on('playerListUpdate', (players) => {
        const select = document.getElementById('adj-player-select');
        select.innerHTML = '<option value="" disabled selected>Wähle einen Spieler</option>'; // Zurücksetzen

        players.forEach(player => {
            const option = document.createElement('option');
            option.value = player.username; // Wir senden den Benutzernamen
            option.textContent = player.username;
            select.appendChild(option);
        });
    });

    // Listener für Buzzer-Ereignisse
    socket.on('buzzed', (data) => {
        document.getElementById('buzzer-status').textContent = `🚨 GEBUZZERT: ${data.username}`;
        document.getElementById('buzzer-winner').textContent = data.username;
        document.getElementById('buzz-details').textContent = `${data.username} hat um ${new Date(data.time).toLocaleTimeString()} gebuzzert.`;
        document.getElementById('answer-controls').style.display = 'block';
        playSound('buzz');
        startBuzzerTimer();
    });

    socket.on('resetQuestion', () => {
        document.getElementById('buzzer-status').textContent = 'Buzzer ist frei.';
        document.getElementById('buzz-details').textContent = 'Warte auf den ersten Buzzer...';
        document.getElementById('answer-controls').style.display = 'none';
        stopBuzzerTimer();
        //document.getElementById('answers-list').innerHTML = '';
    });

    socket.on('currentScoreUpdate', (scores) => {
        updateScoreboard(scores); // <-- DIESE ZUSAMMENFÜHRUNG FEHLT IM HOST-JS
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

    socket.on('skipCountUpdate', (data) => {
        const skipCountEl = document.getElementById('skip-count');

        // Setze den Text auf die empfangene Anzahl
        skipCountEl.textContent = data.count;

        // Optional: Visualisierung anpassen, z.B. hervorheben, wenn > 0
        if (data.count > 0) {
            document.getElementById('skip-display').classList.add('active-glow');
        } else {
            document.getElementById('skip-display').classList.remove('active-glow');
        }

        console.log(`📣 Host: ${data.count} Skip-Anfragen.`);
    });

    socket.on('newAnswer', (data) => {
        // Finde das Element, in dem du die neueste Antwort anzeigen möchtest.
        // Ich gehe davon aus, dass du ein neues Element dafür erstellen musst, z.B. <p id="latest-answer-display"></p>

        // Da du eine Liste hast ('answers-list'), löschen wir den Inhalt 
        // und fügen nur die neue Antwort als *einziges* Element hinzu.
        const answersList = document.getElementById('answers-list');
        answersList.innerHTML = ''; // Vorherige Antworten entfernen

        const li = document.createElement('li');
        li.textContent = `[${data.username}]: ${data.answer}`;
        answersList.appendChild(li);

        // Optional: Füge eine visuelle Markierung hinzu (z.B. einen blinkenden Rahmen).
        console.log(`[HOST] Letzte Antwort: ${data.username}: ${data.answer}`);
    });
}
function playSound(file) {
    const audio = new Audio(`/assets/${file}.mp3`); // Pfad anpassen!
    audio.play().catch(e => console.log("Audio konnte nicht abgespielt werden:", e));
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

// NEUE FUNKTION: Sendet den aktuellen Fragenfortschritt an alle Spieler
function sendQuestionProgress() {
    // Annahme: 'currentQuiz' und 'currentQuestionIndex' sind globale Variablen in host.js
    if (socket && socket.connected && currentQuiz) {
        // Senden Sie den Fortschritt. Wir addieren +1 zu 'currentQuestionIndex', 
        // da Indizes bei 0 beginnen, die Anzeige für den User aber bei 1.
        socket.emit('questionProgressUpdate', {
            currentQuestion: currentQuestionIndex + 1,
            totalQuestions: currentQuiz.fragen.length
        });
        console.log(`Fragenfortschritt an Spieler gesendet: Frage ${currentQuestionIndex + 1} von ${currentQuiz.fragen.length}`);
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
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
    const timerContainer = document.getElementById('buzzer-timer-container');
    const timerDisplay = document.getElementById('buzzer-timer');

    if (timerContainer) {
        timerContainer.style.display = 'none';
    }
    if (timerDisplay) {
        timerDisplay.textContent = TIMER_DURATION; // Zurücksetzen auf Startwert
        timerDisplay.classList.remove('timer-flash');
    }
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

// NEUE FUNKTION: Sendet den aktuellen Fragenfortschritt an alle Spieler
function sendQuestionProgress() {
    // Stellen Sie sicher, dass currentQuiz geladen ist und der Socket verbunden ist
    if (socket && socket.connected && currentQuiz && currentQuiz.questions) {
        // currentQuestionIndex beginnt bei 0, die Anzeige beim User soll bei 1 beginnen.
        socket.emit('questionProgressUpdate', {
            currentQuestion: currentQuestionIndex + 1,
            totalQuestions: currentQuiz.questions.length
        });
        console.log(`[HOST] Fragenfortschritt gesendet: Frage ${currentQuestionIndex + 1} von ${currentQuiz.questions.length}`);
    }
}
