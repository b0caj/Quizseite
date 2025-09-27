
        const token = localStorage.getItem('token') || localStorage.getItem('hostToken');
        const statusEl = document.getElementById('status');
        const tableBody = document.getElementById('leaderboard').querySelector('tbody');

        if (!token) {
            statusEl.textContent = 'Fehler: Nicht eingeloggt. Bitte zuerst einloggen.';
        } else {
            fetchStats(token);
        }

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
                
                renderStats(stats);

            } catch (error) {
                console.error(error);
                statusEl.textContent = 'Fehler beim Laden der Statistiken.';
            }
        }

        function goBack() {
        // Navigiert zur vorherigen Seite in der Browser-Historie.
        // Das ist entweder die Host-Seite oder die Spieler-Seite.
        window.history.back();
        }
        function renderStats(stats) {
    tableBody.innerHTML = ''; // Vorherige Einträge löschen
    
    stats.forEach((player, index) => {
        // NEU: Berechnung der Erfolgsquote
        const totalAnswers = (player.totalCorrectAnswers || 0) + (player.totalWrongAnswers || 0);
        let successRate = 'N/A';
        
        if (totalAnswers > 0) {
            // Berechnung: (Richtige / Gesamt) * 100, gerundet auf 1 Dezimalstelle
            successRate = ((player.totalCorrectAnswers / totalAnswers) * 100).toFixed(1) + '%';
        }
        // ENDE NEU

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
    
    if (stats.length === 0) {
         statusEl.textContent = 'Noch keine Statistiken vorhanden.';
    }
}
    