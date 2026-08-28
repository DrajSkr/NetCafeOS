import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import { GoogleOAuthProvider } from '@react-oauth/google';
import FloorMap from "./components/FloorMap"; 
import AdminDashboard from "./components/AdminDashboard"; 
import AdminLogin from "./components/AdminLogin";

// Pull the client ID from Vite's environment variables
const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function App() {
    return (
        <GoogleOAuthProvider clientId={clientId}>
            <BrowserRouter>
                <nav style={{ padding: "1rem", backgroundColor: "#090a0c", borderBottom: "1px solid #1e293b", textAlign: "center" }}>
                    <Link to="/" style={{ color: "#3b82f6", marginRight: "20px", textDecoration: "none", fontWeight: "bold" }}>
                        Storefront
                    </Link>
                    <Link to="/admin" style={{ color: "#22c55e", textDecoration: "none", fontWeight: "bold" }}>
                        Command Center
                    </Link>
                </nav>

                <Routes>
                    <Route path="/" element={<FloorMap />} />
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<AdminDashboard />} />
                </Routes>
            </BrowserRouter>
        </GoogleOAuthProvider>
    );
}