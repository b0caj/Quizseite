const jsonwebtoken = require('jsonwebtoken');

// Middleware-Funktion, die vor geschützten Routen ausgeführt wird
const protect = (req, res, next) => {
    // Der Token wird üblicherweise im 'Authorization'-Header gesendet
    let token;

    // 1. Prüfen, ob der Authorization-Header vorhanden und korrekt formatiert ist
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            // Token aus dem Header extrahieren (z.B. "Bearer TOKEN_STRING")
            token = req.headers.authorization.split(' ')[1];
            
            // 2. Token verifizieren
            const decoded = jsonwebtoken.verify(token, process.env.JWT_SECRET);

            // 3. Benutzerdaten an das Request-Objekt anhängen
            // Das ist entscheidend! Wir speichern die im JWT gespeicherte ID/Rolle für die Routen-Logik
            req.user = decoded; 
            
            // 4. Fortfahren mit der nächsten Middleware oder der eigentlichen Route
            next();

        } catch (error) {
            // Fehler bei ungültigem, abgelaufenem oder fehlerhaftem Token
            console.error('Token-Fehler:', error.message);
            return res.status(401).json({ message: 'Nicht autorisiert, Token fehlgeschlagen.' });
        }
    }

    // Wenn kein Token gesendet wurde
    if (!token) {
        return res.status(401).json({ message: 'Nicht autorisiert, kein Token.' });
    }
};

// Middleware für die Host-Rechteprüfung
const hostProtect = (req, res, next) => {
    // req.user wurde bereits durch die 'protect'-Middleware gesetzt
    if (req.user && req.user.isHost) {
        next(); // Benutzer ist Host, Zugriff gewährt
    } else {
        res.status(403).json({ message: 'Nicht autorisiert, Host-Rechte erforderlich.' });
    }
};

module.exports = { protect, hostProtect };