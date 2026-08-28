import { useEffect, useState, useRef } from "react";
import socket from "../socket";
import { Monitor, ShieldAlert, Crown, Zap, Footprints, ShoppingCart, Clock, Trash2, FileText } from "lucide-react";
import axios from "axios";
import { GoogleLogin } from '@react-oauth/google';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

// Preload the audio globally to prevent delay
const pewSound = new Audio('/pew.mp3');
pewSound.preload = 'auto';

const loadRazorpayScript = () => {
    return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = "https://checkout.razorpay.com/v1/checkout.js";
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
};

const generateTimeSlots = () => {
    const slots = [];
    for (let i = 8; i <= 19; i++) {
        const hour = i.toString().padStart(2, '0');
        slots.push(`${hour}:00-${hour}:55`);
    }
    return slots;
};
const availableSlots = generateTimeSlots();

// Generate YYYY-MM-DD for today
const getTodayString = () => {
    const today = new Date();
    const tzOffset = today.getTimezoneOffset() * 60000;
    return new Date(today - tzOffset).toISOString().split('T')[0];
};

// Generate an array of the next 5 days with readable labels
const getUpcomingDays = (numDays = 5) => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < numDays; i++) {
        const nextDate = new Date(today);
        nextDate.setDate(today.getDate() + i);
        
        // Handle timezone offset for strict YYYY-MM-DD string
        const tzOffset = nextDate.getTimezoneOffset() * 60000;
        const isoString = new Date(nextDate - tzOffset).toISOString().split('T')[0];
        
        // Create the display label: e.g. "Aug 27 (Thu)"
        const label = nextDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        
        days.push({ value: isoString, label: `${isoString} (${label})` });
    }
    return days;
};
const upcomingDays = getUpcomingDays(5);

// Filter past times out if the user is viewing 'today'
const getValidTimeSlots = (selectedDateString) => {
    const allSlots = generateTimeSlots();
    if (selectedDateString !== getTodayString()) {
        return allSlots; // Future dates get all slots
    }
    const currentHour = new Date().getHours();
    return allSlots.filter(slot => {
        const slotStartHour = parseInt(slot.split(':')[0], 10);
        return slotStartHour > currentHour; // Must be strictly greater than current hour
    });
};

function generateCafeLayout() {
    const stations = [];
    let ecoCount = 1;
    for (let r = 1; r <= 7; r++) {
        for (let c = 1; c <= 11; c++) {
            if (c === 6) continue;
            if (ecoCount <= 70) {
                stations.push({ id: `ECO_${String(ecoCount).padStart(3, "0")}`, status: "AVAILABLE", tier: "ECONOMY", row: r, col: c });
                ecoCount++;
            }
        }
    }
    let stdCount = 1;
    for (let r = 9; r <= 13; r++) {
        for (let c = 1; c <= 11; c++) {
            if (c === 6) continue;
            if (stdCount <= 50) {
                stations.push({ id: `STD_${String(stdCount).padStart(3, "0")}`, status: "AVAILABLE", tier: "STANDARD", row: r, col: c });
                stdCount++;
            }
        }
    }
    let proCount = 1;
    for (let r = 15; r <= 17; r++) {
        for (let c = 1; c <= 11; c++) {
            if (c === 6) continue;
            if (proCount <= 30) {
                stations.push({ id: `PRO_${String(proCount).padStart(3, "0")}`, status: "AVAILABLE", tier: "PRO", row: r, col: c });
                proCount++;
            }
        }
    }
    let luxCount = 1;
    for (let r = 19; r <= 19; r++) {
        for (let c = 1; c <= 11; c++) {
            if (c === 6) continue;
            if (luxCount <= 10) {
                stations.push({ id: `LUX_${String(luxCount).padStart(2, "0")}`, status: "AVAILABLE", tier: "LUXURY", row: r, col: c });
                luxCount++;
            }
        }
    }
    return stations;
}

const MAX_CART_ITEMS = 10;

export default function FloorMap() {
    // 1. Core State
    const [stations, setStations] = useState(generateCafeLayout());
    const [cart, setCart] = useState([]); 
    const [selectedDate, setSelectedDate] = useState(upcomingDays[0].value);
    const [activeTimeSlot, setActiveTimeSlot] = useState(""); 
    const [prices, setPrices] = useState({ ECONOMY: 50, STANDARD: 80, PRO: 120, LUXURY: 200 });
    const [showModal, setShowModal] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    
    // 2. User & History State
    const [user, setUser] = useState(() => {
        const savedUser = localStorage.getItem("clientData");
        return savedUser ? JSON.parse(savedUser) : null;
    });
    const [showHistory, setShowHistory] = useState(false);
    const [orderHistory, setOrderHistory] = useState([]);

    // 3. AI Chat State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [chatMessages, setChatMessages] = useState([{ sender: "Buddy", text: "Hello! I am your buddy. How can I help you today?" }]);
    const [chatInput, setChatInput] = useState("");
    const [isAITyping, setIsAITyping] = useState(false);
    const chatEndRef = useRef(null);

    // Dynamic Valid Slots
    const validSlots = getValidTimeSlots(selectedDate);

    // --- HOOKS ---
    useEffect(() => {
        if (chatEndRef.current) {
            chatEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [chatMessages, isAITyping, isChatOpen]);

    useEffect(() => {
        axios.get("http://localhost:5000/api/pricing")
            .then((res) => { if (res.data.success) setPrices(res.data.pricing); })
            .catch((err) => console.error("Failed to fetch pricing:", err));
    }, []);

    // AUTO-CORRECT TIME SLOT: Forces dropdown to a valid time if the user switches to 'today'
    useEffect(() => {
        if (validSlots.length > 0 && !validSlots.includes(activeTimeSlot)) {
            setActiveTimeSlot(validSlots[0]);
        } else if (validSlots.length === 0) {
            setActiveTimeSlot(""); // No slots left today
        }
    }, [selectedDate, validSlots, activeTimeSlot]);

    useEffect(() => {
        if (!activeTimeSlot) return; // Don't query if the cafe is closed for the day
        
        axios.get(`http://localhost:5000/api/bookings/status?date=${selectedDate}&timeSlots=${activeTimeSlot}`)
            .then((res) => {
                const bookedIds = res.data.bookedStations || [];
                const lockedIds = res.data.lockedStations || [];
                
                setStations(generateCafeLayout().map(pc => {
                    // Paint permanent database bookings RED
                    if (bookedIds.includes(pc.id)) {
                        return { ...pc, status: "BOOKED" };
                    }
                    // Paint temporary Redis checkouts YELLOW
                    if (lockedIds.includes(pc.id)) {
                        return { ...pc, status: "LOCKED" };
                    }
                    // Otherwise, leave it AVAILABLE
                    return { ...pc, status: "AVAILABLE" };
                }));
            })
            .catch((err) => console.error("Failed to fetch status:", err));
    }, [activeTimeSlot, selectedDate]);

    useEffect(() => {
        const handleSocketUpdate = (data) => {
            if (!data.cartItems) return;
            setStations((prevStations) => 
                prevStations.map((pc) => {
                    const isAffected = data.cartItems.some(
                        item => item.seatId === pc.id && item.timeSlot === activeTimeSlot && item.date === selectedDate
                    );
                    if (isAffected) {
                        if (data.lockedBy !== socket.id && data.status === "LOCKED") {
                            setCart(currentCart => currentCart.filter(c => !(c.seatId === pc.id && c.timeSlot === activeTimeSlot && c.date === selectedDate)));
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

    const cartRef = useRef(cart);
    const modalRef = useRef(showModal);

    useEffect(() => {
        cartRef.current = cart;
        modalRef.current = showModal;
    }, [cart, showModal]);

    useEffect(() => {
        return () => {
            if (modalRef.current && cartRef.current.length > 0) {
                socket.emit("unlock_seats", { cart: cartRef.current });
                console.log("Component destroyed: Released Redis locks.");
            }
        };
    }, []);

    // --- HANDLERS ---
    const getPrice = (tier) => Number(prices[tier]) || 80;

    const handleSeatClick = (pc) => {
        if (!user) {
            alert("Access Denied: You must sign in with Google before selecting seats.");
            return;
        }
        if (pc.status !== "AVAILABLE") return;

        setCart((prevCart) => {
            const isAlreadyInCart = prevCart.some(item => item.seatId === pc.id && item.timeSlot === activeTimeSlot && item.date === selectedDate);
            if (isAlreadyInCart) {
                return prevCart.filter(item => !(item.seatId === pc.id && item.timeSlot === activeTimeSlot && item.date === selectedDate));
            } else {
                if (prevCart.length >= MAX_CART_ITEMS) {
                    alert(`You can only book a maximum of ${MAX_CART_ITEMS} sessions at once.`);
                    return prevCart;
                }
                return [...prevCart, { seatId: pc.id, timeSlot: activeTimeSlot, date: selectedDate, price: getPrice(pc.tier), tier: pc.tier }];
            }
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
                alert(`Too slow! These seats were grabbed: ${response.conflict.map(c => `${c.seatId} at ${c.timeSlot}`).join(", ")}`);
                setCart(prev => prev.filter(item => !response.conflict.some(c => c.seatId === item.seatId && c.timeSlot === item.timeSlot && c.date === item.date)));
            }
        });
    };

    const handleLoginSuccess = async (credentialResponse) => {
        try {
            const res = await axios.post("http://localhost:5000/api/auth/google", { credential: credentialResponse.credential });
            if (res.data.success) {
                localStorage.setItem("clientToken", res.data.token);
                localStorage.setItem("clientData", JSON.stringify(res.data.user));
                setUser(res.data.user);
            }
        } catch (error) {
            alert("Login failed");
        }
    };

    const handleLogout = () => {
        localStorage.removeItem("clientToken");
        localStorage.removeItem("clientData");
        setUser(null);
        setCart([]);
    };

    const fetchOrderHistory = async () => {
        try {
            const token = localStorage.getItem("clientToken");
            const res = await axios.get("http://localhost:5000/api/bookings/my-history", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (res.data.success) {
                setOrderHistory(res.data.bookings);
                setShowHistory(true);
            }
        } catch (error) {
            alert("Failed to load order history. Please log in again.");
        }
    };

    const handleSendMessage = async () => {
        if (!chatInput.trim()) return;
        
        const newMsg = { sender: "user", text: chatInput };
        setChatMessages(prev => [...prev, newMsg]);
        setChatInput("");
        setIsAITyping(true);

        try {
            const res = await axios.post("http://localhost:5000/api/chat/ask", { message: newMsg.text });
            if (res.data.reply) {
                pewSound.currentTime = 0; 
                pewSound.play().catch(e => console.log("Browser blocked audio playback"));
                setChatMessages(prev => [...prev, { sender: "Buddy", text: res.data.reply }]);
            } else {
                throw new Error("Invalid response format");
            }
        } catch (error) {
            console.error(error);
            setChatMessages(prev => [...prev, { sender: "Buddy", text: "Error connecting to Buddy..." }]);
        } finally {
            setIsAITyping(false);
        }
    };

    const generateTicketPDF = async (bookingId, cartItems, totalPaid) => {
        const ticketDiv = document.createElement('div');
        ticketDiv.id = 'print-ticket';
        ticketDiv.style.width = '400px';
        ticketDiv.style.padding = '20px';
        ticketDiv.style.backgroundColor = '#ffffff';
        ticketDiv.style.color = '#000000';
        ticketDiv.style.fontFamily = 'sans-serif';
        ticketDiv.style.position = 'absolute';
        ticketDiv.style.left = '-9999px';

        let itemsHTML = cartItems.map(item => 
            `<div style="display:flex; justify-content:space-between; border-bottom:1px solid #ccc; padding:5px 0;">
                <span>${item.seatId}</span>
                <span>${item.date} @ ${item.timeSlot}</span>
            </div>`
        ).join('');

        ticketDiv.innerHTML = `
            <h1 style="text-align:center; color:#3b82f6;">NetCafeOS Pass</h1>
            <p style="text-align:center; font-size:12px; color:#666;">Booking ID: ${bookingId}</p>
            <hr/>
            <div style="margin:20px 0;">${itemsHTML}</div>
            <h3 style="text-align:right;">Total: ₹${totalPaid}</h3>
            <div id="qr-container" style="text-align:center; margin-top:30px;"></div>
        `;

        document.body.appendChild(ticketDiv);

        import('react-dom/client').then(({ createRoot }) => {
            const qrContainer = document.getElementById('qr-container');
            const root = createRoot(qrContainer);
            root.render(<QRCodeSVG value={`VERIFY_BOOKING:${bookingId}`} size={128} />);
            
            setTimeout(async () => {
                const canvas = await html2canvas(ticketDiv, { scale: 2 });
                const imgData = canvas.toDataURL('image/png');
                const pdf = new jsPDF('p', 'mm', 'a5');
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                
                pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
                pdf.save(`NetCafe_Ticket_${bookingId.slice(-6)}.pdf`);
                
                document.body.removeChild(ticketDiv);
            }, 500);
        });
    };

    const initiatePayment = async () => {
        setIsProcessing(true);
        const res = await loadRazorpayScript();
        if (!res) {
            alert("Razorpay SDK failed to load. Are you online?");
            setIsProcessing(false);
            return;
        }

        try {
            const orderRes = await axios.post("http://localhost:5000/api/bookings/create-order", { cart });
            if (!orderRes.data.success) throw new Error("Order creation failed");

            const { order, finalTotal } = orderRes.data;

            const options = {
                key: import.meta.env.VITE_RAZORPAY_KEY_ID, 
                amount: order.amount,
                currency: "INR",
                name: "NetCafeOS",
                description: "Gaming Seat Reservation",
                order_id: order.id,
                handler: async function (response) {
                    try {
                        const verifyRes = await axios.post("http://localhost:5000/api/bookings/verify", {
                            ...response,
                            cart,
                            userId: user ? user.email : "GUEST",
                            finalTotal
                        });

                        if (verifyRes.data.success) {
                            alert("Payment Successful! Generating Ticket...");
                            generateTicketPDF(verifyRes.data.bookingId, cart, finalTotal);
                            setCart([]);
                            setShowModal(false);
                        }
                    } catch (err) {
                        alert("Payment verification failed at server.");
                    }
                },
                prefill: {
                    name: user ? user.name : "Guest Player",
                    email: user ? user.email : "guest@example.com",
                },
                theme: { color: "#3b82f6" }
            };

            const paymentObject = new window.Razorpay(options);
            paymentObject.open();
            
            paymentObject.on('payment.failed', function (response) {
                alert("Payment Failed. Reason: " + response.error.description);
            });
        } catch (error) {
            console.error(error);
            alert("Checkout initialization failed.");
        } finally {
            setIsProcessing(false);
        }
    };

    const cancelCheckout = () => {
        socket.emit("unlock_seats", { cart });
        setCart([]);
        setShowModal(false);
    };

    const getTheme = (status, tier, isSelected) => {
        if (isSelected) return { border: "#0ea5e9", bg: "#0284c7", icon: "#ffffff", text: "Selected" };
        if (status === "LOCKED") return { border: "#eab308", bg: "#422006", icon: "#eab308", text: "Locked" };
        if (status === "BOOKED") return { border: "#ef4444", bg: "#450a0a", icon: "#ef4444", text: "Occupied" };
        const priceText = `₹${getPrice(tier)}/hr`;
        switch (tier) {
            case "ECONOMY": return { border: "#3b82f6", bg: "#172554", icon: "#3b82f6", text: priceText };
            case "STANDARD": return { border: "#22c55e", bg: "#052e16", icon: "#22c55e", text: priceText };
            case "PRO": return { border: "#a855f7", bg: "#2e1065", icon: "#a855f7", text: priceText };
            case "LUXURY": return { border: "#f59e0b", bg: "#451a03", icon: "#f59e0b", text: priceText };
            default: return { border: "#64748b", bg: "#1e293b", icon: "#64748b", text: priceText };
        }
    };

    const rowsWithAisle = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 17, 19];
    const cartTotal = cart.reduce((total, item) => total + item.price, 0);

    return (
        <div style={{ minHeight: "100vh", backgroundColor: "#0f1115", color: "#f8fafc", padding: "2vw", fontFamily: "system-ui, sans-serif", paddingBottom: cart.length > 0 ? "100px" : "2vw" }}>
            
            <header style={{ marginBottom: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 2.5rem)", margin: 0, fontWeight: "900", letterSpacing: "-1px" }}>
                    NetCafe<span style={{ color: "#3b82f6" }}>OS</span>
                </h1>
                <div>
                    {user ? (
                        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                            <div style={{ textAlign: "right" }}>
                                <div style={{ fontWeight: "bold", fontSize: "0.9rem" }}>{user.name}</div>
                                <div onClick={fetchOrderHistory} style={{ color: "#3b82f6", fontSize: "0.8rem", cursor: "pointer", textDecoration: "underline" }}>
                                    View Order History
                                </div>
                            </div>
                            <button onClick={handleLogout} style={{ padding: "8px 16px", backgroundColor: "transparent", border: "1px solid #ef4444", color: "#ef4444", borderRadius: "6px", cursor: "pointer" }}>
                                Sign Out
                            </button>
                        </div>
                    ) : (
                        <GoogleLogin onSuccess={handleLoginSuccess} onError={() => alert('Login Failed')} />
                    )}
                </div>
            </header>

            <div style={{ textAlign: "center", marginBottom: "2rem", display: "flex", justifyContent: "center", gap: "20px", flexWrap: "wrap" }}>
                <div>
                    <label style={{ marginRight: "10px", fontWeight: "bold", color: "#94a3b8" }}>Select Date: </label>
                    <select 
                        value={selectedDate}
                        onChange={(e) => {
                            setSelectedDate(e.target.value);
                            setCart([]); // Nuke the cart if date changes to avoid ghost locks
                        }}
                        style={{ padding: "10px 15px", borderRadius: "8px", backgroundColor: "#1e293b", color: "white", border: "2px solid #3b82f6", cursor: "pointer", fontSize: "1rem", fontWeight: "bold" }}
                    >
                        {upcomingDays.map(day => (
                            <option key={day.value} value={day.value}>{day.label}</option>
                        ))}
                    </select>
                </div>
                
                <div>
                    <label style={{ marginRight: "10px", fontWeight: "bold", color: "#94a3b8" }}>Select Time: </label>
                    <select 
                        value={activeTimeSlot} 
                        onChange={(e) => setActiveTimeSlot(e.target.value)}
                        disabled={validSlots.length === 0}
                        style={{ padding: "10px 15px", borderRadius: "8px", backgroundColor: "#1e293b", color: "white", border: "2px solid #3b82f6", cursor: validSlots.length === 0 ? "not-allowed" : "pointer", fontSize: "1rem", fontWeight: "bold", opacity: validSlots.length === 0 ? 0.5 : 1 }}
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

            <div style={{ maxWidth: "1400px", margin: "0 auto", border: "1px solid #1e293b", borderRadius: "12px", backgroundColor: "#090a0c", padding: "2vw" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(11, minmax(0, 1fr))", gap: "clamp(4px, 1vw, 12px)" }}>
                    {rowsWithAisle.map((r) => (
                        <div key={`aisle-${r}`} style={{ gridRowStart: r, gridColumnStart: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", opacity: 0.4 }}>
                            <Footprints size={"clamp(14px, 1.5vw, 24px)"} />
                        </div>
                    ))}

                    {stations.map((pc) => {
                        const isSelectedForCurrentTime = cart.some(item => item.seatId === pc.id && item.timeSlot === activeTimeSlot && item.date === selectedDate);
                        const theme = getTheme(pc.status, pc.tier, isSelectedForCurrentTime);
                        const isAvailable = pc.status === "AVAILABLE" || isSelectedForCurrentTime;

                        return (
                            <div 
                                key={pc.id} onClick={() => handleSeatClick(pc)}
                                style={{
                                    gridRowStart: pc.row, gridColumnStart: pc.col, backgroundColor: theme.bg,
                                    border: `2px solid ${theme.border}`, borderRadius: "8px", display: "flex",
                                    flexDirection: "column", alignItems: "center", justifyContent: "center",
                                    cursor: isAvailable ? "pointer" : "not-allowed", transition: "all 0.15s ease",
                                    opacity: isAvailable ? 1 : 0.4, position: "relative", aspectRatio: "1 / 1", 
                                    padding: "4px", boxShadow: isSelectedForCurrentTime ? "0 0 15px rgba(14, 165, 233, 0.5)" : "none"
                                }}
                            >
                                <div style={{ color: theme.icon, display: "flex", alignItems: "center", justifyContent: "center", height: "40%" }}>
                                    {pc.tier === "LUXURY" ? <Crown size={"100%"} /> : pc.tier === "PRO" ? <Zap size={"100%"} /> : <Monitor size={"100%"} />}
                                </div>
                                <div style={{ fontWeight: "700", fontSize: "clamp(0.45rem, 0.8vw, 0.85rem)", marginTop: "4px", textAlign: "center" }}>{pc.id}</div>
                                <div style={{ 
                                    fontSize: "clamp(0.4rem, 0.6vw, 0.65rem)", fontWeight: "600", color: theme.icon, 
                                    marginTop: "auto", backgroundColor: "#00000050", padding: "2px 4px", 
                                    borderRadius: "3px", whiteSpace: "nowrap"
                                }}>
                                    {theme.text}
                                </div>
                                {pc.status === "LOCKED" && !isSelectedForCurrentTime && (
                                    <ShieldAlert size={12} color="#eab308" style={{ position: "absolute", top: "2px", right: "2px" }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {cart.length > 0 && !showModal && (
                <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, backgroundColor: "#1e293b", borderTop: "2px solid #3b82f6", padding: "1rem 3rem", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 -10px 40px rgba(0,0,0,0.5)", zIndex: 100 }}>
                    <div style={{ flex: 1 }}>
                        <h2 style={{ margin: "0 0 10px 0", fontSize: "1.2rem", display: "flex", alignItems: "center", gap: "10px" }}>
                            <ShoppingCart size={24} color="#3b82f6"/> Cart ({cart.length} / {MAX_CART_ITEMS})
                        </h2>
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", maxHeight: "60px", overflowY: "auto" }}>
                            {cart.map((item, idx) => (
                                <div key={idx} style={{ backgroundColor: "#0f1115", padding: "4px 8px", borderRadius: "4px", fontSize: "0.85rem", display: "flex", alignItems: "center", gap: "5px", border: "1px solid #334155" }}>
                                    <span style={{ color: "#3b82f6", fontWeight: "bold" }}>{item.seatId}</span> @ {item.timeSlot}
                                    <Trash2 size={14} color="#ef4444" style={{ cursor: "pointer", marginLeft: "5px" }} onClick={() => setCart(cart.filter(i => !(i.seatId === item.seatId && i.timeSlot === item.timeSlot && i.date === item.date)))} />
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "2rem", marginLeft: "2rem" }}>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "0.8rem", color: "#94a3b8" }}>Total Price</div>
                            <div style={{ fontSize: "1.5rem", fontWeight: "bold", color: "#22c55e" }}>₹{cartTotal}</div>
                        </div>
                        <button onClick={handleCheckoutClick} style={{ backgroundColor: "#3b82f6", color: "white", border: "none", padding: "1rem 2rem", fontSize: "1rem", fontWeight: "bold", borderRadius: "8px", cursor: "pointer" }}>
                            Review & Checkout
                        </button>
                    </div>
                </div>
            )}

            {showModal && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
                    <div style={{ backgroundColor: "#0f1115", padding: "3rem", borderRadius: "12px", border: "1px solid #3b82f6", width: "400px", color: "white" }}>
                        <h2 style={{ marginTop: 0, borderBottom: "1px solid #1e293b", paddingBottom: "1rem" }}>Confirm Booking</h2>
                        <div style={{ margin: "1.5rem 0", maxHeight: "200px", overflowY: "auto" }}>
                            {cart.map((item, idx) => (
                                <div key={idx} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem", paddingBottom: "0.5rem", borderBottom: "1px solid #1e293b" }}>
                                    <span><span style={{ color: "#3b82f6" }}>{item.seatId}</span> ({item.date} {item.timeSlot})</span>
                                    <span>₹{item.price}</span>
                                </div>
                            ))}
                            <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", fontSize: "1.5rem", fontWeight: "bold" }}>
                                <span>Total</span>
                                <span style={{ color: "#22c55e" }}>₹{cartTotal}</span>
                            </div>
                        </div>
                        <div style={{ display: "flex", gap: "1rem" }}>
                            <button onClick={cancelCheckout} disabled={isProcessing} style={{ flex: 1, padding: "1rem", backgroundColor: "transparent", border: "1px solid #ef4444", color: "#ef4444", borderRadius: "8px", cursor: "pointer" }}>Cancel</button>
                            <button onClick={initiatePayment} disabled={isProcessing} style={{ flex: 1, padding: "1rem", backgroundColor: "#22c55e", border: "none", color: "white", borderRadius: "8px", cursor: "pointer", fontWeight: "bold" }}>{isProcessing ? "Processing..." : "Pay Now"}</button>
                        </div>
                    </div>
                </div>
            )}

            {showHistory && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.8)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 999 }}>
                    <div style={{ backgroundColor: "#0f1115", padding: 0, borderRadius: "12px", border: "1px solid #3b82f6", width: "500px", color: "white", maxHeight: "80vh", overflowY: "auto", position: "relative" }}>
                        <div style={{ position: "sticky", top: 0, backgroundColor: "#0f1115", zIndex: 10, display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #1e293b", padding: "1.5rem" }}>
                            <h2 style={{ margin: 0, display: "flex", alignItems: "center", gap: "10px" }}><Clock size={24} color="#3b82f6"/> Order History</h2>
                            <button onClick={() => setShowHistory(false)} style={{ background: "transparent", color: "#ef4444", border: "none", cursor: "pointer", fontSize: "1.2rem", fontWeight: "bold" }}>✕</button>
                        </div>
                        
                        <div style={{ padding: "1.5rem" }}>
                            {orderHistory.length === 0 ? (
                                <p style={{ color: "#94a3b8", textAlign: "center" }}>No past bookings found.</p>
                            ) : (
                                orderHistory.map(booking => (
                                    <div key={booking._id} style={{ backgroundColor: "#1e293b", padding: "1.5rem", borderRadius: "8px", marginBottom: "1rem" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                                            <span style={{ color: "#3b82f6", fontWeight: "bold" }}>ID: {booking._id.slice(-6).toUpperCase()}</span>
                                            <span style={{ color: "#22c55e", fontWeight: "bold", fontSize: "1.2rem" }}>₹{booking.totalPrice}</span>
                                        </div>
                                        <div style={{ fontSize: "0.8rem", color: "#94a3b8", marginBottom: "15px" }}>
                                            Booked on: {new Date(booking.date).toLocaleDateString()}
                                        </div>
                                        <div style={{ display: "flex", gap: "5px", flexWrap: "wrap", marginBottom: "15px" }}>
                                            {booking.items.map((item, idx) => (
                                                <span key={idx} style={{ backgroundColor: "#0f1115", padding: "4px 8px", borderRadius: "4px", fontSize: "0.75rem", border: "1px solid #334155" }}>
                                                    <span style={{ color: "#3b82f6", fontWeight: "bold" }}>{item.seatId}</span> @ {item.date} {item.timeSlot}
                                                </span>
                                            ))}
                                        </div>
                                        <button onClick={() => generateTicketPDF(booking._id, booking.items, booking.totalPrice)} style={{ width: "100%", padding: "10px", backgroundColor: "#0284c7", color: "white", border: "none", borderRadius: "4px", cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", gap: "8px", fontWeight: "bold" }}>
                                            <FileText size={18} /> Download Ticket
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* AI CHAT WIDGET */}
            <div style={{ position: "fixed", bottom: "20px", right: "20px", zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                {isChatOpen && (
                    <div style={{ width: "300px", height: "400px", backgroundColor: "#0f1115", border: "1px solid #3b82f6", borderRadius: "12px", display: "flex", flexDirection: "column", marginBottom: "10px", overflow: "hidden", boxShadow: "0 10px 25px rgba(0,0,0,0.5)" }}>
                        <div style={{ backgroundColor: "#1e293b", padding: "10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #3b82f6" }}>
                            <span style={{ fontWeight: "bold", color: "white" }}>Buddy</span>
                            <button onClick={() => setIsChatOpen(false)} style={{ background: "transparent", color: "white", border: "none", cursor: "pointer" }}>✕</button>
                        </div>
                        <div style={{ flex: 1, padding: "10px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" }}>
                            {chatMessages.map((msg, i) => (
                                <div key={i} style={{ alignSelf: msg.sender === "user" ? "flex-end" : "flex-start", backgroundColor: msg.sender === "user" ? "#3b82f6" : "#1e293b", padding: "8px 12px", borderRadius: "8px", maxWidth: "80%", fontSize: "0.85rem", wordBreak: "break-word" }}>
                                    {msg.text}
                                </div>
                            ))}
                            
                            {isAITyping && (
                                <div style={{ alignSelf: "flex-start", backgroundColor: "#1e293b", padding: "8px 12px", borderRadius: "8px", fontSize: "0.85rem", color: "#94a3b8", display: "flex", gap: "4px", alignItems: "center" }}>
                                    <span>Buddy is typing</span>
                                    <span style={{ animation: "pulse 1.5s infinite" }}>.</span>
                                    <span style={{ animation: "pulse 1.5s infinite 0.2s" }}>.</span>
                                    <span style={{ animation: "pulse 1.5s infinite 0.4s" }}>.</span>
                                </div>
                            )}
                            <div ref={chatEndRef} />
                        </div>
                        <div style={{ display: "flex", padding: "10px", borderTop: "1px solid #1e293b" }}>
                            <input 
                                type="text" 
                                value={chatInput} 
                                onChange={(e) => setChatInput(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                                placeholder="Ask Buddy..." 
                                style={{ flex: 1, padding: "8px", borderRadius: "4px", border: "none", outline: "none", backgroundColor: "#1e293b", color: "white" }} 
                            />
                            <button onClick={handleSendMessage} style={{ marginLeft: "5px", backgroundColor: "#3b82f6", color: "white", border: "none", padding: "8px", borderRadius: "4px", cursor: "pointer" }}>Send</button>
                        </div>
                    </div>
                )}
                <button onClick={() => setIsChatOpen(!isChatOpen)} style={{ width: "60px", height: "60px", borderRadius: "50%", backgroundColor: "#3b82f6", color: "white", border: "none", cursor: "pointer", display: "flex", justifyContent: "center", alignItems: "center", boxShadow: "0 4px 12px rgba(59,130,246,0.5)" }}>
                    <Zap size={24} />
                </button>
            </div>
        </div>
    );
}