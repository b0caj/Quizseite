// routes/quizRoutes.js
const express = require('express'); // <<< DIESER IMPORT FEHLTE
const router = express.Router();

// 1. Module importieren
const Quiz = require('../models/Quiz');
const { protect } = require('../middleware/auth'); // Korrigierter Import der Middleware
const multer = require('multer'); // <<< Multer muss HIER importiert werden

// 2. Multer Konfiguration (Muss nach dem Import erfolgen)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }); // <<< Kann Multer JETZT verwenden

/**
 * POST /api/quiz/upload
 * Erlaubt Hosts das Hochladen einer Quiz-JSON-Datei.
 */
router.post('/upload', protect, upload.single('quizFile'), async (req, res) => { 
    
    // 1. Host-Prüfung
    if (!req.user || !req.user.isHost) {
        return res.status(403).json({ message: 'Zugriff verweigert. Nur Hosts dürfen Quizzes hochladen.' });
    }

    // 2. Datei-Prüfung
    if (!req.file) {
        return res.status(400).json({ message: 'Keine Datei hochgeladen.' });
    }
    
    if (req.file.mimetype !== 'application/json') {
         return res.status(400).json({ message: 'Ungültiges Dateiformat. Es wird eine JSON-Datei erwartet.' });
    }

    try {
        // 3. JSON parsen und validieren
        const jsonString = req.file.buffer.toString('utf8');
        const quizData = JSON.parse(jsonString);

        if (!quizData.title || !quizData.questions || !Array.isArray(quizData.questions)) {
            return res.status(400).json({ message: 'Ungültige JSON-Struktur. Erwartet: { "title": "...", "questions": [...] }' });
        }

        // Optional: Basis-Validierung der Fragen-Struktur
        const isValid = quizData.questions.every(q => q.text && q.answer);
        if (!isValid) {
            return res.status(400).json({ message: 'Mindestens eine Frage ist unvollständig (fehlt Text oder Antwort).' });
        }

        // 4. Quiz in Datenbank speichern
        const newQuiz = new Quiz({
            title: quizData.title,
            ownerId: req.user.id, // ID des eingeloggten Hosts
            questions: quizData.questions
        });

        await newQuiz.save();

        res.status(201).json({ 
            message: `Quiz "${newQuiz.title}" erfolgreich gespeichert!`,
            quizId: newQuiz._id
        });

    } catch (error) {
        console.error('Quiz-Upload-Fehler:', error);
        // Fehler beim Parsen des JSON abfangen
        if (error.name === 'SyntaxError') {
             return res.status(400).json({ message: 'Fehler beim Parsen der JSON-Datei. Überprüfen Sie die Syntax.' });
        }
        res.status(500).json({ message: 'Interner Serverfehler beim Speichern des Quiz.' });
    }
});

router.get('/list', protect, async (req, res) => {
    // Host-Prüfung (zusätzlich zur 'protect'-Middleware)
    if (!req.user || !req.user.isHost) {
        return res.status(403).json({ message: 'Zugriff verweigert.' });
    }

    try {
        // Suche alle Quizze, die der aktuellen Host-ID gehören
        const quizzes = await Quiz.find({ ownerId: req.user.id })
            .select('title createdAt') // Wir brauchen nur Titel und ID
            .sort({ createdAt: -1 });

        res.status(200).json(quizzes);

    } catch (error) {
        console.error('Fehler beim Abrufen der Quiz-Liste:', error);
        res.status(500).json({ message: 'Serverfehler beim Laden der Quiz-Liste.' });
    }
});

router.get('/:quizId', protect, async (req, res) => {
    if (!req.user || !req.user.isHost) {
        return res.status(403).json({ message: 'Zugriff verweigert.' });
    }
    
    const quizId = req.params.quizId;

    try {
        // Suche das Quiz anhand der ID und stelle sicher, dass es dem Host gehört
        const quiz = await Quiz.findOne({ _id: quizId, ownerId: req.user.id });

        if (!quiz) {
            return res.status(404).json({ message: 'Quiz nicht gefunden oder Zugriff verweigert.' });
        }

        // Wir senden das gesamte Quiz-Objekt an den Host
        res.status(200).json(quiz);

    } catch (error) {
        console.error('Fehler beim Laden des Quiz:', error);
        res.status(500).json({ message: 'Serverfehler beim Laden des Quiz.' });
    }
});

module.exports = router;