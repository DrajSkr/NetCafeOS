import jwt from 'jsonwebtoken';
import { User } from '../models/User.js';

export const verifyAdmin = (req, res, next) => {
    // Expecting header format: "Authorization: Bearer <token>"
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
        return res.status(401).json({ error: "Access denied. No token provided." });
    }

    try {
        // Verify token against your cryptographically secure secret
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.role !== 'admin') {
            throw new Error("Insufficient permissions");
        }
        
        req.user = decoded;
        next(); // Token is good, proceed to the actual route
    } catch (error) {
        res.status(403).json({ error: "Invalid or expired token. Please log in again." });
    }
};

export const verifyUser = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
        return res.status(401).json({ error: "Access denied. Please log in." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if user is banned
        const user = await User.findOne({ email: decoded.email });
        if (user && user.isBanned) {
            return res.status(403).json({ error: "Your account is suspended. Contact support@netcafeos.in." });
        }
        
        req.user = decoded; // Contains the user's email
        next();
    } catch (error) {
        res.status(403).json({ error: "Invalid session." });
    }
};