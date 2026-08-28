//@ts-nocheck
import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User } from '../models/User.js'; // CRITICAL: You must import the model

const router = express.Router();
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// CHANGE THIS to your actual Google email address so you keep Admin rights
const ADMIN_EMAILS = ["sarkardhiraj279@gmail.com"]; 

router.post('/google', async (req, res) => {
    const { credential } = req.body;
    
    if (!credential) {
        return res.status(400).json({ error: 'No credential provided' });
    }

    try {
        const ticket = await client.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        
        const payload = ticket.getPayload();
        
        // 1. Dynamic Role Assignment
        const role = ADMIN_EMAILS.includes(payload.email) ? 'admin' : 'client';

        // 2. THE UPSERT LOGIC (Sign Up / Sign In)
        let user = await User.findOne({ email: payload.email });
        
        if (!user) {
            // User does not exist -> SIGN UP
            user = new User({ 
                email: payload.email, 
                name: payload.name, 
                role: role 
            });
            await user.save();
            console.log(`New user registered: ${payload.email}`);
        } else {
            // User exists -> SIGN IN
            user.lastLogin = Date.now();
            // Upgrade role if they were added to ADMIN_EMAILS later
            if (user.role !== role) user.role = role; 
            await user.save();
            console.log(`Existing user logged in: ${payload.email}`);
        }

        // 3. Block banned users from logging in
        if (user.isBanned) {
            return res.status(403).json({
                error: "Your account has been suspended. Contact support@netcafeos.in to appeal."
            });
        }

        // 4. Issue the JWT
        const token = jwt.sign(
            { email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.json({
            success: true,
            token,
            role: user.role,
            user: { name: user.name, email: user.email }
        });


    } catch (error) {
        console.error('Google Auth Error:', error);
        res.status(500).json({ error: 'Internal Server Error during authentication' });
    }
});

export default router;