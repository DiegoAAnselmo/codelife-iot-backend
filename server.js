import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.get("/", (req, res) => {
  res.send("Codelife IoT Backend Online");
});

app.get("/health", async (req, res) => {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .limit(1);

  res.json({
    status: "online",
    database: error ? "erro" : "conectado",
    clients_found: data ? data.length : 0,
    error: error ? error.message : null
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
