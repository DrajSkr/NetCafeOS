import { useEffect, useState, useRef, useCallback } from "react";
import socket from "../socket";
import api from "../api";
import {
    Monitor, ShieldAlert, Crown, Zap, Footprints, ShoppingCart,
    Clock, Trash2, FileText, X, CheckCircle, AlertTriangle, Info, MessageSquare
} from "lucide-react";
import { GoogleLogin } from '@react-oauth/google';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// ─── Audio ───────────────────────────────────────────────────
const pewSound = new Audio('/pew.mp3');
pewSound.preload = 'auto';

// ─── Razorpay loader ─────────────────────────────────────────
const loadRazorpayScript = () =>
    new Promise((resolve) => {
        if (window.Razorpay) { resolve(true); return; }
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });

// ─── Time & Date Helpers ──────────────────────────────────────
const generateTimeSlots = () => {
    const slots = [];
    for (let i = 8; i <= 19; i++) {
        const hour = i.toString().padStart(2, '0');
        slots.push(`${hour}:00-${hour}:55`);
    }
    return slots;
};

const getTodayString = () => {
    const today = new Date();
    return new Date(today - today.getTimezoneOffset() * 60000)
        .toISOString().split('T')[0];
};

const getUpcomingDays = (numDays = 5) => {
    const today = new Date();
    return Array.from({ length: numDays }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        const value = new Date(d - d.getTimezoneOffset() * 60000)
            .toISOString().split('T')[0];
        const label = d.toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric'
        });
        return { value, label: `${value} (${label})` };
    });
};

const getValidTimeSlots = (selectedDateString) => {
    const allSlots = generateTimeSlots();
    if (selectedDateString !== getTodayString()) return allSlots;
    const currentHour = new Date().getHours();
    return allSlots.filter(slot => parseInt(slot.split(':')[0], 10) > currentHour);
};

// ─── Layout Generator ─────────────────────────────────────────
function generateCafeLayout() {
    const stations = [];

    const addTier = (tierName, prefix, rowStart, rowEnd, maxCount) => {
        let count = 1;
        for (let r = rowStart; r <= rowEnd && count <= maxCount; r++) {
            for (let c = 1; c <= 11 && count <= maxCount; c++) {
                if (c === 6) continue;
                const id = `${prefix}_${String(count).padStart(tierName === 'LUXURY' ? 2 : 3, "0")}`;
                stations.push({ id, status: "AVAILABLE", tier: tierName, row: r, col: c });
                count++;
            }
        }
    };

    addTier("ECONOMY",  "ECO", 1,  7,  70);
    addTier("STANDARD", "STD", 9,  13, 50);
    addTier("PRO",      "PRO", 15, 17, 30);
    addTier("LUXURY",   "LUX", 19, 19, 10);

    return stations;
}

// ─── Toast Hook ───────────────────────────────────────────────
function useToast() {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = "info") => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4500);
    }, []);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return { toasts, addToast, removeToast };
}

// ─── Toast Container ──────────────────────────────────────────
function ToastContainer({ toasts, onRemove }) {
    const icons = {
        success: <CheckCircle size={16} color="var(--color-success)" />,
        error:   <AlertTriangle size={16} color="var(--color-danger)" />,
        warning: <AlertTriangle size={16} color="var(--color-warning)" />,
        info:    <Info size={16} color="var(--accent)" />
    };

    return (
        <div className="toast-container" role="region" aria-label="Notifications" aria-live="polite">
            {toasts.map(toast => (
                <div key={toast.id} className={`toast toast--${toast.type}`} role="alert">
                    <span className="toast__icon">{icons[toast.type]}</span>
                    <span className="toast__text">{toast.message}</span>
                    <button
                        className="toast__close"
                        onClick={() => onRemove(toast.id)}
                        aria-label="Dismiss notification"
                    >×</button>
                </div>
            ))}
        </div>
    );
}

// ─── Seat Theme ───────────────────────────────────────────────
const TIER_META = {
    ECONOMY:  { cls: "seat-economy",  icon: <Monitor />,  color: "var(--tier-economy)" },
    STANDARD: { cls: "seat-standard", icon: <Monitor />,  color: "var(--tier-standard)" },
    PRO:      { cls: "seat-pro",      icon: <Zap />,      color: "var(--tier-pro)" },
    LUXURY:   { cls: "seat-luxury",   icon: <Crown />,    color: "var(--tier-luxury)" },
};

const MAX_CART_ITEMS = 10;
const upcomingDays = getUpcomingDays(5);

// ─── Main Component ───────────────────────────────────────────
export default function FloorMap() {
    // Core state
    const [stations, setStations] = useState(generateCafeLayout());
    const [cart, setCart] = useState([]);
    const [selectedDate, setSelectedDate] = useState(upcomingDays[0].value);
    const [activeTimeSlot, setActiveTimeSlot] = useState("");
    const [prices, setPrices] = useState({ ECONOMY: 50, STANDARD: 80, PRO: 120, LUXURY: 200 });
    const [showModal, setShowModal] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);

    // User & history state
    const [user, setUser] = useState(() => {
        try {
            const saved = localStorage.getItem("clientData");
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    });
    const [showHistory, setShowHistory] = useState(false);
    const [orderHistory, setOrderHistory] = useState([]);

    // Chat state
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState([
        { sender: "Buddy", text: "Hey! I'm Buddy 👋 How can I help you today?" }
    ]);
    const [chatInput, setChatInput] = useState("");
    const [isAITyping, setIsAITyping] = useState(false);
    const chatEndRef = useRef(null);

    // Toast
    const { toasts, addToast, removeToast } = useToast();

    // Derived state
    const validSlots = getValidTimeSlots(selectedDate);
    const cartTotal = cart.reduce((total, item) => total + item.price, 0);
    const getPrice = (tier) => Number(prices[tier]) || 80;

    // ── Refs for cleanup ────────────────────────────────────────
    const cartRef = useRef(cart);
    const modalRef = useRef(showModal);
    useEffect(() => { cartRef.current = cart; modalRef.current = showModal; }, [cart, showModal]);

    // ── Scroll chat to bottom ────────────────────────────────────
    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages, isAITyping, isChatOpen]);

    // ── Fetch pricing ────────────────────────────────────────────
    useEffect(() => {
        api.get("/api/pricing")
            .then(res => { if (res.data.success) setPrices(res.data.pricing); })
            .catch(err => console.error("Failed to fetch pricing:", err));
    }, []);

    // ── Auto-correct time slot when date changes ─────────────────
    useEffect(() => {
        if (validSlots.length > 0 && !validSlots.includes(activeTimeSlot)) {
            setActiveTimeSlot(validSlots[0]);
        } else if (validSlots.length === 0) {
            setActiveTimeSlot("");
        }
    }, [selectedDate, validSlots, activeTimeSlot]);

    // ── Fetch seat status for selected date/slot ─────────────────
    useEffect(() => {
        if (!activeTimeSlot) return;
        api.get(`/api/bookings/status?date=${selectedDate}&timeSlots=${activeTimeSlot}`)
            .then(res => {
                const bookedIds = res.data.bookedStations || [];
                const lockedIds = res.data.lockedStations || [];
                setStations(generateCafeLayout().map(pc => {
                    if (bookedIds.includes(pc.id)) return { ...pc, status: "BOOKED" };
                    if (lockedIds.includes(pc.id)) return { ...pc, status: "LOCKED" };
                    return pc;
                }));
            })
            .catch(err => console.error("Failed to fetch seat status:", err));
    }, [activeTimeSlot, selectedDate]);

    // ── Real-time socket updates ─────────────────────────────────
    useEffect(() => {
        const handleSocketUpdate = (data) => {
            if (!data.cartItems) return;
            setStations(prev =>
                prev.map(pc => {
                    const isAffected = data.cartItems.some(
                        item => item.seatId === pc.id &&
                                item.timeSlot === activeTimeSlot &&
                                item.date === selectedDate
                    );
                    if (isAffected) {
                        if (data.lockedBy !== socket.id && data.status === "LOCKED") {
                            setCart(curr => curr.filter(c =>
                                !(c.seatId === pc.id &&
                                  c.timeSlot === activeTimeSlot &&
                                  c.date === selectedDate)
                            ));
                        }
                        return { ...pc, status: data.status, lockedBy: data.lockedBy };
                    }
                    return pc;
                })
            );
        };
        socket.on("seats_locked_update", handleSocketUpdate);
        return () => socket.off("seats_locked_update", handleSocketUpdate);
    }, [activeTimeSlot, selectedDate]);

    // ── Cleanup locks on unmount ─────────────────────────────────
    useEffect(() => {
        return () => {
            if (modalRef.current && cartRef.current.length > 0) {
                socket.emit("unlock_seats", { cart: cartRef.current });
            }
        };
    }, []);

    // ─── Handlers ──────────────────────────────────────────────

    const handleSeatClick = (pc) => {
        if (!user) {
            addToast("Please sign in with Google to select seats.", "warning");
            return;
        }
        if (!activeTimeSlot) {
            addToast("Please select a time slot first.", "info");
            return;
        }
        if (pc.status !== "AVAILABLE") return;

        setCart(prevCart => {
            const key = item =>
                item.seatId === pc.id &&
                item.timeSlot === activeTimeSlot &&
                item.date === selectedDate;

            if (prevCart.some(key)) {
                return prevCart.filter(item => !key(item));
            }
            if (prevCart.length >= MAX_CART_ITEMS) {
                addToast(`Max ${MAX_CART_ITEMS} sessions per booking.`, "warning");
                return prevCart;
            }
            return [...prevCart, {
                seatId: pc.id,
                timeSlot: activeTimeSlot,
                date: selectedDate,
                price: getPrice(pc.tier),
                tier: pc.tier
            }];
        });
    };

    const handleCheckoutClick = () => {
        if (cart.length === 0) return;
        setIsProcessing(true);
        socket.emit("attempt_lock", { cart }, (response) => {
            setIsProcessing(false);
            if (response.success) {
                setShowModal(true);
            } else {
                const conflicted = response.conflict.map(c => `${c.seatId} @ ${c.timeSlot}`).join(", ");
                addToast(`Seats grabbed by another user: ${conflicted}`, "error");
                setCart(prev =>
                    prev.filter(item =>
                        !response.conflict.some(c =>
                            c.seatId === item.seatId &&
                            c.timeSlot === item.timeSlot &&
                            c.date === item.date
                        )
                    )
                );
            }
        });
    };

    const handleLoginSuccess = async (credentialResponse) => {
        try {
            const res = await api.post("/api/auth/google", {
                credential: credentialResponse.credential
            });
            if (res.data.success) {
                localStorage.setItem("clientToken", res.data.token);
                localStorage.setItem("clientData", JSON.stringify(res.data.user));
                setUser(res.data.user);
                addToast(`Welcome back, ${res.data.user.name}! 🎮`, "success");
            }
        } catch {
            addToast("Google login failed. Please try again.", "error");
        }
    };

    const handleLogout = () => {
        localStorage.removeItem("clientToken");
        localStorage.removeItem("clientData");
        setUser(null);
        setCart([]);
        addToast("Signed out successfully.", "info");
    };

    const fetchOrderHistory = async () => {
        try {
            const res = await api.get("/api/bookings/my-history");
            if (res.data.success) {
                setOrderHistory(res.data.bookings);
                setShowHistory(true);
            }
        } catch {
            addToast("Failed to load order history. Please sign in again.", "error");
        }
    };

    const handleSendMessage = async () => {
        if (!chatInput.trim()) return;
        const text = chatInput.trim();
        setChatMessages(prev => [...prev, { sender: "user", text }]);
        setChatInput("");
        setIsAITyping(true);
        try {
            const res = await api.post("/api/chat/ask", { 
                message: text,
                history: chatMessages.map(msg => ({
                    role: msg.sender === "user" ? "user" : "assistant",
                    content: msg.text
                }))
            });
            if (res.data.reply) {
                pewSound.currentTime = 0;
                pewSound.play().catch(() => {});
                setChatMessages(prev => [...prev, { sender: "Buddy", text: res.data.reply }]);
            } else {
                throw new Error("Empty reply");
            }
        } catch {
            setChatMessages(prev => [
                ...prev,
                { sender: "Buddy", text: "I'm having trouble connecting right now. Please ask the front desk." }
            ]);
        } finally {
            setIsAITyping(false);
        }
    };

    const generateTicketPDF = async (bookingId, cartItems, totalPaid) => {
        const { renderToStaticMarkup } = await import('react-dom/server');

        const qrSVG = renderToStaticMarkup(
            <QRCodeSVG value={`VERIFY_BOOKING:${bookingId}`} size={128} />
        );

        const itemsHTML = cartItems.map(item =>
            `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;">
                <span style="font-weight:bold;color:#0d1117">${item.seatId}</span>
                <span style="color:#555">${item.date} @ ${item.timeSlot}</span>
            </div>`
        ).join('');

        const ticketDiv = document.createElement('div');
        ticketDiv.style.cssText = [
            'width:420px', 'padding:28px', 'background:#ffffff', 'color:#0d1117',
            'font-family:system-ui,sans-serif', 'position:absolute', 'left:-9999px'
        ].join(';');
        ticketDiv.innerHTML = `
            <div style="text-align:center;margin-bottom:16px;">
                <h1 style="color:#00d4ff;font-size:28px;margin:0;font-weight:900;letter-spacing:-1px">NetCafe<span style="color:#0d1117">OS</span></h1>
                <p style="color:#888;font-size:12px;margin:4px 0 0">Gaming Seat Reservation</p>
            </div>
            <div style="background:#f5f5f5;border-radius:8px;padding:8px 12px;margin-bottom:16px;">
                <p style="margin:0;font-size:11px;color:#666;font-family:monospace">BOOKING ID: ${bookingId}</p>
            </div>
            <div style="margin-bottom:16px">${itemsHTML}</div>
            <div style="display:flex;justify-content:space-between;font-size:20px;font-weight:bold;padding-top:10px;border-top:2px solid #0d1117">
                <span>Total Paid</span><span style="color:#3fb950">₹${totalPaid}</span>
            </div>
            <div style="text-align:center;margin-top:24px;">${qrSVG}</div>
            <p style="text-align:center;font-size:10px;color:#999;margin-top:8px">Scan at front desk to verify</p>
        `;
        document.body.appendChild(ticketDiv);
        try {
            const canvas = await html2canvas(ticketDiv, { scale: 2, backgroundColor: '#ffffff' });
            const pdf = new jsPDF('p', 'mm', 'a5');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
            pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfWidth, pdfHeight);
            pdf.save(`NetCafe_Ticket_${bookingId.slice(-6)}.pdf`);
        } finally {
            document.body.removeChild(ticketDiv);
        }
    };

    const initiatePayment = async () => {
        setIsProcessing(true);
        const loaded = await loadRazorpayScript();
        if (!loaded) {
            addToast("Payment SDK failed to load. Check your connection.", "error");
            setIsProcessing(false);
            return;
        }
        try {
            const orderRes = await api.post("/api/bookings/create-order", { cart });
            if (!orderRes.data.success) throw new Error("Order creation failed");

            const { order, finalTotal } = orderRes.data;

            const options = {
                key: import.meta.env.VITE_RAZORPAY_KEY_ID,
                amount: order.amount,
                currency: "INR",
                name: "NetCafeOS",
                description: "Gaming Seat Reservation",
                order_id: order.id,
                handler: async (response) => {
                    try {
                        const verifyRes = await api.post("/api/bookings/verify", {
                            ...response,
                            cart,
                            userId: user?.email || "GUEST",
                            finalTotal
                        });
                        if (verifyRes.data.success) {
                            addToast("Payment successful! Generating your ticket…", "success");
                            generateTicketPDF(verifyRes.data.bookingId, cart, finalTotal);
                            setCart([]);
                            setShowModal(false);
                        }
                    } catch {
                        addToast("Payment verification failed at server.", "error");
                    }
                },
                prefill: {
                    name: user?.name || "Guest Player",
                    email: user?.email || "guest@example.com",
                },
                theme: { color: "#00d4ff" }
            };

            const rzp = new window.Razorpay(options);
            rzp.open();
            rzp.on('payment.failed', (res) => {
                addToast(`Payment failed: ${res.error.description}`, "error");
            });
        } catch (err) {
            console.error(err);
            addToast("Checkout initialization failed. Please try again.", "error");
        } finally {
            setIsProcessing(false);
        }
    };

    const cancelCheckout = () => {
        socket.emit("unlock_seats", { cart });
        setCart([]);
        setShowModal(false);
    };

    const removeSeatFromCart = (item) => {
        setCart(prev => prev.filter(i =>
            !(i.seatId === item.seatId &&
              i.timeSlot === item.timeSlot &&
              i.date === item.date)
        ));
    };

    // ── Seat rendering logic ────────────────────────────────────

    const getSeatClass = (pc, isSelected) => {
        if (isSelected) return "seat-card seat-selected";
        if (pc.status === "LOCKED")  return "seat-card seat-locked seat-card--unavailable";
        if (pc.status === "BOOKED")  return "seat-card seat-booked seat-card--unavailable";
        return `seat-card ${TIER_META[pc.tier]?.cls || ""}`;
    };

    const getSeatColor = (pc, isSelected) => {
        if (isSelected) return "var(--accent)";
        if (pc.status === "LOCKED") return "var(--color-warning)";
        if (pc.status === "BOOKED") return "var(--color-danger)";
        return TIER_META[pc.tier]?.color || "var(--text-secondary)";
    };

    const getSeatLabel = (pc, isSelected) => {
        if (isSelected) return "Selected";
        if (pc.status === "LOCKED") return "Locked";
        if (pc.status === "BOOKED") return "Occupied";
        return `₹${getPrice(pc.tier)}/hr`;
    };

    const rowsWithAisle = [1,2,3,4,5,6,7,9,10,11,12,13,15,16,17,19];

    // ─── JSX ─────────────────────────────────────────────────────
    return (
        <div
            className={`page-content${cart.length > 0 && !showModal ? " page-content--padded-bottom" : ""}`}
            style={{ minHeight: "100vh" }}
        >
            <ToastContainer toasts={toasts} onRemove={removeToast} />

            {/* ── Header ── */}
            <header style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "1.5rem",
                flexWrap: "wrap",
                gap: "1rem"
            }}>
                <div>
                    <h1 style={{ fontSize: "clamp(1.4rem, 3vw, 2.2rem)", fontWeight: 900, letterSpacing: "-1px", margin: 0 }}>
                        Reserve Your <span style={{ color: "var(--accent)" }}>Station</span>
                    </h1>
                    <p className="text-sm text-muted" style={{ marginTop: "4px" }}>
                        Select a date, time, and seat — pay instantly.
                    </p>
                </div>
                <div>
                    {user ? (
                        <div className="user-badge">
                            <div className="user-badge__info">
                                <div className="user-badge__name">{user.name}</div>
                                <button
                                    className="user-badge__history"
                                    onClick={fetchOrderHistory}
                                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                                >
                                    View Order History
                                </button>
                            </div>
                            <button className="btn btn-danger" onClick={handleLogout}>
                                Sign Out
                            </button>
                        </div>
                    ) : (
                        <GoogleLogin
                            onSuccess={handleLoginSuccess}
                            onError={() => addToast("Google login failed.", "error")}
                        />
                    )}
                </div>
            </header>

            {/* ── Date & Time Controls ── */}
            <div className="booking-controls">
                <div className="control-group">
                    <label htmlFor="date-select">Date</label>
                    <select
                        id="date-select"
                        className="form-select"
                        value={selectedDate}
                        onChange={(e) => {
                            setSelectedDate(e.target.value);
                            setCart([]);
                        }}
                    >
                        {upcomingDays.map(day => (
                            <option key={day.value} value={day.value}>{day.label}</option>
                        ))}
                    </select>
                </div>

                <div className="control-group">
                    <label htmlFor="time-select">Time Slot</label>
                    <select
                        id="time-select"
                        className="form-select"
                        value={activeTimeSlot}
                        onChange={(e) => setActiveTimeSlot(e.target.value)}
                        disabled={validSlots.length === 0}
                    >
                        {validSlots.length > 0 ? (
                            validSlots.map(slot => (
                                <option key={slot} value={slot}>{slot}</option>
                            ))
                        ) : (
                            <option value="">Closed for today</option>
                        )}
                    </select>
                </div>
            </div>

            {/* ── Tier Legend ── */}
            <div className="tier-legend" role="list" aria-label="Seat tier legend">
                {[
                    { cls: "tier-badge--economy",  label: "Economy",  price: `₹${getPrice("ECONOMY")}` },
                    { cls: "tier-badge--standard", label: "Standard", price: `₹${getPrice("STANDARD")}` },
                    { cls: "tier-badge--pro",      label: "Pro",      price: `₹${getPrice("PRO")}` },
                    { cls: "tier-badge--luxury",   label: "Luxury",   price: `₹${getPrice("LUXURY")}` },
                    { cls: "tier-badge--locked",   label: "Checking out", price: null },
                    { cls: "tier-badge--occupied", label: "Occupied",     price: null },
                ].map(({ cls, label, price }) => (
                    <span key={label} className={`tier-badge ${cls}`} role="listitem">
                        {label}{price ? ` — ${price}/hr` : ""}
                    </span>
                ))}
            </div>

            {/* ── Floor Map ── */}
            <div className="floor-container" role="main" aria-label="Café floor plan">
                <div className="seat-grid">
                    {/* Aisle indicators */}
                    {rowsWithAisle.map(r => (
                        <div
                            key={`aisle-${r}`}
                            className="aisle-indicator"
                            style={{ gridRowStart: r, gridColumnStart: 6 }}
                            aria-hidden="true"
                        >
                            <Footprints size="clamp(12px, 1.3vw, 20px)" />
                        </div>
                    ))}

                    {/* Seat cards */}
                    {stations.map(pc => {
                        const isSelected = cart.some(
                            item => item.seatId === pc.id &&
                                    item.timeSlot === activeTimeSlot &&
                                    item.date === selectedDate
                        );
                        const isAvailable = pc.status === "AVAILABLE";
                        const seatColor = getSeatColor(pc, isSelected);
                        const label = getSeatLabel(pc, isSelected);

                        return (
                            <div
                                key={pc.id}
                                role="button"
                                tabIndex={isAvailable ? 0 : -1}
                                aria-label={`${pc.id} — ${label}`}
                                aria-pressed={isSelected}
                                aria-disabled={!isAvailable}
                                className={getSeatClass(pc, isSelected)}
                                style={{
                                    gridRowStart: pc.row,
                                    gridColumnStart: pc.col,
                                    cursor: isAvailable ? "pointer" : "not-allowed",
                                }}
                                onClick={() => handleSeatClick(pc)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        handleSeatClick(pc);
                                    }
                                }}
                            >
                                <div className="seat-card__icon" style={{ color: seatColor }}>
                                    {TIER_META[pc.tier]?.icon || <Monitor />}
                                </div>
                                <div className="seat-card__id" style={{ color: seatColor }}>
                                    {pc.id}
                                </div>
                                <div className="seat-card__label" style={{ color: seatColor }}>
                                    {label}
                                </div>
                                {pc.status === "LOCKED" && !isSelected && (
                                    <span className="seat-card__badge" aria-hidden="true">
                                        <ShieldAlert size={10} color="var(--color-warning)" />
                                    </span>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Cart Bar ── */}
            {cart.length > 0 && !showModal && (
                <div className="cart-bar" role="region" aria-label="Shopping cart">
                    <div className="cart-bar__info">
                        <div className="cart-bar__title">
                            <ShoppingCart size={18} color="var(--accent)" />
                            Cart ({cart.length} / {MAX_CART_ITEMS})
                        </div>
                        <div className="cart-bar__items">
                            {cart.map((item, idx) => (
                                <div key={idx} className="cart-chip">
                                    <span className="cart-chip__seat">{item.seatId}</span>
                                    <span className="text-muted text-xs">@ {item.timeSlot}</span>
                                    <button
                                        className="cart-chip__remove"
                                        onClick={() => removeSeatFromCart(item)}
                                        aria-label={`Remove ${item.seatId}`}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="cart-bar__total">
                        <div className="cart-bar__total-label">Total</div>
                        <div className="cart-bar__total-value">₹{cartTotal}</div>
                    </div>
                    <button
                        className="btn btn-primary btn-lg"
                        onClick={handleCheckoutClick}
                        disabled={isProcessing}
                    >
                        {isProcessing ? "Locking seats…" : "Review & Checkout"}
                    </button>
                </div>
            )}

            {/* ── Checkout Confirm Modal ── */}
            {showModal && (
                <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
                    <div className="modal">
                        <div className="modal__header">
                            <span className="modal__title" id="checkout-title">
                                <ShoppingCart size={20} color="var(--accent)" />
                                Confirm Booking
                            </span>
                            <button className="modal__close" onClick={cancelCheckout} aria-label="Cancel and close">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal__body">
                            {cart.map((item, idx) => (
                                <div key={idx} className="booking-item">
                                    <div>
                                        <div className="booking-item__seat">{item.seatId}</div>
                                        <div className="booking-item__details">{item.date} · {item.timeSlot}</div>
                                    </div>
                                    <div className="booking-item__price">₹{item.price}</div>
                                </div>
                            ))}
                            <div className="booking-total">
                                <span className="booking-total__label">Total</span>
                                <span className="booking-total__value">₹{cartTotal}</span>
                            </div>
                        </div>
                        <div className="modal__footer">
                            <button
                                className="btn btn-danger"
                                onClick={cancelCheckout}
                                disabled={isProcessing}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-success btn-lg"
                                onClick={initiatePayment}
                                disabled={isProcessing}
                            >
                                {isProcessing ? "Processing…" : "Pay Now"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Order History Modal ── */}
            {showHistory && (
                <div
                    className="modal-backdrop"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="history-title"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowHistory(false); }}
                >
                    <div className="modal modal--wide">
                        <div className="modal__header">
                            <span className="modal__title" id="history-title">
                                <Clock size={20} color="var(--accent)" />
                                Order History
                            </span>
                            <button className="modal__close" onClick={() => setShowHistory(false)} aria-label="Close history">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal__body">
                            {orderHistory.length === 0 ? (
                                <p className="text-muted" style={{ textAlign: "center", padding: "2rem 0" }}>
                                    No past bookings found.
                                </p>
                            ) : (
                                orderHistory.map(booking => (
                                    <div key={booking._id} className="history-card">
                                        <div className="history-card__header">
                                            <span className="booking-id">
                                                #{booking._id.slice(-6).toUpperCase()}
                                            </span>
                                            <span className="text-success font-bold" style={{ fontSize: "1.1rem" }}>
                                                ₹{booking.totalPrice}
                                            </span>
                                        </div>
                                        <div className="history-card__date">
                                            Booked on: {new Date(booking.date).toLocaleDateString('en-IN', {
                                                day: 'numeric', month: 'short', year: 'numeric',
                                                hour: '2-digit', minute: '2-digit'
                                            })}
                                        </div>
                                        <div className="history-card__seats">
                                            {booking.items.map((item, idx) => (
                                                <span key={idx} className="cart-chip">
                                                    <span className="cart-chip__seat">{item.seatId}</span>
                                                    <span className="text-muted text-xs">@ {item.date} {item.timeSlot}</span>
                                                </span>
                                            ))}
                                        </div>
                                        <button
                                            className="btn btn-ghost w-full"
                                            onClick={() => generateTicketPDF(booking._id, booking.items, booking.totalPrice)}
                                        >
                                            <FileText size={16} />
                                            Download Ticket PDF
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Chat Widget ── */}
            <div className="chat-widget">
                {isChatOpen && (
                    <div className="chat-window" role="dialog" aria-label="Buddy AI Support">
                        <div className="chat-header">
                            <div className="chat-header__info">
                                <div className="chat-header__avatar" aria-hidden="true">
                                    <Zap size={16} />
                                </div>
                                <div>
                                    <div className="chat-header__name">Buddy</div>
                                    <div className="chat-header__status">Online</div>
                                </div>
                            </div>
                            <button
                                className="modal__close"
                                onClick={() => setIsChatOpen(false)}
                                aria-label="Close chat"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div
                            className="chat-messages"
                            role="log"
                            aria-label="Chat messages"
                            aria-live="polite"
                        >
                            {chatMessages.map((msg, i) => (
                                <div
                                    key={i}
                                    className={`chat-bubble chat-bubble--${msg.sender === "user" ? "user" : "bot"}`}
                                >
                                    {msg.text}
                                </div>
                            ))}
                            {isAITyping && (
                                <div className="chat-typing" aria-label="Buddy is typing">
                                    <div className="chat-typing__dot" />
                                    <div className="chat-typing__dot" />
                                    <div className="chat-typing__dot" />
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>

                        <div className="chat-input-area">
                            <input
                                type="text"
                                className="chat-input"
                                value={chatInput}
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                                placeholder="Ask Buddy…"
                                aria-label="Type a message"
                                disabled={isAITyping}
                            />
                            <button
                                className="btn btn-primary"
                                onClick={handleSendMessage}
                                disabled={isAITyping || !chatInput.trim()}
                                aria-label="Send message"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                )}

                <button
                    className="chat-fab"
                    onClick={() => setIsChatOpen(!isChatOpen)}
                    aria-label={isChatOpen ? "Close chat" : "Open AI support chat"}
                    aria-expanded={isChatOpen}
                >
                    {isChatOpen ? <X size={22} /> : <MessageSquare size={22} />}
                </button>
            </div>
        </div>
    );
}