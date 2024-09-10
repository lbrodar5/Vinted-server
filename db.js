const mongodb = require("mongodb");

const connect_to_db = async () => {
    const url = "mongodb+srv://user1:user@cluster0.3jst7.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    const client = new mongodb.MongoClient(url);
    const db_name = "vinted";

    try {
        await client.connect();
        console.log("Successfully connected to DB");
    } catch(e) {
        console.log(e)
        console.log("Unable to connect to DB");
    }
    
    let db = client.db(db_name);
    return db;
}

module.exports = { connect_to_db,ObjectId: mongodb.ObjectId};