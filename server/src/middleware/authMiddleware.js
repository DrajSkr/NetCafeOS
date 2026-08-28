import jwt from 'jsonwebtoken';

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

// Add this below your existing verifyAdmin function
export const verifyUser = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    
    if (!token) {
        return res.status(401).json({ error: "Access denied. Please log in." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded; // Contains the user's email
        next();
    } catch (error) {
        res.status(403).json({ error: "Invalid session." });
    }
};