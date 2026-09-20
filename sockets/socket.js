const { Server } = require("socket.io");

let io = null;

// Clients join a "room" named after the group session's join code, so a
// broadcast to that room only reaches devices in that group.
const initSocket = (server) => {
    io = new Server(server, {
        cors: { origin: "*" }
    });

    io.on("connection", (socket) => {
        socket.on("group:join", (joinCode) => {
            if (typeof joinCode === "string") {
                socket.join(joinCode);
            }
        });

        socket.on("group:leave", (joinCode) => {
            if (typeof joinCode === "string") {
                socket.leave(joinCode);
            }
        });
    });

    return io;
};

const getIO = () => io;

module.exports = { initSocket, getIO };
