//@ts-nocheck
import mongoose from "mongoose";

const stationSchema = new mongoose.Schema(
	{
		stationNumber: {
			type: Number,
			required: true,
			unique: true,
		},
		tier: {
			type: String,
			enum: ["STANDARD", "PRO_ESPORTS", "VIP_STREAMING", "SIM_RACING"],
			default: "STANDARD",
		},
		specs: {
			cpu: { type: String, required: true },
			gpu: { type: String, required: true },
			ram: { type: String, required: true },
			monitor: { type: String, required: true },
		},
		baseHourlyRate: {
			type: Number,
			required: true,
		},
		isOperational: {
			type: Boolean,
			default: true,
		},
	},
	{ timestamps: true }
);

export const Station = mongoose.model("Station", stationSchema);