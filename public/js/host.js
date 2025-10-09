let token = localStorage.getItem('token');
let socket;
let firstBuzzerId = null;
let currentQuiz = null;
let currentQuestionIndex = 0;
let countdownInterval = null;
const TIMER_DURATION = 10; // 10 Sekunden
let gameMode = 'BUZZER';
let activeWbmAnswers = [];
let wbmHostCountdownInterval = null;
let wbmAnswersData = []; // Speichert die vollständigen Antworten und den Offenlegungsstatus

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

function resetBuzzer() {
    if (socket) {
        socket.emit('resetBuzzer');
    }
    stopBuzzerTimer();
}
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

    console.log(`[HOST-Frontend] Sende Typ: ${type}, Wert: ${pointsToSend}`);

    // Wir verwenden einen neuen Variablennamen ('pointsToSend'), um Scope-Probleme auszuschließen
    socket.emit('scorePlayer', { points: pointsToSend, type: type });

    // Buzzer für die nächste Frage freigeben
    document.getElementById('nextQuestionButton').disabled = false;
}

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

async function loadQuizzes(forWbm = false) {
    const selectEl = document.getElementById('quizSelect');
    const wbmSelectEl = document.getElementById('wbmAnswerSelect');
    const statusEl = document.getElementById('upload-status');
    const wbmStatusEl = document.getElementById('wbm-set-status');

    selectEl.innerHTML = '<option value="">-- Wähle ein Quiz --</option>';
    if (wbmSelectEl) wbmSelectEl.innerHTML = '<option value="">-- Wähle Antworten-Set --</option>';
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
                const quizId = quiz._id;
                const title = quiz.title;
                const date = new Date(quiz.createdAt).toLocaleDateString();

                // 1. Befüllen des normalen Quiz-Dropdowns
                const option = document.createElement('option');
                option.value = quizId;
                option.textContent = `${title} (${date})`;
                selectEl.appendChild(option);

                // 2. Befüllen des WBM-Dropdowns 
                // Prüft, ob wbmAnswers existiert UND mindestens ein Element enthält
                if (quiz.wbmAnswers && Array.isArray(quiz.wbmAnswers) && quiz.wbmAnswers.length > 0) {
                    const wbmOption = document.createElement('option');
                    wbmOption.value = quizId;
                    // Zeigt die Anzahl der Antworten an
                    wbmOption.textContent = `Set: ${title} (${quiz.wbmAnswers.length} Antworten)`;
                    wbmSelectEl.appendChild(wbmOption);

                    // DIAGNOSE: Logge jeden erfolgreichen Eintrag
                    console.log(`[WBM Set gefunden] Quiz-ID: ${quizId}, Titel: ${title}, Antworten: ${quiz.wbmAnswers.length}`);
                } else {
                    // DIAGNOSE: Logge, warum ein Quiz NICHT aufgenommen wurde
                    console.log(`[WBM Set ignoriert] Quiz: ${title}. Antworten fehlen oder sind leer: ${quiz.wbmAnswers ? quiz.wbmAnswers.length : 'null'}`);
                }
            });

            if (quizzes.length > 0) {
                document.getElementById('startButton').disabled = false;
            }
            if (forWbm) {
                wbmStatusEl.textContent = 'Antworten-Sets geladen. (Prüfe Konsole für Details)';
            }

        } else {
            statusEl.textContent = `❌ Fehler beim Laden: ${quizzes.message}`;
        }
    } catch (error) {
        console.error('Verbindungsfehler oder JSON-Parse-Fehler beim Laden:', error);
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

    // Listener, um die UI nach Bestätigung durch den Server zu aktualisieren
    if (socket) {
        socket.on('gameModeSet', (mode) => {
            gameMode = mode;
            const classicControls = document.getElementById('classicControlsArea');
            const wbmControls = document.getElementById('wbmControlsArea');
            const modeStatus = document.getElementById('mode-status');

            if (mode === 'BIETEN_MEHR') {
                if (classicControls) classicControls.style.display = 'none';
                if (wbmControls) wbmControls.style.display = 'block';
                if (modeStatus) modeStatus.textContent = 'Aktueller Modus: Wer bietet mehr';
                console.log(`[HOST] UI auf Modus ${mode} umgeschaltet.`);
            } else {
                if (classicControls) classicControls.style.display = 'block';
                if (wbmControls) wbmControls.style.display = 'none';
                if (modeStatus) modeStatus.textContent = 'Aktueller Modus: Klassisches Buzzer-Quiz';
                console.log(`[HOST] UI auf Modus ${mode} umgeschaltet.`);
            }
        });
    }

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

    // host.js: KORRIGIERTE VERSION DES LISTENERS
    socket.on('wbmAnswersLoaded', (data) => {
        console.log('WBM-Antworten vom Server empfangen.');

        // 🔑 KORREKTUR: Das empfangene Objekt in 'data' umbenennen 
        // und das Array unter dem Schlüssel 'answers' extrahieren.
        const answersArray = data.answers;

        // Sicherheitsprüfung hinzufügen: Ist es wirklich ein Array?
        if (!Array.isArray(answersArray)) {
            console.error("Fehler: Erwartetes Array 'answers' fehlt im empfangenen Datenobjekt.");
            return;
        }

        // Die Daten lokal speichern und für das Rendering vorbereiten
        wbmAnswersData = answersArray.map((answer, index) => ({
            answer: answer,
            revealed: false,
            index: index
        }));

        // Die Anzeige im Host-Dashboard aktualisieren
        renderWbmAnswers();
    });


    socket.on('wbmAnswerRevealed', ({ answer, index, allRevealed }) => {
        // 1. Lokalen Zustand aktualisieren
        const dataIndex = wbmAnswersData.findIndex(d => d.index === index);
        if (dataIndex !== -1) {
            wbmAnswersData[dataIndex].revealed = true;
        }

        // 2. UI-Element direkt aktualisieren
        const answerDiv = document.getElementById(`wbm-answer-${index}`);
        if (answerDiv) {
            // Ersetzen Sie den Inhalt, um die Antwort und den 'Aufgedeckt'-Button anzuzeigen
            answerDiv.innerHTML = `
            <div class="answer-info"><span class="revealed-answer">${answer}</span></div>
            <div class="answer-action"><button class="button success small-button" disabled>Aufgedeckt</button></div>
        `;
        }

        // Statusmeldung für den Host
        document.getElementById('wbm-answer-status').textContent = `Antwort #${index + 1} (${answer}) aufgedeckt!`;

        if (allRevealed) {
            document.getElementById('wbm-answer-status').textContent = 'Alle WBM Antworten wurden aufgedeckt!';
        }
    });

    socket.on('newHighBid', (data) => {
        const infoEl = document.getElementById('wbm-current-bid-info');
        const bidsTbody = document.getElementById('wbm-bids-tbody');

        // Host-Status aktualisieren
        infoEl.innerHTML = `**Höchstes Gebot:** <span class="neon-text-highlight">${data.bid}</span> von **${data.bidder}**`;


        // WICHTIG: Wir benötigen das `data.allBids` Objekt vom Server (siehe unten)
        updateWbmBidTable(data.allBids);

        console.log(`[HOST] Neues Höchstgebot: ${data.bidder} mit ${data.bid}.`);
    });

    // NEU: Listener für den Zuschlag (nach stopBiddingPhase)
    socket.on('biddingPhaseConcluded', (data) => {
        const infoEl = document.getElementById('wbm-current-bid-info');
        const scoringArea = document.getElementById('wbmScoringArea');
        const biddingTableWrapper = document.getElementById('wbmControlsArea').querySelector('.styled-table-wrapper');

        if (data.finalBidder) {
            infoEl.innerHTML = `**ZUSCHLAG ERTEILT!** Spieler **${data.finalBidder}** muss ${data.finalBid} Antworten nennen.`;

            if (scoringArea && biddingTableWrapper) {
                // Bidding Tabelle ausblenden
                biddingTableWrapper.style.display = 'none';

                // Scoring Area anzeigen und Daten setzen
                document.getElementById('wbm-winner-display').textContent = data.finalBidder;
                document.getElementById('wbm-bid-display').textContent = data.finalBid;
                // Voreinstellung: Anzahl der korrekten Antworten auf das Gebot setzen
                document.getElementById('wbmCorrectAnswers').value = data.finalBid;
                scoringArea.style.display = 'block';
                // NEU: Anzeige der richtigen WBM-Antworten
                const answersHtml = activeWbmAnswers.map(ans => `<span class="wbm-answer-tag">${ans}</span>`).join('');
                const answersDisplay = document.createElement('div');
                answersDisplay.id = 'wbm-correct-answers-list';
                answersDisplay.className = 'wbm-answers-list';
                answersDisplay.innerHTML = '<h4>KORREKTE ANTWORTEN:</h4>' + answersHtml;
            }

        } else {
            // Fall: Kein Gebot abgegeben
            infoEl.textContent = 'Biet-Phase beendet. Kein Gebot abgegeben.';
        }

        console.log(`[HOST] Biet-Phase abgeschlossen. Zuschlag an ${data.finalBidder || 'niemand'}.`);
    });

    socket.on('wbmRoundConcluded', () => {
        // UI zurücksetzen
        const scoringArea = document.getElementById('wbmScoringArea');
        const biddingTableWrapper = document.getElementById('wbmControlsArea').querySelector('.styled-table-wrapper');

        if (scoringArea) scoringArea.style.display = 'none';

        document.getElementById('wbmCategory').disabled = false;

        if (biddingTableWrapper) biddingTableWrapper.style.display = 'block';

        document.getElementById('wbm-current-bid-info').textContent = 'Kein Gebot aktiv. Neue Runde starten.';
        document.getElementById('wbm-score-status').textContent = '';
        document.querySelector('button[onclick="submitWbmScore()"]').disabled = false; // Button entsperren

        console.log('[HOST] WBM Runde erfolgreich abgeschlossen. UI zurückgesetzt.');
    });

    socket.on('scoreUpdate', (scores) => {
        console.log('[HOST] Punkte-Update erhalten:', scores);
        updateScoreboard(scores);
    });

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
    });

    socket.on('currentScoreUpdate', (scores) => {
        updateScoreboard(scores); // <-- DIESE ZUSAMMENFÜHRUNG FEHLT IM HOST-JS
    });

    socket.on('typingUpdate', (data) => {
        const container = document.getElementById('live-typing-updates');
        const elementId = `typing-${data.username}`;
        let playerP = document.getElementById(elementId);

        if (data.text.trim() === '' && playerP) {
            playerP.remove();
            return;
        }

        if (data.text.trim() !== '') {
            if (!playerP) {
                playerP = document.createElement('p');
                playerP.id = elementId;
                playerP.style.margin = '2px 0';
                container.appendChild(playerP);
            }
            playerP.textContent = `${data.username}: ${data.text}`;
        }
    });

    socket.on('skipCountUpdate', (data) => {
        const skipCountEl = document.getElementById('skip-count');

        skipCountEl.textContent = data.count;

        if (data.count > 0) {
            document.getElementById('skip-display').classList.add('active-glow');
        } else {
            document.getElementById('skip-display').classList.remove('active-glow');
        }

        console.log(`📣 Host: ${data.count} Skip-Anfragen.`);
    });

    socket.on('newAnswer', (data) => {
        const answersList = document.getElementById('answers-list');
        answersList.innerHTML = ''; // Vorherige Antworten entfernen

        const li = document.createElement('li');
        li.textContent = `[${data.username}]: ${data.answer}`;
        answersList.appendChild(li);

        console.log(`[HOST] Letzte Antwort: ${data.username}: ${data.answer}`);
    });
}
function playSound(file) {
    const audio = new Audio(`/assets/${file}.mp3`); // Pfad anpassen!
    audio.play().catch(e => console.log("Audio konnte nicht abgespielt werden:", e));
}

if (token) {
    document.getElementById('login-form').style.display = 'none';

    document.getElementById('host-area').style.display = 'grid';

    connectSocket();
    loadQuizzes(); // Lade Quizzes direkt nach dem Wiederherstellen
}

function sendQuestionProgress() {
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

    if (timerContainer) {
        timerContainer.style.display = 'block';
    }

    countdownInterval = setInterval(() => {
        timeLeft -= 1;
        timerDisplay.textContent = timeLeft;
        timerDisplay.classList.remove('timer-flash'); // Entfernt den Flash für konstante Anzeige

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
        const answerControls = document.getElementById('answer-controls');
        if (answerControls) {
            answerControls.style.display = 'none';
        }
        document.getElementById('answers-list').innerHTML = ''; // Antworten leeren
    }
}

function sendQuestionProgress() {
    if (socket && socket.connected && currentQuiz && currentQuiz.questions) {
        // currentQuestionIndex beginnt bei 0, die Anzeige beim User soll bei 1 beginnen.
        socket.emit('questionProgressUpdate', {
            currentQuestion: currentQuestionIndex + 1,
            totalQuestions: currentQuiz.questions.length
        });
        console.log(`[HOST] Fragenfortschritt gesendet: Frage ${currentQuestionIndex + 1} von ${currentQuiz.questions.length}`);
    }
}

function setGameMode() {
    const selector = document.getElementById('gameModeSelector');
    if (socket && socket.connected && selector) {
        const newMode = selector.value;
        socket.emit('setGameMode', newMode);
        console.log(`[HOST] Anfrage zum Wechsel in Modus: ${newMode}`);
    } else {
        console.error("Socket nicht verbunden oder Selector nicht gefunden.");
    }
}

function startWbmRound() {
    const wbmSelectEl = document.getElementById('wbmAnswerSelect');
    const wbmCategorySelect = document.getElementById('wbm-category-select');
    const selectedQuizId = wbmSelectEl.value;
    const categoryText = wbmSelectEl.options[wbmSelectEl.selectedIndex].textContent;

    // Extrahieren des bereinigten Kategorienamens
    const cleanCategory = categoryText.replace(/Set: | \(\d+ Antworten\)/g, '').trim();

    const statusEl = document.getElementById('wbm-set-status');

    if (!selectedQuizId) {
        statusEl.textContent = '❌ Bitte wähle ein Antworten-Set aus.';
        return;
    }

    if (socket && socket.connected) {
        // 🔑 Sende NUR das korrekte Event an den Server
        socket.emit('startWbmRound', {
            quizId: selectedQuizId,
            category: cleanCategory // Die Kategorie ist optional, hilft aber bei der Spieler-Info
        });

        // Feedback geben
        document.getElementById('wbm-current-bid-info').textContent =
            `Runde gestartet: "${cleanCategory}". Warte auf Bietphase...`;
        console.log(`[HOST] WBM Runde mit ID ${selectedQuizId} gestartet. Warte auf Antworten vom Server...`);

        // Sperre das Dropdown, um zu verhindern, dass der Host es mitten in der Runde ändert
        wbmCategorySelect.disabled = true;

        // 🔥 Wichtig: Der Host muss nun auf 'wbmAnswersLoaded' vom Server warten.
    } else {
        console.error("Socket nicht verbunden.");
    }
}


async function fetchWbmAnswersAndStartRound(quizId, category) {
    const wbmStatusEl = document.getElementById('wbm-set-status');
    wbmStatusEl.textContent = 'Lade Antworten-Set...';
    try {

        const response = await fetch(`/api/quiz/${quizId}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const quizData = await response.json();

        if (response.ok && quizData.wbmAnswers) {
            activeWbmAnswers = quizData.wbmAnswers; // Setze die globalen Antworten
            wbmStatusEl.textContent = `Antworten-Set "${quizData.title}" geladen (${activeWbmAnswers.length} Antworten).`;

        } else {
            wbmStatusEl.textContent = `Fehler beim Laden der WBM-Antworten: ${quizData.message || 'Antworten nicht gefunden.'}`;
            document.getElementById('wbmCategory').disabled = false; // Wieder freigeben
        }
    } catch (error) {
        console.error('WBM Antworten Ladefehler:', error);
        wbmStatusEl.textContent = 'Verbindungsfehler beim Laden der WBM-Antworten.';
        document.getElementById('wbmCategory').disabled = false; // Wieder freigeben
    }
}

function stopBiddingPhase() {
    if (socket && socket.connected) {
        // Event an den Server senden
        socket.emit('stopBiddingPhase');
        console.log("[HOST] Biet-Phase beenden angefordert.");
    } else {
        console.error("Socket nicht verbunden.");
    }
}

function updateWbmBidTable(allBids) {
    const tableBody = document.getElementById('wbm-bids-tbody');
    if (!tableBody) return;

    tableBody.innerHTML = '';

    // Konvertiere das Gebots-Objekt in ein Array und sortiere absteigend nach Gebot
    const sortedBids = Object.values(allBids).sort((a, b) => b.bid - a.bid);

    sortedBids.forEach(bidData => {
        const row = tableBody.insertRow();

        // Hebe das höchste Gebot optisch hervor
        if (bidData.bid === sortedBids[0].bid) {
            row.classList.add('highlight-row');
        }

        row.innerHTML = `
            <td>${bidData.username}</td>
            <td class="neon-text-highlight">${bidData.bid}</td>
        `;
    });
}
// host.js: NEUE FUNKTION ZUM EINTRAGEN DER WBM-PUNKTE
function submitWbmScore() {
    const correctAnswers = parseInt(document.getElementById('wbmCorrectAnswers').value, 10);
    // Wir senden die aktuellen Punktregeln mit, damit der Server sie zur Berechnung verwenden kann
    const correctPoints = parseInt(document.getElementById('correctPoints').value, 10);
    const incorrectPoints = parseInt(document.getElementById('incorrectPoints').value, 10);

    const statusEl = document.getElementById('wbm-score-status');

    if (socket && socket.connected && !isNaN(correctAnswers) && !isNaN(correctPoints) && !isNaN(incorrectPoints)) {
        // Sende die Ergebnisse und die aktuellen Punktregeln an den Server
        socket.emit('submitWbmRoundScore', {
            correctAnswers: correctAnswers,
            correctPoints: correctPoints,
            incorrectPoints: incorrectPoints,
        });
        statusEl.textContent = "Punkte werden verarbeitet...";
        // Button sperren, um Doppelklick zu verhindern
        document.querySelector('button[onclick="submitWbmScore()"]').disabled = true;

    } else {
        statusEl.textContent = "Fehler: Ungültige Eingabe oder Socket nicht verbunden.";
    }
}
function startWbmHostCountdown(durationInSeconds) {
    let timer = durationInSeconds;
    const container = document.getElementById('wbm-host-timer-container');
    const display = document.getElementById('wbm-host-countdown-display');
    const statusEl = document.getElementById('wbm-host-timer-status');

    if (wbmHostCountdownInterval) clearInterval(wbmHostCountdownInterval);

    container.style.display = 'block';
    statusEl.textContent = 'Vorbereitungsphase aktiv.';
    container.classList.remove('timer-finished'); // Optional: CSS-Klasse für abgelaufene Zeit

    wbmHostCountdownInterval = setInterval(() => {
        let minutes = parseInt(timer / 60, 10);
        let seconds = parseInt(timer % 60, 10);

        minutes = minutes < 10 ? "0" + minutes : minutes;
        seconds = seconds < 10 ? "0" + seconds : seconds;

        display.textContent = minutes + ":" + seconds;

        if (--timer < 0) {
            clearInterval(wbmHostCountdownInterval);
            display.textContent = "00:00";
            statusEl.textContent = "Zeit abgelaufen! Bietphase beginnt...";
            container.classList.add('timer-finished');
            // Der Server sendet 'wbmRoundStarted' mit phase: 'BIDDING',
            // was dann den Container wieder ausblenden sollte, falls gewünscht.
        }
    }, 1000);
}
function revealWbmAnswer(answerIndex) {
    if (socket && socket.connected) {
        socket.emit('revealWbmAnswer', { answerIndex });
        document.getElementById('wbm-answer-status').textContent = `Sende Befehl zum Aufdecken von Antwort #${answerIndex + 1}...`;
    } else {
        document.getElementById('wbm-answer-status').textContent = 'Fehler: Socket nicht verbunden.';
    }
}

// Rendert die Antworten im Host-UI
function renderWbmAnswers() {
    const listEl = document.getElementById('wbm-answers-list');
    if (!listEl) return;

    listEl.innerHTML = '';

    if (wbmAnswersData.length === 0) {
        document.getElementById('wbm-answer-status').textContent = 'Keine WBM Antworten für diese Kategorie geladen.';
        return;
    }
    document.getElementById('wbm-answer-status').textContent = '';

    wbmAnswersData.forEach((data, index) => {
        const answerDiv = document.createElement('div');
        answerDiv.className = 'wbm-answer-item';

        let content = '';
        let buttonHtml = '';

        // 🔑 NEUE LOGIK: Zeige die Antwort IMMER dem Host an
        content = `<span class="host-answer-revealed">${data.answer}</span>`;

        if (data.revealed) {
            // Wenn die Antwort bereits für die Spieler aufgedeckt wurde, zeige den Status
            buttonHtml = `<button class="button success small-button" disabled>Aufgedeckt</button>`;
        } else {
            // Der Host muss weiterhin einen Button haben, um sie FÜR DIE SPIELER aufzudecken.
            // Der Text "Aufdecken" ändert sich, da die Antwort für den Host sichtbar ist.
            buttonHtml = `<button onclick="revealWbmAnswer(${data.index})" class="button action small-button glow">Für Spieler aufdecken</button>`;
        }

        answerDiv.innerHTML = `
        <div class="answer-info">Antwort #${index + 1}: ${content}</div>
        <div class="answer-action">${buttonHtml}</div>
    `;

        answerDiv.id = `wbm-answer-${data.index}`; // Wichtig für das spätere Update durch wbmAnswerRevealed
        listEl.appendChild(answerDiv);
    });
}

function startNewWbmRound() {
    if (!socket) {
        console.error('Socket-Verbindung nicht verfügbar.');
        return;
    }

    // Bestätigung vom Host einholen, da dies den Zustand löscht
    if (!confirm('Sind Sie sicher, dass Sie eine NEUE WBM-RUNDE starten möchten? Alle aktuellen Gebote und aufgedeckten Antworten werden gelöscht.')) {
        return;
    }

    // 1. Event an den Server senden
    socket.emit('startNewWbmRound');

    // 2. Host-UI zurücksetzen

    // a) Leere die Host-Daten der aufgedeckten Antworten
    wbmAnswersData = [];

    if (wbmHostCountdownInterval) {
        clearInterval(wbmHostCountdownInterval);
        wbmHostCountdownInterval = null; // Setzt die Variable zurück
    }

    const hostTimerDisplay = document.getElementById('wbm-host-countdown-display');
    if (hostTimerDisplay) {
        hostTimerDisplay.textContent = "00:00";
    }

    // b) Entferne die angezeigten Antworten aus dem Host-HTML
    const answersContainer = document.getElementById('wbm-answers-container');
    if (answersContainer) {
        answersContainer.innerHTML = '';
    }

    // c) Setze das Kategoriefeld/Dropdown zurück
    const wbmCategorySelect = document.getElementById('wbm-category-select');
    if (wbmCategorySelect) {
        wbmCategorySelect.value = ''; // Setzt den ausgewählten Wert zurück
        // 🔑 WICHTIG: Die Sperrung muss aufgehoben werden
        wbmCategorySelect.disabled = false; // <-- Diese Zeile macht das Dropdown wieder frei
    }

    // d) Setze den Zustand auf der UI zurück
    document.getElementById('wbm-answer-status').textContent = 'Bereit für neue Runde. Wählen Sie eine Kategorie.';
    document.getElementById('current-bidder-info').textContent = 'Kein Bieter aktiv.';

    console.log('Neue WBM-Runde vom Host gestartet.');
}