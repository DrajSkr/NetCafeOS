import { io } from "socket.io-client";

// Connect to your Express/Socket.io backend running on port 5000
const socket = io("http://localhost:5000", {
  autoConnect: true,
});

export default socket;