const sqlite3 = require("sqlite3");
const {open} = require("sqlite");
const path = require("path")

// database object
let db;

const openDb = async () => {
    if(!db)
    {
        db = open({
            filename: path.join(__dirname, "videos.db"),
            driver: sqlite3.Database
        })
    }

    return db;
}


// initialise the video table with all the needed fields
const initialiseVideoTable = async () => {
    const db = await openDb();
    
    await db.exec(`
        CREATE TABLE IF NOT EXISTS videos 
        (
            id TEXT PRIMARY KEY,
            userId TEXT,
            originalFileName TEXT,
            storedFileName TEXT,
            uploadTimestamp INTEGER,
            outputFileName TEXT

        )`
    )

}

module.exports = {
    initialiseVideoTable,
    openDb
}