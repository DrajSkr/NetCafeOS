import { useEffect, useState } from "react";
import axios from "axios";
import { IndianRupee, Users, MonitorSmartphone, Clock } from "lucide-react";

export default function AdminDashboard() {
    const [dashboardData, setDashboardData] = useState({
        stats: { totalRevenue: 0, totalBookings: 0, activeCheckouts: 0 },
        recentBookings: []
    });
    const [loading, setLoading] = useState(true);

    const handleAdminLogout = () => {
        localStorage.removeItem("adminToken");
        window.location.href = "/admin/login";
    };

    // Inside your return() JSX, update the header:
    <header style={{ marginBottom: "2rem", borderBottom: "1px solid #1e293b", paddingBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontSize: "2rem", margin: 0, color: "#3b82f6" }}>NetCafeOS <span style={{ color: "white" }}>Admin</span></h1>
        <button onClick={handleAdminLogout} style={{ padding: "8px 16px", backgroundColor: "#ef4444", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold" }}>
            Exit Command Center
        </button>
    </header>

    useEffect(() => {
        const fetchStats = async () => {
            const token = localStorage.getItem("adminToken");
            
            // Boot them out if they don't have a token
            if (!token) {
                window.location.href = "/admin/login";
                return;
            }

            try {
                // Pass the token to the backend middleware
                const res = await axios.get("http://localhost:5000/api/admin/dashboard", {
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                });
                
                if (res.data.success) {
                    setDashboardData({
                        stats: res.data.stats,
                        recentBookings: res.data.recentBookings
                    });
                }
            } catch (error) {
                console.error("Failed to load admin stats", error);
                // If the backend rejects the token (401/403), clear it and boot them
                if (error.response?.status === 401 || error.response?.status === 403) {
                    localStorage.removeItem("adminToken");
                    window.location.href = "/admin/login";
                }
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
        const interval = setInterval(fetchStats, 10000);
        return () => clearInterval(interval);
    }, []);

    if (loading) return <div style={{ color: "white", padding: "2rem" }}>Loading Command Center...</div>;

    const { stats, recentBookings } = dashboardData;

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#0f1115", color: "#f8fafc", padding: "2vw", fontFamily: "system-ui" }}>
            <header style={{ marginBottom: "2rem", borderBottom: "1px solid #1e293b", paddingBottom: "1rem" }}>
                <h1 style={{ fontSize: "2rem", margin: 0, color: "#3b82f6" }}>NetCafeOS <span style={{ color: "white" }}>Admin</span></h1>
            </header>

            {/* Top Metrics Row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "1.5rem", marginBottom: "3rem" }}>
                <div style={{ backgroundColor: "#1e293b", padding: "1.5rem", borderRadius: "8px", borderLeft: "4px solid #22c55e" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "8px" }}>
                        <IndianRupee size={16} /> Total Revenue
                    </div>
                    <div style={{ fontSize: "2.5rem", fontWeight: "bold", marginTop: "10px" }}>₹{stats.totalRevenue}</div>
                </div>

                <div style={{ backgroundColor: "#1e293b", padding: "1.5rem", borderRadius: "8px", borderLeft: "4px solid #3b82f6" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "8px" }}>
                        <Users size={16} /> Total Bookings
                    </div>
                    <div style={{ fontSize: "2.5rem", fontWeight: "bold", marginTop: "10px" }}>{stats.totalBookings}</div>
                </div>

                <div style={{ backgroundColor: "#1e293b", padding: "1.5rem", borderRadius: "8px", borderLeft: "4px solid #f59e0b" }}>
                    <div style={{ color: "#94a3b8", fontSize: "0.9rem", display: "flex", alignItems: "center", gap: "8px" }}>
                        <MonitorSmartphone size={16} /> Active Checkouts (Redis)
                    </div>
                    <div style={{ fontSize: "2.5rem", fontWeight: "bold", marginTop: "10px", color: "#f59e0b" }}>{stats.activeCheckouts}</div>
                </div>
            </div>

            {/* Recent Transactions Ledger */}
            <div style={{ backgroundColor: "#090a0c", padding: "2rem", borderRadius: "12px", border: "1px solid #1e293b" }}>
                <h2 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: "10px", borderBottom: "1px solid #1e293b", paddingBottom: "1rem" }}>
                    <Clock size={20} color="#3b82f6" /> Recent Transactions
                </h2>
                
                {recentBookings.length === 0 ? (
                    <p style={{ color: "#64748b" }}>No bookings found.</p>
                ) : (
                    <div style={{ display: "grid", gap: "10px", marginTop: "1rem" }}>
                        {recentBookings.map((booking) => (
                            <div key={booking._id} style={{ display: "flex", justifyContent: "space-between", backgroundColor: "#1e293b", padding: "1rem", borderRadius: "8px" }}>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: "bold", color: "#3b82f6" }}>ID: {booking._id.slice(-6).toUpperCase()}</div>
                                    <div style={{ fontSize: "0.85rem", color: "#94a3b8", marginTop: "4px" }}>
                                        User: {booking.userId}
                                    </div>
                                    
                                    {/* The Itemized Seat Ledger */}
                                    <div style={{ marginTop: "10px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                        {booking.items.map((item, idx) => (
                                            <span key={idx} style={{ backgroundColor: "#0f1115", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", border: "1px solid #334155", color: "#e2e8f0" }}>
                                                <span style={{ color: "#22c55e", fontWeight: "bold" }}>{item.seatId}</span> @ {item.timeSlot}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                
                                <div style={{ textAlign: "right", marginLeft: "1rem" }}>
                                    <div style={{ fontWeight: "bold", color: "#22c55e", fontSize: "1.2rem" }}>₹{booking.totalPrice}</div>
                                    <div style={{ fontSize: "0.8rem", color: "#64748b", marginTop: "4px" }}>{new Date(booking.date).toLocaleTimeString()}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}