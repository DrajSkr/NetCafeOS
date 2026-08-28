import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function AdminLogin() {
    const navigate = useNavigate();

    const handleSuccess = async (credentialResponse) => {
        try {
            const res = await axios.post("http://localhost:5000/api/auth/google", {
                credential: credentialResponse.credential
            });
            
            if (res.data.success) {
                // CRITICAL CHECK: Bounce normal users trying to access the admin portal
                if (res.data.role !== 'admin') {
                    alert("Unauthorized. You do not have admin privileges.");
                    return;
                }
                // Save the JWT provided by our backend
                localStorage.setItem("adminToken", res.data.token);
                // Send them to the dashboard
                navigate("/admin");
            }
        } catch (error) {
            console.error("Login Error:", error);
            alert(error.response?.data?.error || "Login failed or unauthorized.");
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#0f1115' }}>
            <div style={{ padding: '3rem', backgroundColor: '#1e293b', borderRadius: '12px', textAlign: 'center', border: '1px solid #3b82f6' }}>
                <h2 style={{ color: 'white', marginTop: 0, marginBottom: '2rem' }}>Command Center Login</h2>
                <GoogleLogin
                    onSuccess={handleSuccess}
                    onError={() => alert('Google authentication failed')}
                    useOneTap
                />
            </div>
        </div>
    );
}