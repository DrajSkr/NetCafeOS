import mongoose from "mongoose";

const ruleChunkSchema = new mongoose.Schema(
	{
		title: {
			type: String,
			required: true,
		},
		category: {
			type: String,
			// enum: ["VENUE_POLICY", "HARDWARE_RULES", "PRICING", "CANCELLATION","INFO","CUSTOMER SUPPORT"],
			required: true,
		},
		content: {
			type: String,
			required: true,
		},
		embedding: {
			type: [Number], // Vector representation
			default: [],
		},
	},
	{ timestamps: true }
);

export const RuleChunk = mongoose.model("RuleChunk", ruleChunkSchema);