const express = require('express');
require('dotenv').config();
const app = express();
app.use(express.json());
// Mock verifyUser
const verifyUser = (req, res, next) => { req.user = {email: 'test@example.com'}; next(); };
// Override the export to allow mock
const bookingRoutes = require('./src/routes/bookingRoutes.js').default;
// wait, verifyUser is imported in bookingRoutes.js, so I can't easily mock it this way because it's hardcoded in the router.
