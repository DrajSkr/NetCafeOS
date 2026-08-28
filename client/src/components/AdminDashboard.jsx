import { useEffect, useState, useCallback, useRef } from "react";
import api from "../api";
import {
    IndianRupee, Users, MonitorSmartphone, Activity, LogOut,
    Search, ShieldOff, ShieldCheck, Trash2, BarChart2,
    Clock, RefreshCw, AlertTriangle, X, ChevronDown, ChevronUp,
    FileText, User as UserIcon, Wrench
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────
const getAdminHeaders = () => ({
    headers: { Authorization: `Bearer ${localStorage.getItem("adminToken")}` }
});

function redirectLogin() {
    localStorage.removeItem("adminToken");
    window.location.href = "/admin/login";
}

// ─── Sub-components ──────────────────────────────────────────────────────────
function SkeletonRow({ cols = 5 }) {
    return (
        <tr>
            {Array.from({ length: cols }).map((_, i) => (
                <td key={i}>
                    <div className="skeleton" style={{ height: "14px", width: `${[90, 160, 200, 70, 60][i] || 80}px`, maxWidth: "100%" }} />
                </td>
            ))}
        </tr>
    );
}

// ── Daily Revenue Bar Chart (pure CSS) ───────────────────────────────────────
function RevenueChart({ data, loading }) {
    if (loading) {
        return (
            <div style={{ display: "flex", alignItems: "flex-end", gap: "6px", height: "120px", padding: "0 4px" }}>
                {Array.from({ length: 15 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ flex: 1, height: `${30 + Math.random() * 70}%`, borderRadius: "4px 4px 0 0" }} />
                ))}
            </div>
        );
    }

    if (!data.length) {
        return <p className="text-muted text-sm" style={{ textAlign: "center", padding: "2rem 0" }}>No revenue data in the last 30 days.</p>;
    }

    const maxRevenue = Math.max(...data.map(d => d.revenue), 1);

    return (
        <div style={{ overflowX: "auto" }}>
            <div style={{ display: "flex", alignItems: "flex-end", gap: "4px", height: "130px", minWidth: `${data.length * 28}px`, paddingBottom: "2px" }}>
                {data.map((d) => {
                    const heightPct = Math.max((d.revenue / maxRevenue) * 100, 4);
                    const [year, month, day] = d._id.split("-");
                    const label = `${day}/${month}`;
                    return (
                        <div key={d._id} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "3px", minWidth: "22px" }} title={`${d._id}\n₹${d.revenue} · ${d.bookings} booking${d.bookings !== 1 ? "s" : ""}`}>
                            <span style={{ fontSize: "0.6rem", color: "var(--color-success)", fontWeight: 700, lineHeight: 1, visibility: d.revenue > 0 ? "visible" : "hidden" }}>
                                ₹{d.revenue >= 1000 ? `${(d.revenue / 1000).toFixed(1)}k` : d.revenue}
                            </span>
                            <div style={{
                                width: "100%",
                                height: `${heightPct}%`,
                                background: "linear-gradient(to top, var(--color-success), rgba(63, 185, 80, 0.4))",
                                borderRadius: "3px 3px 0 0",
                                transition: "height 0.4s ease",
                                cursor: "pointer"
                            }} />
                            <span style={{ fontSize: "0.55rem", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── Booking Detail Expandable ─────────────────────────────────────────────────
function BookingRow({ booking }) {
    const [expanded, setExpanded] = useState(false);
    return (
        <>
            <tr style={{ cursor: "pointer" }} onClick={() => setExpanded(e => !e)}>
                <td><span className="booking-id">#{booking._id.slice(-6).toUpperCase()}</span></td>
                <td>
                    <span className="text-sm" style={{ color: "var(--text-secondary)", maxWidth: 160, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {booking.userId}
                    </span>
                </td>
                <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                        {booking.items?.slice(0, 2).map((item, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 700, color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "var(--radius-sm)", padding: "1px 6px", whiteSpace: "nowrap" }}>{item.seatId}</span>
                                <span className="text-xs text-muted" style={{ whiteSpace: "nowrap" }}>{item.date}</span>
                                <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--color-success)", background: "var(--color-success-dim)", borderRadius: "var(--radius-sm)", padding: "1px 5px", whiteSpace: "nowrap" }}>{item.timeSlot}</span>
                            </div>
                        ))}
                        {booking.items?.length > 2 && <span className="text-xs text-muted">+{booking.items.length - 2} more</span>}
                    </div>
                </td>
                <td style={{ textAlign: "right" }}><span className="text-success font-bold">₹{booking.totalPrice}</span></td>
                <td style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                        <span className="text-xs text-muted">{new Date(booking.date).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                        {expanded ? <ChevronUp size={14} color="var(--text-muted)" /> : <ChevronDown size={14} color="var(--text-muted)" />}
                    </div>
                </td>
            </tr>
            {expanded && (
                <tr>
                    <td colSpan={5} style={{ padding: "0 1rem 0.75rem", background: "var(--bg-surface)" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingTop: 8 }}>
                            {booking.items?.map((item, idx) => (
                                <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                    <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem", fontWeight: 700, color: "var(--accent)", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "var(--radius-sm)", padding: "2px 8px" }}>{item.seatId}</span>
                                    <span className="text-xs text-muted">{item.date}</span>
                                    <span style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--color-success)", background: "var(--color-success-dim)", borderRadius: "var(--radius-sm)", padding: "2px 6px" }}>{item.timeSlot}</span>
                                    <span className="text-xs text-muted">₹{item.price}</span>
                                </div>
                            ))}
                        </div>
                    </td>
                </tr>
            )}
        </>
    );
}

// ── Active Lock Chip ──────────────────────────────────────────────────────────
function LockChip({ lock }) {
    const urgent = lock.ttlSeconds < 30;
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
            background: urgent ? "var(--color-warning-dim)" : "var(--bg-elevated)",
            border: `1px solid ${urgent ? "rgba(210,153,34,0.4)" : "var(--border-subtle)"}`,
            borderRadius: "var(--radius-sm)", fontSize: "0.78rem", whiteSpace: "nowrap"
        }}>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: urgent ? "var(--color-warning)" : "var(--accent)" }}>{lock.seatId}</span>
            <span className="text-muted" style={{ fontSize: "0.7rem" }}>{lock.date}</span>
            <span style={{ color: "var(--color-success)", fontWeight: 600 }}>{lock.slot}</span>
            <span style={{ color: urgent ? "var(--color-warning)" : "var(--text-muted)", fontSize: "0.65rem" }}>{lock.ttlSeconds}s</span>
        </div>
    );
}

// ─── TABS ────────────────────────────────────────────────────────────────────
const TABS = [
    { id: "overview",     label: "Overview",     icon: BarChart2 },
    { id: "users",        label: "Users",        icon: Users },
    { id: "search",       label: "Ticket Search",icon: Search },
    { id: "maintenance",  label: "Maintenance",  icon: Wrench },
];

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function AdminDashboard() {
    const [activeTab, setActiveTab] = useState("overview");

    // Overview state
    const [stats, setStats] = useState({ totalRevenue: 0, totalBookings: 0, activeCheckouts: 0, activeLockDetails: [] });
    const [recentBookings, setRecentBookings] = useState([]);
    const [dailyRevenue, setDailyRevenue] = useState([]);
    const [loadingOverview, setLoadingOverview] = useState(true);
    const [loadingChart, setLoadingChart] = useState(true);
    const [lastUpdated, setLastUpdated] = useState(null);

    // Users tab state
    const [userSearch, setUserSearch] = useState("");
    const [users, setUsers] = useState([]);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [selectedUser, setSelectedUser] = useState(null);
    const [userBookings, setUserBookings] = useState([]);
    const [loadingUserBookings, setLoadingUserBookings] = useState(false);
    const [banningEmail, setBanningEmail] = useState(null);
    const [userError, setUserError] = useState("");

    // Ticket Search state
    const [ticketQuery, setTicketQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [loadingSearch, setLoadingSearch] = useState(false);
    const [searchError, setSearchError] = useState("");

    // Maintenance state
    const [cleanupResult, setCleanupResult] = useState(null);
    const [cleanupLoading, setCleanupLoading] = useState(false);

    // ── Data fetching ───────────────────────────────────────────────────────

    const fetchOverview = useCallback(async () => {
        const token = localStorage.getItem("adminToken");
        if (!token) { redirectLogin(); return; }
        try {
            const res = await api.get("/api/admin/dashboard", getAdminHeaders());
            if (res.data.success) {
                setStats(res.data.stats);
                setRecentBookings(res.data.recentBookings);
                setLastUpdated(new Date());
            }
        } catch (err) {
            if (err.response?.status === 401 || err.response?.status === 403) redirectLogin();
        } finally {
            setLoadingOverview(false);
        }
    }, []);

    const fetchDailyRevenue = useCallback(async () => {
        try {
            const res = await api.get("/api/admin/revenue/daily", getAdminHeaders());
            if (res.data.success) setDailyRevenue(res.data.dailyRevenue);
        } catch { /* silent */ } finally {
            setLoadingChart(false);
        }
    }, []);

    useEffect(() => {
        fetchOverview();
        fetchDailyRevenue();
        const interval = setInterval(fetchOverview, 10000);
        return () => clearInterval(interval);
    }, [fetchOverview, fetchDailyRevenue]);

    const fetchUsers = useCallback(async (q = "") => {
        setLoadingUsers(true);
        setUserError("");
        try {
            const res = await api.get(`/api/admin/users?search=${encodeURIComponent(q)}`, getAdminHeaders());
            if (res.data.success) setUsers(res.data.users);
        } catch (err) {
            setUserError(err.response?.data?.error || "Failed to load users list.");
        } finally {
            setLoadingUsers(false);
        }
    }, []);

    const fetchUserBookings = async (email) => {
        setLoadingUserBookings(true);
        try {
            const res = await api.get(`/api/admin/users/${encodeURIComponent(email)}/bookings`, getAdminHeaders());
            if (res.data.success) setUserBookings(res.data.bookings);
        } catch { /* silent */ } finally {
            setLoadingUserBookings(false);
        }
    };

    const handleUserSelect = (user) => {
        setSelectedUser(user);
        setUserError("");
        setUserBookings([]);
        fetchUserBookings(user.email);
    };

    const handleBanToggle = async (user) => {
        setBanningEmail(user.email);
        setUserError("");
        try {
            const res = await api.patch(`/api/admin/users/${encodeURIComponent(user.email)}/ban`, {}, getAdminHeaders());
            if (res.data.success) {
                setUsers(prev => prev.map(u => u.email === user.email ? { ...u, isBanned: res.data.isBanned } : u));
                if (selectedUser?.email === user.email) {
                    setSelectedUser(prev => ({ ...prev, isBanned: res.data.isBanned }));
                }
            }
        } catch (err) {
            setUserError(err.response?.data?.error || "Failed to update user ban status.");
        } finally {
            setBanningEmail(null);
        }
    };

    const handleTicketSearch = async () => {
        if (ticketQuery.trim().length < 3) { setSearchError("Enter at least 3 characters."); return; }
        setSearchError("");
        setLoadingSearch(true);
        setSearchResults([]);
        try {
            const res = await api.get(`/api/admin/search?q=${encodeURIComponent(ticketQuery)}`, getAdminHeaders());
            if (res.data.success) setSearchResults(res.data.results);
            if (res.data.results.length === 0) setSearchError("No matching bookings found.");
        } catch { setSearchError("Search failed. Try again."); } finally {
            setLoadingSearch(false);
        }
    };

    const handleCleanup = async () => {
        if (!window.confirm("This will permanently delete all bookings older than 30 days and flush stale Redis locks. Proceed?")) return;
        setCleanupLoading(true);
        setCleanupResult(null);
        try {
            const res = await api.post("/api/admin/cleanup", {}, getAdminHeaders());
            if (res.data.success) setCleanupResult(res.data);
        } catch { setCleanupResult({ message: "Cleanup failed. Check server logs." }); } finally {
            setCleanupLoading(false);
        }
    };

    // ── Render ───────────────────────────────────────────────────────────────

    const statCards = [
        { label: "Total Revenue",     value: `₹${stats.totalRevenue.toLocaleString("en-IN")}`, icon: <IndianRupee size={15} />, accent: "var(--color-success)" },
        { label: "Total Bookings",    value: stats.totalBookings.toLocaleString("en-IN"),       icon: <Users size={15} />,       accent: "var(--accent)" },
        { label: "Active Checkouts",  value: stats.activeCheckouts,                             icon: <MonitorSmartphone size={15} />, accent: "var(--color-warning)" },
    ];

    return (
        <div style={{ padding: "clamp(1rem, 3vw, 2rem)", minHeight: "100vh" }}>

            {/* Header */}
            <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", paddingBottom: "1.25rem", borderBottom: "1px solid var(--border-subtle)", flexWrap: "wrap", gap: "1rem" }}>
                <div>
                    <h1 style={{ fontSize: "clamp(1.3rem, 3vw, 1.9rem)", fontWeight: 900, letterSpacing: "-0.5px", margin: 0 }}>
                        NetCafe<span style={{ color: "var(--accent)" }}>OS</span>{" "}
                        <span style={{ color: "var(--text-secondary)", fontWeight: 500 }}>Command Center</span>
                    </h1>
                    {lastUpdated && (
                        <p className="text-xs text-muted" style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 5 }}>
                            <Activity size={12} /> Live · refreshed {lastUpdated.toLocaleTimeString()}
                        </p>
                    )}
                </div>
                <button className="btn btn-danger" onClick={() => { localStorage.removeItem("adminToken"); window.location.href = "/admin/login"; }}>
                    <LogOut size={16} /> Sign Out
                </button>
            </header>

            {/* Tab Bar */}
            <div style={{ display: "flex", gap: 4, marginBottom: "1.5rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: 0, flexWrap: "wrap" }}>
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        onClick={() => {
                            setActiveTab(id);
                            if (id === "users" && users.length === 0) fetchUsers();
                        }}
                        style={{
                            display: "flex", alignItems: "center", gap: 7, padding: "8px 14px",
                            background: "transparent", border: "none", cursor: "pointer",
                            borderBottom: activeTab === id ? "2px solid var(--accent)" : "2px solid transparent",
                            color: activeTab === id ? "var(--accent)" : "var(--text-secondary)",
                            fontFamily: "var(--font-sans)", fontSize: "0.875rem", fontWeight: 600,
                            marginBottom: -1, transition: "all 0.15s ease"
                        }}
                    >
                        <Icon size={15} /> {label}
                    </button>
                ))}
            </div>

            {/* ══ TAB: OVERVIEW ══════════════════════════════════════════════════════ */}
            {activeTab === "overview" && (
                <>
                    {/* Stat Cards */}
                    <div className="stat-grid">
                        {statCards.map(({ label, value, icon, accent }) => (
                            <div key={label} className="stat-card">
                                <div className="stat-card__accent" style={{ background: accent }} />
                                {loadingOverview ? (
                                    <>
                                        <div className="skeleton" style={{ height: 13, width: 120, marginBottom: 12 }} />
                                        <div className="skeleton" style={{ height: 38, width: 80 }} />
                                    </>
                                ) : (
                                    <>
                                        <div className="stat-card__label" style={{ color: accent }}>{icon} {label}</div>
                                        <div className="stat-card__value" style={{ color: accent }}>{value}</div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Active Checkout Details */}
                    {!loadingOverview && stats.activeLockDetails?.length > 0 && (
                        <div className="card" style={{ marginBottom: "1.5rem", padding: "1rem 1.25rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                                <MonitorSmartphone size={16} color="var(--color-warning)" />
                                <span style={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--color-warning)" }}>
                                    Live Checkout Sessions ({stats.activeLockDetails.length})
                                </span>
                                <span className="text-xs text-muted" style={{ marginLeft: "auto" }}>TTL shown in seconds</span>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                                {stats.activeLockDetails.map((lock, i) => <LockChip key={i} lock={lock} />)}
                            </div>
                        </div>
                    )}

                    {!loadingOverview && stats.activeLockDetails?.length === 0 && (
                        <div className="card" style={{ marginBottom: "1.5rem", padding: "0.875rem 1.25rem", display: "flex", alignItems: "center", gap: 8 }}>
                            <MonitorSmartphone size={16} color="var(--text-muted)" />
                            <span className="text-sm text-muted">No active checkout sessions right now.</span>
                        </div>
                    )}

                    {/* Daily Revenue Chart */}
                    <div className="card" style={{ marginBottom: "1.5rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem" }}>
                            <BarChart2 size={18} color="var(--color-success)" />
                            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Revenue — Last 30 Days</h2>
                            <button onClick={fetchDailyRevenue} className="btn btn-ghost btn-icon" style={{ marginLeft: "auto" }} title="Refresh">
                                <RefreshCw size={14} />
                            </button>
                        </div>
                        <RevenueChart data={dailyRevenue} loading={loadingChart} />
                    </div>

                    {/* Recent Transactions */}
                    <div className="card" style={{ padding: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border-subtle)" }}>
                            <Clock size={18} color="var(--accent)" />
                            <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 700 }}>Recent Transactions</h2>
                            <span style={{ marginLeft: "auto", fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                                Click row to expand · Auto-refreshes 10s
                            </span>
                        </div>
                        <div style={{ overflowX: "auto" }}>
                            <table className="transactions-table">
                                <thead>
                                    <tr>
                                        <th>Booking ID</th>
                                        <th>User</th>
                                        <th>Seats / Slots</th>
                                        <th style={{ textAlign: "right" }}>Amount</th>
                                        <th style={{ textAlign: "right" }}>Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {loadingOverview
                                        ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                                        : recentBookings.length === 0
                                            ? <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--text-muted)", padding: "2rem", background: "transparent" }}>No transactions yet.</td></tr>
                                            : recentBookings.map(b => <BookingRow key={b._id} booking={b} />)
                                    }
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* ══ TAB: USERS ════════════════════════════════════════════════════════ */}
            {activeTab === "users" && (
                <div style={{ display: "grid", gridTemplateColumns: selectedUser ? "1fr 1fr" : "1fr", gap: "1.5rem", alignItems: "start" }}>

                    {/* User List Panel */}
                    <div className="card" style={{ padding: 0 }}>
                        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border-subtle)", display: "flex", gap: 8 }}>
                            <input
                                className="form-input"
                                placeholder="Search by name or email…"
                                value={userSearch}
                                onChange={e => setUserSearch(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && fetchUsers(userSearch)}
                            />
                            <button className="btn btn-primary" onClick={() => fetchUsers(userSearch)} disabled={loadingUsers}>
                                <Search size={15} />
                            </button>
                        </div>

                        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                            {loadingUsers ? (
                                <div style={{ padding: "1rem" }}>
                                    {Array.from({ length: 6 }).map((_, i) => (
                                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "0.75rem 0", borderBottom: "1px solid var(--border-subtle)" }}>
                                            <div className="skeleton" style={{ width: 36, height: 36, borderRadius: "50%" }} />
                                            <div style={{ flex: 1 }}>
                                                <div className="skeleton" style={{ height: 13, width: "60%", marginBottom: 6 }} />
                                                <div className="skeleton" style={{ height: 11, width: "40%" }} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : users.length === 0 ? (
                                <p className="text-muted text-sm" style={{ textAlign: "center", padding: "2rem" }}>
                                    {userSearch ? "No users found." : "Search for a user above."}
                                </p>
                            ) : (
                                users.map(user => (
                                    <div
                                        key={user.email}
                                        onClick={() => handleUserSelect(user)}
                                        style={{
                                            display: "flex", alignItems: "center", gap: 10, padding: "0.875rem 1.25rem",
                                            borderBottom: "1px solid var(--border-subtle)", cursor: "pointer",
                                            background: selectedUser?.email === user.email ? "var(--accent-dim)" : "transparent",
                                            borderLeft: selectedUser?.email === user.email ? "3px solid var(--accent)" : "3px solid transparent",
                                            transition: "all 0.15s ease"
                                        }}
                                    >
                                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: user.isBanned ? "var(--color-danger-dim)" : "var(--accent-dim)", border: `1px solid ${user.isBanned ? "rgba(248,81,73,0.3)" : "var(--accent-border)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                            <UserIcon size={16} color={user.isBanned ? "var(--color-danger)" : "var(--accent)"} />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: "0.875rem", color: user.isBanned ? "var(--color-danger)" : "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
                                                {user.name}
                                                {user.isBanned && <span style={{ fontSize: "0.65rem", background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid rgba(248,81,73,0.3)", borderRadius: "var(--radius-full)", padding: "1px 6px", fontWeight: 700 }}>BANNED</span>}
                                            </div>
                                            <div className="text-xs text-muted truncate">{user.email}</div>
                                        </div>
                                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                                            <div className="text-xs" style={{ color: "var(--accent)", fontWeight: 700 }}>{user.bookingCount} bookings</div>
                                            <div className="text-xs text-muted">₹{user.totalSpent}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* User Detail Panel */}
                    {selectedUser && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                            {/* User card */}
                            <div className="card">
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
                                    <div>
                                        <h3 style={{ margin: 0, fontSize: "1.1rem", display: "flex", alignItems: "center", gap: 8 }}>
                                            {selectedUser.name}
                                            {selectedUser.isBanned && <span style={{ fontSize: "0.72rem", background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid rgba(248,81,73,0.3)", borderRadius: "var(--radius-full)", padding: "2px 8px" }}>BANNED</span>}
                                        </h3>
                                        <p className="text-sm text-muted" style={{ marginTop: 3 }}>{selectedUser.email}</p>
                                    </div>
                                    <button className="modal__close" onClick={() => setSelectedUser(null)} aria-label="Close"><X size={16} /></button>
                                </div>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: "1rem" }}>
                                    {[
                                        ["Bookings", selectedUser.bookingCount],
                                        ["Total Spent", `₹${selectedUser.totalSpent}`],
                                        ["Role", selectedUser.role],
                                        ["Last Login", selectedUser.lastLogin ? new Date(selectedUser.lastLogin).toLocaleDateString("en-IN") : "—"],
                                    ].map(([k, v]) => (
                                        <div key={k} style={{ background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", padding: "8px 12px" }}>
                                            <div className="text-xs text-muted">{k}</div>
                                            <div style={{ fontWeight: 700, fontSize: "0.9rem", marginTop: 2 }}>{v}</div>
                                        </div>
                                    ))}
                                </div>
                                {userError && (
                                    <div style={{
                                        marginBottom: "0.75rem",
                                        padding: "8px 12px",
                                        background: "var(--color-danger-dim)",
                                        border: "1px solid rgba(248, 81, 73, 0.3)",
                                        borderRadius: "var(--radius-sm)",
                                        color: "var(--color-danger)",
                                        fontSize: "0.8rem",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "6px"
                                    }}>
                                        <AlertTriangle size={14} /> {userError}
                                    </div>
                                )}
                                <button
                                    className={`btn w-full ${selectedUser.isBanned ? "btn-success" : "btn-danger"}`}
                                    onClick={() => handleBanToggle(selectedUser)}
                                    disabled={banningEmail === selectedUser.email}
                                >
                                    {banningEmail === selectedUser.email
                                        ? "Updating…"
                                        : selectedUser.isBanned
                                            ? <><ShieldCheck size={15} /> Unban User</>
                                            : <><ShieldOff size={15} /> Ban User</>
                                    }
                                </button>
                            </div>

                            {/* User's Bookings */}
                            <div className="card" style={{ padding: 0 }}>
                                <div style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--border-subtle)", display: "flex", alignItems: "center", gap: 8 }}>
                                    <FileText size={16} color="var(--accent)" />
                                    <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>Booking History</span>
                                </div>
                                <div style={{ maxHeight: "340px", overflowY: "auto" }}>
                                    {loadingUserBookings
                                        ? <div style={{ padding: "1rem" }}>{Array.from({ length: 3 }).map((_, i) => <div key={i} className="skeleton" style={{ height: 56, borderRadius: "var(--radius-sm)", marginBottom: 8 }} />)}</div>
                                        : userBookings.length === 0
                                            ? <p className="text-muted text-sm" style={{ textAlign: "center", padding: "1.5rem" }}>No bookings found.</p>
                                            : userBookings.map(booking => (
                                                <div key={booking._id} style={{ padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--border-subtle)" }}>
                                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                                        <span className="booking-id">#{booking._id.slice(-6).toUpperCase()}</span>
                                                        <span className="text-success font-bold">₹{booking.totalPrice}</span>
                                                    </div>
                                                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                                        {booking.items?.slice(0, 3).map((item, idx) => (
                                                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                                                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)" }}>{item.seatId}</span>
                                                                <span className="text-xs text-muted">{item.date}</span>
                                                                <span style={{ fontSize: "0.68rem", color: "var(--color-success)", fontWeight: 600 }}>{item.timeSlot}</span>
                                                            </div>
                                                        ))}
                                                        {booking.items?.length > 3 && <span className="text-xs text-muted">+{booking.items.length - 3} more</span>}
                                                    </div>
                                                </div>
                                            ))
                                    }
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ══ TAB: TICKET SEARCH ═══════════════════════════════════════════════ */}
            {activeTab === "search" && (
                <div style={{ maxWidth: 700 }}>
                    <div className="card" style={{ marginBottom: "1.5rem" }}>
                        <h2 style={{ margin: "0 0 0.5rem", fontSize: "1rem" }}>Search by Booking ID or Seat ID</h2>
                        <p className="text-sm text-muted" style={{ marginBottom: "1rem" }}>
                            Enter the last 6 characters of a Booking ID (e.g. <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>AB12CD</span>) or a seat ID like <span style={{ fontFamily: "var(--font-mono)", color: "var(--accent)" }}>ECO_001</span> to find the owner.
                        </p>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                className="form-input"
                                placeholder="e.g.  AB12CD  or  ECO_001"
                                value={ticketQuery}
                                onChange={e => setTicketQuery(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleTicketSearch()}
                            />
                            <button className="btn btn-primary" onClick={handleTicketSearch} disabled={loadingSearch}>
                                {loadingSearch ? <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Search size={15} />}
                                Search
                            </button>
                        </div>
                        {searchError && (
                            <div style={{ marginTop: "0.75rem", color: "var(--color-danger)", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: 6 }}>
                                <AlertTriangle size={14} /> {searchError}
                            </div>
                        )}
                    </div>

                    {searchResults.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                            {searchResults.map((r, idx) => (
                                <div key={idx} className="card card-elevated" style={{ padding: "1.25rem" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.875rem", flexWrap: "wrap", gap: 8 }}>
                                        <div>
                                            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                                                Matched on {r.matchedOn}
                                            </div>
                                            <span className="booking-id">#{r.booking._id.slice(-6).toUpperCase()}</span>
                                        </div>
                                        <span className="text-success font-bold" style={{ fontSize: "1.1rem" }}>₹{r.booking.totalPrice}</span>
                                    </div>

                                    {/* Owner */}
                                    {r.user && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--bg-elevated)", borderRadius: "var(--radius-sm)", marginBottom: "0.875rem" }}>
                                            <UserIcon size={15} color="var(--accent)" />
                                            <div>
                                                <div style={{ fontWeight: 700, fontSize: "0.875rem" }}>{r.user.name}</div>
                                                <div className="text-xs text-muted">{r.user.email}</div>
                                            </div>
                                            {r.user.isBanned && (
                                                <span style={{ marginLeft: "auto", fontSize: "0.65rem", background: "var(--color-danger-dim)", color: "var(--color-danger)", border: "1px solid rgba(248,81,73,0.3)", borderRadius: "var(--radius-full)", padding: "2px 8px", fontWeight: 700 }}>BANNED</span>
                                            )}
                                        </div>
                                    )}

                                    {/* Items */}
                                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                        {r.booking.items?.map((item, i) => (
                                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 700, color: r.matchedSeat?.seatId === item.seatId ? "var(--color-warning)" : "var(--accent)", background: r.matchedSeat?.seatId === item.seatId ? "var(--color-warning-dim)" : "var(--accent-dim)", border: `1px solid ${r.matchedSeat?.seatId === item.seatId ? "rgba(210,153,34,0.4)" : "var(--accent-border)"}`, borderRadius: "var(--radius-sm)", padding: "1px 7px" }}>
                                                    {item.seatId}
                                                </span>
                                                <span className="text-xs text-muted">{item.date}</span>
                                                <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "var(--color-success)", background: "var(--color-success-dim)", borderRadius: "var(--radius-sm)", padding: "1px 5px" }}>{item.timeSlot}</span>
                                                <span className="text-xs text-muted">₹{item.price}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ══ TAB: MAINTENANCE ════════════════════════════════════════════════ */}
            {activeTab === "maintenance" && (
                <div style={{ maxWidth: 600, display: "flex", flexDirection: "column", gap: "1.25rem" }}>

                    <div className="card">
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                            <div style={{ padding: "10px", background: "var(--color-danger-dim)", borderRadius: "var(--radius-md)", flexShrink: 0 }}>
                                <Trash2 size={20} color="var(--color-danger)" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Database Cleanup</h3>
                                <p className="text-sm text-muted" style={{ marginBottom: "1rem" }}>
                                    Permanently deletes all bookings older than <strong style={{ color: "var(--text-primary)" }}>30 days</strong> from MongoDB. Also flushes any Redis locks that were accidentally set without an expiry (TTL = -1). This action cannot be undone.
                                </p>
                                <button
                                    className="btn btn-danger"
                                    onClick={handleCleanup}
                                    disabled={cleanupLoading}
                                >
                                    {cleanupLoading ? <><RefreshCw size={15} /> Running…</> : <><Trash2 size={15} /> Run Cleanup</>}
                                </button>
                            </div>
                        </div>

                        {cleanupResult && (
                            <div style={{ marginTop: "1rem", padding: "0.875rem 1rem", background: "var(--color-success-dim)", border: "1px solid rgba(63,185,80,0.3)", borderRadius: "var(--radius-sm)", fontSize: "0.875rem", color: "var(--color-success)" }}>
                                ✅ {cleanupResult.message}
                            </div>
                        )}
                    </div>

                    <div className="card">
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                            <div style={{ padding: "10px", background: "var(--color-warning-dim)", borderRadius: "var(--radius-md)", flexShrink: 0 }}>
                                <MonitorSmartphone size={20} color="var(--color-warning)" />
                            </div>
                            <div>
                                <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Active Redis Locks</h3>
                                <p className="text-sm text-muted">
                                    Current checkout sessions in Redis: <strong style={{ color: "var(--color-warning)" }}>{stats.activeCheckouts}</strong> active lock{stats.activeCheckouts !== 1 ? "s" : ""}.
                                    These expire automatically within 120 seconds if checkout is abandoned. Only truly stale locks (permanent TTL) are removed by cleanup above.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="card">
                        <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                            <div style={{ padding: "10px", background: "var(--accent-dim)", borderRadius: "var(--radius-md)", flexShrink: 0 }}>
                                <Activity size={20} color="var(--accent)" />
                            </div>
                            <div>
                                <h3 style={{ margin: "0 0 4px", fontSize: "1rem" }}>Data Retention Policy</h3>
                                <p className="text-sm text-muted">
                                    Full booking data is kept for <strong style={{ color: "var(--text-primary)" }}>30 days</strong>. Running cleanup removes older records. Monthly summary stats (if added) would be preserved regardless. Run cleanup regularly to keep the database lean.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}