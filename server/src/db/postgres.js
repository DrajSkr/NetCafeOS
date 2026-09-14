import pg from 'pg';
import pgvector from 'pgvector/pg';
import dotenv from 'dotenv';
dotenv.config();

const { Pool } = pg;

// Create a new connection pool
export const pool = new Pool({
  connectionString: process.env.POSTGRES_URI || 'postgres://postgres:mysecretpassword@localhost:5432/postgres',
});

// Initialize the database: Create extension, register vector types, and create tables
export const initPostgres = async () => {
  try {
    const client = await pool.connect();
    
    console.log("PostgreSQL connected successfully.");

    // Create the pgvector extension if it doesn't exist
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    
    // Register the vector type with the pg client
    await pgvector.registerType(client);

    // Create the rule_chunks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS rule_chunks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding vector(768)
      );
    `);

    // Create HNSW index for O(logN) similarity search
    // We use vector_cosine_ops because we are using cosine similarity
    await client.query(`
      CREATE INDEX IF NOT EXISTS rule_chunks_embedding_idx 
      ON rule_chunks 
      USING hnsw (embedding vector_cosine_ops) 
      WITH (m = 16, ef_construction = 64);
    `);

    console.log("PostgreSQL initialized and HNSW index ensured.");
    client.release();
  } catch (error) {
    console.error("Error initializing PostgreSQL:", error);
    process.exit(1);
  }
};
