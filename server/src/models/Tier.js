import mongoose from "mongoose";

const tierSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true, 
    unique: true,
    enum: ["ECONOMY", "STANDARD", "PRO", "LUXURY"]
  },
  price: { 
    type: Number, 
    required: true 
  },
  description: {
    type: String
  }
});

export const Tier = mongoose.model("Tier", tierSchema);