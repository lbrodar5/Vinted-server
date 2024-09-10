const express = require("express");
const cors = require("cors");
const { createServer } = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require('jsonwebtoken');
const multer = require("multer");
const fs = require("fs");

const upload = multer({ dest: "images/" });


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

    app.get( "/api/image/:id", async (req,res)=> {
        const id = req.params.id;
        try {
            const image = await db.collection("images").findOne({_id : new ObjectId(id)});
            res.download(image.path, image.originalname);
        } catch(e) {
            console.log(e);
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

    app.delete("/api/article/:id", async (req,res) => {
        const id = req.params.id
        try {
            const article = await db.collection("articles").findOne({_id: new ObjectId(id)});
            article.images.forEach(async imgId => {
                const image = await db.collection("images").findOne({_id : new ObjectId(imgId)})
                fs.unlink(image.path, (err) => { 
                    if (err)  console.log(err);
                });
                const resp = await db.collection("images").deleteOne({_id : image._id});
            });
            const delResp = await db.collection("articles").deleteOne({_id : article._id});
            io.emit('remove',{id: article._id});
            res.send({message: "Done."})
        } catch(e){
            console.log(e);
        }
    }) 
    

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