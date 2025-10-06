const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    text: { type: String, required: true },
    answer: { type: String, required: true },
    category: { type: String, default: 'Allgemein' },
    points: { type: Number, default: 1 }
}, { _id: false }); // Kein separates _id für Sub-Dokumente

const quizSchema = new mongoose.Schema({
    title: { type: String, required: true },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Player', // Referenz zum Player-Modell
        required: true
    },
    questions: [questionSchema],
    wbmAnswers: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Quiz', quizSchema);