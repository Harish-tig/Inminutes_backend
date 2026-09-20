require("dotenv").config();
const http = require("http")
const express = require("express");
const mongoose = require('mongoose');
const { initSocket } = require("./sockets/socket")
const userroutes = require("./routes/userroutes")
const productroute = require("./routes/productroutes")
const cartroutes = require("./routes/cartroutes")
const orderroutes = require("./routes/orderroutes")
const grouproutes = require("./routes/grouproutes")
const cors = require("cors");

//connections
const app = express();
const port = 3000;
const server = http.createServer(app)
initSocket(server)

//database connection
const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => console.log("connected to database"))

// Middleware
app.use(cors());
app.use(express.json());
app.use("/api", userroutes);
app.use("/api", productroute)
app.use("/api", cartroutes)
app.use("/api", orderroutes)
app.use("/api", grouproutes)

//connect to mongo db
const mongoDBURL = process.env.MONGO_URI
mongoose.connect(mongoDBURL)
    .then(() => console.log("Connection Successful"))
    .catch((err) => console.error("Connection Error:", err));

//basic routes
app.get("/", (req, res) => {
    res.json({
        message: "Server is running"
    });
});

//Express Server
server.listen(port, () => {
    console.log(`Example app listening on port ${port}`);
});
