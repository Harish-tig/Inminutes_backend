// Dev-only tool: connects to the backend, joins a group session's room, and
// prints every group:state broadcast as it arrives. Run alongside REST calls
// (curl/Postman) for that join code to see real-time sync live.
//
// Usage: node scripts/watch-group.js <joinCode> [serverUrl]

const { io } = require("socket.io-client");

const joinCode = process.argv[2];
const serverUrl = process.argv[3] || "http://localhost:3000";

if (!joinCode) {
    console.error("Usage: node scripts/watch-group.js <joinCode> [serverUrl]");
    process.exit(1);
}

const socket = io(serverUrl);

socket.on("connect", () => {
    console.log(`Connected to ${serverUrl}, watching group "${joinCode}"...\n`);
    socket.emit("group:join", joinCode);
});

socket.on("group:state", (state) => {
    console.log(`[${new Date().toLocaleTimeString()}] group:state`);
    console.log(JSON.stringify(state, null, 2));
    console.log("");
});

socket.on("group:participant_removed", (payload) => {
    console.log(`[${new Date().toLocaleTimeString()}] group:participant_removed`);
    console.log(JSON.stringify(payload, null, 2));
    console.log("");
});

socket.on("connect_error", (err) => {
    console.error("Connection failed:", err.message);
});
