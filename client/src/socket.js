import { io } from "socket.io-client";

// Use env var so this works across dev / staging / production
const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

const socket = io(SOCKET_URL, {
    autoConnect: true,
});

export default socket;