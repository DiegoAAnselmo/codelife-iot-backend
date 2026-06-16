import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Codelife IoT Backend Online");
});

app.get("/health", (req, res) => {
  res.json({
    status: "online",
    service: "codelife-iot-backend"
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
