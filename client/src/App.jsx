import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import { GoogleOAuthProvider } from '@react-oauth/google';
import FloorMap from "./components/FloorMap";
import AdminDashboard from "./components/AdminDashboard";
import AdminLogin from "./components/AdminLogin";
import "./App.css";

const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function App() {
    return (
        <GoogleOAuthProvider clientId={clientId}>
            <BrowserRouter>
                <nav className="app-nav" role="navigation" aria-label="Main navigation">
                    <NavLink to="/" className="app-nav__logo">
                        NetCafe<span className="app-nav__logo-accent">OS</span>
                    </NavLink>
                    <div className="app-nav__links">
                        <NavLink
                            to="/"
                            end
                            className={({ isActive }) =>
                                `app-nav__link${isActive ? " app-nav__link--active" : ""}`
                            }
                        >
                            Storefront
                        </NavLink>
                        <NavLink
                            to="/admin"
                            className={({ isActive }) =>
                                `app-nav__link${isActive ? " app-nav__link--active" : ""}`
                            }
                        >
                            Command Center
                        </NavLink>
                    </div>
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