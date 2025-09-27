// db.js

const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('🔗 MongoDB erfolgreich verbunden.');
    } catch (err) {
        console.error('❌ MongoDB Verbindungsfehler:', err.message);
        // Beende den Prozess bei einem kritischen Fehler
        process.exit(1); 
    }
};

module.exports = connectDB;