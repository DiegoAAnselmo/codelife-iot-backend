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

app.post("/api/iot/readings", async (req, res) => {
  try {
    const payload = req.body;

    if (!payload.client_id || !payload.equipment_id || !payload.device_id) {
      return res.status(400).json({
        success: false,
        error: "Payload incompleto. client_id, equipment_id e device_id são obrigatórios."
      });
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("slug", payload.client_id)
      .single();

    if (clientError || !client) {
      return res.status(404).json({
        success: false,
        error: "Cliente não encontrado",
        client_id: payload.client_id
      });
    }

    const sensorReadings = [
      { sensor_code: "vibracao_rms", value: payload.vibracao_rms, unit: "g", status: payload.status_vibracao },
      { sensor_code: "vibracao_pico", value: payload.vibracao_pico, unit: "g", status: payload.status_vibracao },
      { sensor_code: "corrente_media", value: payload.corrente_media, unit: "A", status: payload.status_corrente },
      { sensor_code: "temperatura_ambiente", value: payload.temperatura_ambiente, unit: "°C", status: null },
      { sensor_code: "umidade", value: payload.umidade, unit: "%", status: null },
      { sensor_code: "pulsos_impacto", value: payload.pulsos_impacto, unit: "pulsos", status: payload.status_impacto }
    ].filter(item => item.value !== undefined && item.value !== null);

    const rows = sensorReadings.map(item => ({
      client_id: client.id,
      sensor_code: item.sensor_code,
      value: Number(item.value),
      unit: item.unit,
      status: item.status,
      payload: payload
    }));

    const { data, error } = await supabase
      .from("readings")
      .insert(rows)
      .select();

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      message: "Leituras gravadas com sucesso",
      inserted: data.length,
      readings: data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
