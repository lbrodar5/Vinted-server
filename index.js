const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken');
const multer = require("multer");
const fs = require("fs");
const {Storage} = require('@google-cloud/storage');

const multerGoogleStorage = require("multer-cloud-storage");

require("dotenv").config()

const storage = new Storage({projectId: process.env.GCLOUD_PROJECT,credentials: {client_email: process.env.CLIENT_EMAIL, private_key: process.env.VINTED_PRIVATE_KEY}  })

// const upload = multer({ 
//     storage: multer.memoryStorage(),
//     limits:{
//         fileSize: 5 * 1024 * 1024
//     }
//  });

const upload = multer({
    storage: multerGoogleStorage.storageEngine({projectId: process.env.GCLOUD_PROJECT, bucket: process.env.VINTED_BUCKET,credentials: {client_email: process.env.CLIENT_EMAIL, private_key: process.env.VINTED_PRIVATE_KEY}})
  });

const bucket = storage.bucket(process.env.VINTED_BUCKET);

const { connect_to_db, ObjectId} = require("./db");


const port = 3000;

let app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, { 
    cors: {
        origin: `*`
      }
});

(async () => {
    let db;
    try {
        db = await connect_to_db();
    } catch(e) {
        console.log(e);
    }

    app.use(cors());
    app.use(express.json());
    app.use(express.urlencoded({ extended: false }));


    app.get("/api/articles", async (req,res) => {
        try {
            const articles = await db.collection("articles").find().toArray();
            res.send(articles);
        } catch(e) {
            console.log(e);
        }
    });

    app.get("/api/articles/:id", async (req,res) => {
        const id = req.params.id
        try {
            const user = await db.collection("users").findOne({_id : new ObjectId(id)})
            const articles = await db.collection("articles").find({username : user.username}).toArray();
            res.send(articles);
        } catch(e) {
            console.log(e);
        }
    });

    app.get("/api/image/:id", async (req, res) => {
        const id = req.params.id;
        try {
            // Find image metadata in MongoDB
            const image = await db.collection("images").findOne({_id: new ObjectId(id)});
            
            if (!image) {
                return res.status(404).send({error: "Image not found."});
            }
    
            // Use the filename or URL stored in your MongoDB collection
            const file = bucket.file(image.filename);  // `image.filename` is stored when you upload using multer-cloud-storage
    
            // Stream the file from Google Cloud Storage to the response
            file.createReadStream()
                .on('error', (err) => {
                    console.error(err);
                    res.status(500).send({error: "Unable to download the image."});
                })
                .on('response', (fileResponse) => {
                    // Set headers for file download
                    res.setHeader('Content-Type', fileResponse.headers['content-type']);
                    res.setHeader('Content-Disposition', `attachment; filename="${image.filename}"`);
                })
                .pipe(res);  // Pipe the file data to the response
        } catch (e) {
            console.log(e);
            res.status(500).send({error: "Something went wrong."});
        }
    });
    

    app.post("/api/register",async (req,res) => {
        let {username, password} = req.body;
        if(!username) {
            res.send({error: "Invalid username."})
        } else if (password.length < 6) {
                res.send({error: "Password must be at least 6 characters long."})
            } else {
                try {
                const salt = await bcrypt.genSalt();
                password = await bcrypt.hash(password,salt);
                    if(await db.collection("users").findOne({username: username})) {
                        res.send({error: "Username already taken."})
                    } else {
                        const resp = await db.collection("users").insertOne({username, password})
                        res.send({message: "Successfuly created. Try logging in."})
                    }
                } catch(e){
                    console.log(e.message);
                }
            }
        });
    
    app.post("/api/login", async (req,res) => {
        let {username, password} = req.body;
        try {
            const resp = await db.collection("users").findOne({username: username});
            if(resp && await bcrypt.compare(password,resp.password)) {
                token = createToken(resp._id);
                res.send({token, _id: resp._id, username: resp.username});
            } else {
                res.send({error: "Wrong username or password."})
            }
        } catch(e){
            console.log(e)
        }
    })

    app.post("/api/article",upload.array('images', 10), async (req,res) => {
        let article = JSON.parse(req.body.article);
        try {
            const imgResp = await db.collection("images").insertMany(req.files);

            article.images = Object.values(imgResp.insertedIds);
            const resp = await db.collection("articles").insertOne(article);
            io.emit('article',article);
            res.send({message: "Done."});
        } catch(e) {
            console.log(e);
        }

    });

    app.delete("/api/article/:id", async (req, res) => {
        const id = req.params.id;
        try {
            // Find the article in the database
            const article = await db.collection("articles").findOne({_id: new ObjectId(id)});
    
            if (!article) {
                return res.status(404).send({error: "Article not found."});
            }
    
            // Iterate over all images in the article and delete them
            for (let imgId of article.images) {
                const image = await db.collection("images").findOne({_id: new ObjectId(imgId)});
                
                if (!image) {
                    console.log(`Image with id ${imgId} not found.`);
                    continue;
                }
    
                // Delete the image from Google Cloud Storage
                const file = bucket.file(image.filename); // assuming image.filename holds the file name stored in Google Cloud
                await file.delete();
    
                // Delete the image from the MongoDB database
                await db.collection("images").deleteOne({_id: image._id});
            }
    
            // Delete the article itself
            await db.collection("articles").deleteOne({_id: article._id});
            
            // Emit an event to notify clients that the article has been removed
            io.emit('remove', {id: article._id});
            
            // Send response back to the client
            res.send({message: "Article and associated images successfully deleted."});
    
        } catch (e) {
            console.log(e);
            res.status(500).send({error: "Something went wrong while deleting the article and its images."});
        }
    });
    
    

    io.on("connection", (socket) => { 
        console.log("connected")
    });

    
    httpServer.listen(port, () => {
        console.log(`Server is listening at ${port}`);
    });
})()


const createToken = (id) => {
    return  jwt.sign({id},"shhhh ovo je tajna", {
        expiresIn: "2d"
    });
}