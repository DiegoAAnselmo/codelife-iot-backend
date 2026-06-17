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

    const { data: equipment, error: equipmentError } = await supabase
      .from("equipments")
      .select("*")
      .eq("client_id", client.id)
      .eq("equipment_code", payload.equipment_id)
      .single();

    if (equipmentError || !equipment) {
      return res.status(404).json({
        success: false,
        error: "Equipamento não encontrado",
        equipment_id: payload.equipment_id
      });
    }

    const { data: device, error: deviceError } = await supabase
      .from("devices")
      .select("*")
      .eq("client_id", client.id)
      .eq("device_code", payload.device_id)
      .single();

    if (deviceError || !device) {
      return res.status(404).json({
        success: false,
        error: "Dispositivo não encontrado",
        device_id: payload.device_id
      });
    }

    await supabase
      .from("devices")
      .update({
        status: "online",
        last_seen: new Date().toISOString()
      })
      .eq("id", device.id);

    const sensorReadings = [
      { sensor_code: "vibracao_rms", value: payload.vibracao_rms, unit: "g", status: payload.status_vibracao },
      { sensor_code: "vibracao_pico", value: payload.vibracao_pico, unit: "g", status: payload.status_vibracao },
      { sensor_code: "corrente_media", value: payload.corrente_media, unit: "A", status: payload.status_corrente },
      { sensor_code: "temperatura_ambiente", value: payload.temperatura_ambiente, unit: "°C", status: null },
      { sensor_code: "umidade", value: payload.umidade, unit: "%", status: null },
      { sensor_code: "pulsos_impacto", value: payload.pulsos_impacto, unit: "pulsos", status: payload.status_impacto }
    ].filter(item => item.value !== undefined && item.value !== null);

    const { data: sensors, error: sensorsError } = await supabase
      .from("sensors")
      .select("*")
      .eq("device_id", device.id);

    if (sensorsError) {
      throw sensorsError;
    }

    const rows = sensorReadings.map(item => {
      const sensor = sensors.find(s => s.sensor_code === item.sensor_code);

      return {
        client_id: client.id,
        equipment_id: equipment.id,
        device_id: device.id,
        sensor_id: sensor ? sensor.id : null,
        sensor_code: item.sensor_code,
        value: Number(item.value),
        unit: item.unit,
        status: item.status,
        payload: payload
      };
    });

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
      message: "Leituras gravadas com vínculos completos",
      inserted: data.length,
      equipment_id: equipment.id,
      device_id: device.id,
      readings: data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.post("/api/provision/device", async (req, res) => {
  try {
    const {
      client_slug,
      site_name,
      site_address,
      equipment_name,
      equipment_code,
      equipment_type,
      equipment_location,
      device_code,
      device_name,
      firmware_version,
      model_code
    } = req.body;

    if (!client_slug || !site_name || !equipment_name || !equipment_code || !device_code || !model_code) {
      return res.status(400).json({
        success: false,
        error: "Campos obrigatórios: client_slug, site_name, equipment_name, equipment_code, device_code, model_code"
      });
    }

    const { data: client, error: clientError } = await supabase
      .from("clients")
      .select("*")
      .eq("slug", client_slug)
      .single();

    if (clientError || !client) {
      return res.status(404).json({
        success: false,
        error: "Cliente não encontrado",
        client_slug
      });
    }

    const { data: model, error: modelError } = await supabase
      .from("device_models")
      .select("*")
      .eq("model_code", model_code)
      .single();

    if (modelError || !model) {
      return res.status(404).json({
        success: false,
        error: "Modelo de dispositivo não encontrado",
        model_code
      });
    }

    let { data: site } = await supabase
      .from("sites")
      .select("*")
      .eq("client_id", client.id)
      .eq("name", site_name)
      .maybeSingle();

    if (!site) {
      const { data: newSite, error: siteError } = await supabase
        .from("sites")
        .insert({
          client_id: client.id,
          name: site_name,
          address: site_address || null,
          status: "active"
        })
        .select()
        .single();

      if (siteError) throw siteError;
      site = newSite;
    }

    let { data: equipment } = await supabase
      .from("equipments")
      .select("*")
      .eq("client_id", client.id)
      .eq("equipment_code", equipment_code)
      .maybeSingle();

    if (!equipment) {
      const { data: newEquipment, error: equipmentError } = await supabase
        .from("equipments")
        .insert({
          client_id: client.id,
          site_id: site.id,
          name: equipment_name,
          equipment_code,
          type: equipment_type || model.module,
          location: equipment_location || null,
          status: "active"
        })
        .select()
        .single();

      if (equipmentError) throw equipmentError;
      equipment = newEquipment;
    }

    const mqttTopic = model.default_mqtt_pattern
      .replace("{client_slug}", client.slug)
      .replace("{equipment_code}", equipment.equipment_code);

    let { data: device } = await supabase
      .from("devices")
      .select("*")
      .eq("client_id", client.id)
      .eq("device_code", device_code)
      .maybeSingle();

    if (!device) {
      const { data: newDevice, error: deviceError } = await supabase
        .from("devices")
        .insert({
          client_id: client.id,
          equipment_id: equipment.id,
          device_code,
          name: device_name || `ESP32 - ${equipment.name}`,
          firmware_version: firmware_version || "1.0.0",
          mqtt_topic: mqttTopic,
          status: "active"
        })
        .select()
        .single();

      if (deviceError) throw deviceError;
      device = newDevice;
    }

    const { data: modelSensors, error: sensorsModelError } = await supabase
      .from("device_model_sensors")
      .select("*")
      .eq("model_code", model_code)
      .eq("enabled_by_default", true);

    if (sensorsModelError) throw sensorsModelError;

    const sensorRows = modelSensors.map(sensor => ({
      client_id: client.id,
      equipment_id: equipment.id,
      device_id: device.id,
      sensor_code: sensor.sensor_code,
      sensor_type: sensor.sensor_type,
      unit: sensor.unit,
      status: "active"
    }));

    const { data: createdSensors, error: sensorsError } = await supabase
      .from("sensors")
      .upsert(sensorRows, { onConflict: "device_id,sensor_code" })
      .select();

    if (sensorsError) throw sensorsError;

    const thresholdRows = modelSensors.map(sensor => ({
      client_id: client.id,
      equipment_id: equipment.id,
      sensor_code: sensor.sensor_code,
      warning_min: sensor.default_warning_min,
      warning_max: sensor.default_warning_max,
      critical_min: sensor.default_critical_min,
      critical_max: sensor.default_critical_max,
      config: sensor.config || {}
    }));

    await supabase
      .from("sensor_thresholds")
      .upsert(thresholdRows, { onConflict: "equipment_id,sensor_code" });

    const { data: existingWidgets } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("equipment_id", equipment.id);

    let createdWidgets = existingWidgets || [];

    if (!existingWidgets || existingWidgets.length === 0) {
      const { data: widgetTemplates, error: widgetTemplateError } = await supabase
        .from("dashboard_widget_templates")
        .select("*")
        .eq("model_code", model_code)
        .eq("enabled_by_default", true)
        .order("position");

      if (widgetTemplateError) throw widgetTemplateError;

      const widgetRows = widgetTemplates.map(widget => ({
        client_id: client.id,
        equipment_id: equipment.id,
        sensor_code: widget.sensor_code,
        widget_type: widget.widget_type,
        title: widget.title,
        position: widget.position,
        config: widget.config || {}
      }));

      const { data: newWidgets, error: widgetsError } = await supabase
        .from("dashboard_widgets")
        .insert(widgetRows)
        .select();

      if (widgetsError) throw widgetsError;
      createdWidgets = newWidgets;
    }

    return res.json({
      success: true,
      message: "Dispositivo provisionado com sucesso",
      client,
      site,
      equipment,
      device,
      mqtt_topic: mqttTopic,
      sensors_created: createdSensors.length,
      widgets_created: createdWidgets.length,
      sensors: createdSensors,
      widgets: createdWidgets
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
app.get("/api/equipments/:equipment_code/latest", async (req, res) => {
  try {
    const { equipment_code } = req.params;

    const { data: equipment, error: equipmentError } = await supabase
      .from("equipments")
      .select("*")
      .eq("equipment_code", equipment_code)
      .single();

    if (equipmentError || !equipment) {
      return res.status(404).json({
        success: false,
        error: "Equipamento não encontrado",
        equipment_code
      });
    }

    const { data: readings, error: readingsError } = await supabase
      .from("readings")
      .select("*")
      .eq("equipment_id", equipment.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (readingsError) {
      return res.status(500).json({
        success: false,
        error: readingsError.message
      });
    }

    const latestBySensor = {};

    for (const reading of readings) {
      if (!latestBySensor[reading.sensor_code]) {
        latestBySensor[reading.sensor_code] = {
          sensor_code: reading.sensor_code,
          value: reading.value,
          unit: reading.unit,
          status: reading.status,
          created_at: reading.created_at
        };
      }
    }

    return res.json({
      success: true,
      equipment: {
        id: equipment.id,
        name: equipment.name,
        equipment_code: equipment.equipment_code,
        type: equipment.type,
        location: equipment.location,
        status: equipment.status
      },
      latest: latestBySensor
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
app.get("/api/equipments", async (req, res) => {
  try {
    const { client_slug } = req.query;

    let clientId = null;

    if (client_slug) {
      const { data: client, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("slug", client_slug)
        .single();

      if (clientError || !client) {
        return res.status(404).json({
          success: false,
          error: "Cliente não encontrado",
          client_slug
        });
      }

      clientId = client.id;
    }

    let query = supabase
      .from("equipments")
      .select(`
        *,
        devices (
          id,
          device_code,
          name,
          status,
          last_seen,
          mqtt_topic
        )
      `)
      .order("created_at", { ascending: false });

    if (clientId) {
      query = query.eq("client_id", clientId);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }

    return res.json({
      success: true,
      count: data.length,
      equipments: data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});

app.get("/api/equipments/:equipment_code/history", async (req, res) => {
  try {
    const { equipment_code } = req.params;
    const limit = Number(req.query.limit || 100);

    const { data: equipment, error: equipmentError } = await supabase
      .from("equipments")
      .select("*")
      .eq("equipment_code", equipment_code)
      .single();

    if (equipmentError || !equipment) {
      return res.status(404).json({
        success: false,
        error: "Equipamento não encontrado",
        equipment_code
      });
    }

    const { data: readings, error: readingsError } = await supabase
      .from("readings")
      .select(`
        sensor_code,
        value,
        unit,
        status,
        created_at
      `)
      .eq("equipment_id", equipment.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (readingsError) {
      return res.status(500).json({
        success: false,
        error: readingsError.message
      });
    }

    return res.json({
      success: true,
      equipment: {
        id: equipment.id,
        name: equipment.name,
        equipment_code: equipment.equipment_code,
        type: equipment.type,
        location: equipment.location,
        status: equipment.status
      },
      count: readings.length,
      history: readings
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
});
app.get("/api/equipments/:equipment_code/dashboard", async (req, res) => {
  try {
    const { equipment_code } = req.params;

    const { data: equipment, error: equipmentError } = await supabase
      .from("equipments")
      .select("*")
      .eq("equipment_code", equipment_code)
      .single();

    if (equipmentError || !equipment) {
      return res.status(404).json({
        success: false,
        error: "Equipamento não encontrado",
        equipment_code
      });
    }

    const { data: latestReadings, error: readingsError } = await supabase
      .from("readings")
      .select("*")
      .eq("equipment_id", equipment.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (readingsError) {
      return res.status(500).json({
        success: false,
        error: readingsError.message
      });
    }

    const latestBySensor = {};

    for (const reading of latestReadings) {
      if (!latestBySensor[reading.sensor_code]) {
        latestBySensor[reading.sensor_code] = {
          sensor_code: reading.sensor_code,
          value: reading.value,
          unit: reading.unit,
          status: reading.status,
          created_at: reading.created_at
        };
      }
    }

    const { data: widgets, error: widgetsError } = await supabase
      .from("dashboard_widgets")
      .select("*")
      .eq("equipment_id", equipment.id)
      .order("position", { ascending: true });

    if (widgetsError) {
      return res.status(500).json({
        success: false,
        error: widgetsError.message
      });
    }

    const dashboardWidgets = widgets.map(widget => {
      const reading = widget.sensor_code
        ? latestBySensor[widget.sensor_code]
        : null;

      return {
        id: widget.id,
        title: widget.title,
        widget_type: widget.widget_type,
        sensor_code: widget.sensor_code,
        position: widget.position,
        config: widget.config,
        value: reading ? reading.value : null,
        unit: reading ? reading.unit : null,
        status: reading ? reading.status : null,
        last_update: reading ? reading.created_at : null
      };
    });

    return res.json({
      success: true,
      equipment: {
        id: equipment.id,
        name: equipment.name,
        equipment_code: equipment.equipment_code,
        type: equipment.type,
        location: equipment.location,
        status: equipment.status
      },
      widgets: dashboardWidgets
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
