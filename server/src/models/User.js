//@ts-nocheck
import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
    email:     { type: String, required: true, unique: true },
    name:      { type: String, required: true },
    role:      { type: String, default: "client" },
    isBanned:  { type: Boolean, default: false },
    lastLogin: { type: Date, default: Date.now }
});

export const User = mongoose.model("User", userSchema);