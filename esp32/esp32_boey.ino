#include <WiFi.h>
#include <WebSocketsClient.h>
#include "esp_camera.h"

// XIAO ESP32S3 Sense camera pin map based on Seeed examples for CAMERA_MODEL_XIAO_ESP32S3.
#define PWDN_GPIO_NUM   -1
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM   10
#define SIOD_GPIO_NUM   40
#define SIOC_GPIO_NUM   39

#define Y9_GPIO_NUM     48
#define Y8_GPIO_NUM     11
#define Y7_GPIO_NUM     12
#define Y6_GPIO_NUM     14
#define Y5_GPIO_NUM     16
#define Y4_GPIO_NUM     18
#define Y3_GPIO_NUM     17
#define Y2_GPIO_NUM     15
#define VSYNC_GPIO_NUM  38
#define HREF_GPIO_NUM   47
#define PCLK_GPIO_NUM   13

static const char* WIFI_SSID = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

static const char* WS_HOST = "10.89.149.15";
static const uint16_t WS_PORT = 8080;
static const char* WS_PATH = "/ws";

static const char* BUOY_ID = "boey-01";

static const unsigned long IMAGE_INTERVAL_MS = 1000;
static const unsigned long TELEMETRY_INTERVAL_MS = 1000;

WebSocketsClient webSocket;
unsigned long lastImageAt = 0;
unsigned long lastTelemetryAt = 0;

bool initCamera();
void connectWifi();
void connectWebSocket();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);
void sendFrame();
void sendTelemetry();
String buildTelemetryJson();
String fakeGps();
String fakeCompass();

void setup() {
  Serial.begin(115200);
  delay(1000);

  if (!initCamera()) {
    Serial.println("Camera initialization failed");
    while (true) {
      delay(1000);
    }
  }

  connectWifi();
  connectWebSocket();
}

void loop() {
  webSocket.loop();

  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  const unsigned long now = millis();

  if (webSocket.isConnected() && now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    sendTelemetry();
  }

  if (webSocket.isConnected() && now - lastImageAt >= IMAGE_INTERVAL_MS) {
    lastImageAt = now;
    sendFrame();
  }
}

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    config.frame_size = FRAMESIZE_HD;
    config.jpeg_quality = 12;
    config.fb_count = 2;
  } else {
    config.frame_size = FRAMESIZE_HD;
    config.jpeg_quality = 12;
    config.fb_count = 1;
    config.fb_location = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("esp_camera_init failed: 0x%x\n", err);
    return false;
  }

  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor != nullptr) {
    sensor->set_brightness(sensor, 0);
    sensor->set_saturation(sensor, 0);
    sensor->set_contrast(sensor, 0);
  }

  return true;
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  Serial.printf("Connecting to Wi-Fi SSID: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("Wi-Fi connected, IP: ");
  Serial.println(WiFi.localIP());
}

void connectWebSocket() {
  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000, 3000, 2);
  webSocket.onEvent(onWebSocketEvent);
}

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      Serial.printf("WebSocket connected to ws://%s:%u%s\n", WS_HOST, WS_PORT, WS_PATH);
      break;
    case WStype_DISCONNECTED:
      Serial.println("WebSocket disconnected");
      break;
    case WStype_TEXT:
      Serial.printf("Server text: %.*s\n", static_cast<int>(length), payload);
      break;
    case WStype_ERROR:
      Serial.println("WebSocket error");
      break;
    default:
      break;
  }
}

void sendFrame() {
  camera_fb_t* frame = esp_camera_fb_get();
  if (frame == nullptr) {
    Serial.println("Failed to capture frame");
    return;
  }

  bool ok = webSocket.sendBIN(frame->buf, frame->len);
  esp_camera_fb_return(frame);

  Serial.printf("Binary frame sent: %s, bytes=%u\n", ok ? "ok" : "failed", frame->len);
}

void sendTelemetry() {
  String payload = buildTelemetryJson();
  webSocket.sendTXT(payload);
}

String buildTelemetryJson() {
  String json;
  json.reserve(160);
  json += "{\"buoyId\":\"";
  json += BUOY_ID;
  json += "\",\"status\":\"online\",\"gps\":\"";
  json += fakeGps();
  json += "\",\"compass\":\"";
  json += fakeCompass();
  json += "\"}";
  return json;
}

String fakeGps() {
  // Replace this with real GPS sensor input when available.
  return "54.6872,25.2797";
}

String fakeCompass() {
  // Replace this with a real compass sensor reading when available.
  return "182";
}
