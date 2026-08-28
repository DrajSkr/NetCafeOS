import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import api from '../api';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Terminal } from 'lucide-react';

export default function AdminLogin() {
    const navigate = useNavigate();
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const handleSuccess = async (credentialResponse) => {
        setError("");
        setIsLoading(true);
        try {
            const res = await api.post("/api/auth/google", {
                credential: credentialResponse.credential
            });

            if (res.data.success) {
                if (res.data.role !== 'admin') {
                    setError("Access denied. You do not have admin privileges.");
                    return;
                }
                localStorage.setItem("adminToken", res.data.token);
                navigate("/admin");
            }
        } catch (err) {
            setError(err.response?.data?.error || "Authentication failed. Please try again.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-card">
                {/* Logo */}
                <div className="login-card__logo">
                    NetCafe<span style={{ color: "var(--accent)" }}>OS</span>
                </div>
                <p className="login-card__subtitle">
                    Command Center Access
                </p>

                {/* Icon */}
                <div style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "var(--radius-lg)",
                    background: "var(--accent-dim)",
                    border: "1px solid var(--accent-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1.5rem",
                    animation: "pulse-glow 2.5s ease infinite"
                }}>
                    <ShieldCheck size={28} color="var(--accent)" />
                </div>

                <p style={{
                    fontSize: "0.875rem",
                    color: "var(--text-secondary)",
                    marginBottom: "1.5rem",
                    lineHeight: 1.6
                }}>
                    Sign in with your authorized Google account to access the admin dashboard.
                </p>

                {/* Google Login */}
                <div style={{ display: "flex", justifyContent: "center" }}>
                    <GoogleLogin
                        onSuccess={handleSuccess}
                        onError={() => setError("Google authentication failed. Please try again.")}
                        useOneTap
                        theme="filled_black"
                        shape="pill"
                    />
                </div>

                {/* Error message */}
                {error && (
                    <div style={{
                        marginTop: "1rem",
                        padding: "10px 14px",
                        background: "var(--color-danger-dim)",
                        border: "1px solid rgba(248, 81, 73, 0.3)",
                        borderRadius: "var(--radius-sm)",
                        color: "var(--color-danger)",
                        fontSize: "0.85rem",
                        textAlign: "left",
                        lineHeight: 1.5
                    }}>
                        {error}
                    </div>
                )}

                {isLoading && (
                    <p className="text-xs text-muted" style={{ marginTop: "1rem" }}>
                        Verifying credentials…
                    </p>
                )}

                <div className="login-card__divider">
                    <Terminal size={12} />
                    <span>Admin Portal</span>
                </div>
                <p className="text-xs text-muted">
                    Unauthorized access attempts are logged.
                </p>
            </div>
        </div>
    );
}