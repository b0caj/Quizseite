// stats.js

// NEU: Globale Variable, um die abgerufenen Statistiken zu speichern
let currentStats = [];
// NEU: Standard-Sortierparameter
let currentSortKey = 'totalPoints'; // Standardmäßig nach Punkten sortieren
let currentSortDirection = 'desc'; // Standardmäßig absteigend (descending)

const token = localStorage.getItem('token') || localStorage.getItem('hostToken');
const statusEl = document.getElementById('status');
const leaderboardTable = document.getElementById('leaderboard'); // NEU: Referenz zur gesamten Tabelle
const tableBody = leaderboardTable.querySelector('tbody'); // Bleibt gleich

if (!token) {
    statusEl.textContent = 'Fehler: Nicht eingeloggt. Bitte zuerst einloggen.';
} else {
    fetchStats(token);
}

// NEU: Event-Listener für die Sortierung hinzufügen, nachdem die Seite geladen ist
document.addEventListener('DOMContentLoaded', () => {
    // Die Spaltenüberschriften abrufen
    const headers = leaderboardTable.querySelectorAll('th');
    headers.forEach(header => {
        // Sicherstellen, dass die Spalte sortierbar ist (durch Datenattribut)
        const sortKey = header.getAttribute('data-sort-key');
        if (sortKey) {
            header.classList.add('sortable'); // Optional: Klasse für visuellen Hinweis
            header.addEventListener('click', () => {
                handleSort(sortKey, header);
            });
        }
    });
});

async function fetchStats(authToken) {
    try {
        const response = await fetch('/api/stats/top-players', {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${authToken}` 
            }
        });

        if (response.status === 401) {
            statusEl.textContent = 'Sitzung abgelaufen. Bitte neu einloggen.';
            return;
        }

        const stats = await response.json();
        statusEl.textContent = ''; // Statusmeldung leeren
        
        // NEU: Speichern der abgerufenen Statistiken
        currentStats = stats; 
        
        // Initiales Rendern basierend auf der Standard-Sortierung
        sortAndRenderStats(); 

    } catch (error) {
        console.error(error);
        statusEl.textContent = 'Fehler beim Laden der Statistiken.';
    }
}

function goBack() {
    window.history.back();
}

// NEU: Funktion, die die Sortierung durchführt und dann rendert
function sortAndRenderStats() {
    
    // Sortierlogik
    currentStats.sort((a, b) => {
        const aValue = a[currentSortKey] || 0; // Standardwert 0 für Zahlen
        const bValue = b[currentSortKey] || 0;

        // Spezialfall: Erfolgsquote muss berechnet werden, da sie nicht direkt im Player-Objekt ist
        if (currentSortKey === 'successRate') {
            const aTotal = (a.totalCorrectAnswers || 0) + (a.totalWrongAnswers || 0);
            const bTotal = (b.totalCorrectAnswers || 0) + (b.totalWrongAnswers || 0);
            const aRate = aTotal > 0 ? a.totalCorrectAnswers / aTotal : 0;
            const bRate = bTotal > 0 ? b.totalCorrectAnswers / bTotal : 0;
            
            if (currentSortDirection === 'asc') {
                return aRate - bRate;
            } else {
                return bRate - aRate;
            }
        }
        
        // Standardsortierung (für Zahlen)
        let comparison = 0;
        if (aValue < bValue) {
            comparison = -1;
        } else if (aValue > bValue) {
            comparison = 1;
        }

        // Bei gleichem Wert nach Punkten (oder einem anderen sekundären Key) sortieren
        if (comparison === 0 && currentSortKey !== 'totalPoints') {
             comparison = b.totalPoints - a.totalPoints; // Sekundäre Sortierung nach Punkten (absteigend)
        }
        
        // Richtung anwenden
        return currentSortDirection === 'asc' ? comparison : comparison * -1;
    });

    renderStats(currentStats);
    
    // NEU: Sortier-Indikator setzen
    updateSortIndicators();
}

// NEU: Funktion, die den Klick auf eine Spaltenüberschrift verarbeitet
function handleSort(sortKey, headerElement) {
    if (currentSortKey === sortKey) {
        // Bei erneutem Klick die Sortierrichtung umschalten
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        // Bei Klick auf eine neue Spalte, diese als neuen Key setzen und auf 'desc' zurücksetzen
        currentSortKey = sortKey;
        currentSortDirection = 'desc';
    }
    
    sortAndRenderStats(); // Sortieren und neu rendern
}

// NEU: Setzt die visuellen Indikatoren (Pfeile) für die Sortierung
function updateSortIndicators() {
    const headers = leaderboardTable.querySelectorAll('th');
    headers.forEach(header => {
        header.classList.remove('sorted-asc', 'sorted-desc');
        if (header.getAttribute('data-sort-key') === currentSortKey) {
            header.classList.add(`sorted-${currentSortDirection}`);
        }
    });
}


function renderStats(stats) {
    tableBody.innerHTML = ''; // Vorherige Einträge löschen
    
    stats.forEach((player, index) => {
        // Berechnung der Erfolgsquote bleibt gleich
        const totalAnswers = (player.totalCorrectAnswers || 0) + (player.totalWrongAnswers || 0);
        let successRate = 'N/A';
        
        if (totalAnswers > 0) {
            successRate = ((player.totalCorrectAnswers / totalAnswers) * 100).toFixed(1) + '%';
        }

        const row = tableBody.insertRow();
        row.innerHTML = `
            <td class="rank">${index + 1}</td>
            <td>${player.username}</td>
            <td>${player.totalPoints}</td>
            <td>${player.totalFirstBuzzes}</td>
            <td>${player.totalCorrectAnswers || 0}</td>
            <td>${player.totalWrongAnswers || 0}</td>
            <td>${successRate}</td>
            <td>${player.totalGamesPlayed}</td>
        `;
    });
    
    // Die Rangspalte basiert nun auf der *aktuellen* Sortierung und wird bei jedem Rendern korrekt angezeigt.
    
    if (stats.length === 0) {
         statusEl.textContent = 'Noch keine Statistiken vorhanden.';
    }
}