#include <WiFi.h>
#include <WebSocketsClient.h>
#include "esp_camera.h"
#include <NMEAGPS.h>
#include <Wire.h>
#include <QMC5883LCompass.h>

// ---------------- GPS ----------------

NMEAGPS gps;
gps_fix fix;

static const int GPS_RX = 44;
static const int GPS_TX = 43;

float gpsLat = 0;
float gpsLon = 0;
int gpsSats = 0;

// ---------------- COMPASS ----------------

QMC5883LCompass compass;
int compassHeading = 0;

// ---------------- CAMERA ----------------

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

// ---------------- NETWORK ----------------

static const char* WIFI_SSID = "NojusS24";
static const char* WIFI_PASSWORD = "slaptaszodis";

static const char* WS_HOST = "10.89.149.15";
static const uint16_t WS_PORT = 8080;
static const char* WS_PATH = "/ws";

static const char* BUOY_ID = "boey-01";

// ---------------- TIMING ----------------

static const unsigned long IMAGE_INTERVAL_MS = 1000;
static const unsigned long TELEMETRY_INTERVAL_MS = 1000;

// ---------------- GLOBALS ----------------

WebSocketsClient webSocket;

unsigned long lastImageAt = 0;
unsigned long lastTelemetryAt = 0;

// ---------------- FUNCTIONS ----------------

bool initCamera();
void connectWifi();
void connectWebSocket();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);

void sendFrame();
void sendTelemetry();

String buildTelemetryJson();

String buildGps();
String buildCompass();

// ---------------- SETUP ----------------

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println("System starting");

  // GPS UART
  Serial1.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);
  Serial.println("GPS started");

  // Compass I2C
  Wire.begin(5,6);
  compass.init();
  Serial.println("Compass started");

  if (!initCamera()) {
    Serial.println("Camera init failed");
    while(true) delay(1000);
  }

  connectWifi();
  connectWebSocket();
}

// ---------------- LOOP ----------------

void loop() {

  // ---- GPS ----
  while (gps.available(Serial1)) {

    fix = gps.read();

    if (fix.valid.location) {
      gpsLat = fix.latitude();
      gpsLon = fix.longitude();
    }

    gpsSats = fix.satellites;
  }

  // ---- COMPASS ----
  compass.read();
  compassHeading = compass.getAzimuth();

  webSocket.loop();

  if (WiFi.status() != WL_CONNECTED) {
    connectWifi();
  }

  unsigned long now = millis();

  if (webSocket.isConnected() && now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryAt = now;
    sendTelemetry();
  }

  if (webSocket.isConnected() && now - lastImageAt >= IMAGE_INTERVAL_MS) {
    lastImageAt = now;
    sendFrame();
  }
}

// ---------------- CAMERA ----------------

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
    Serial.printf("Camera error: 0x%x\n", err);
    return false;
  }

  return true;
}

// ---------------- WIFI ----------------

void connectWifi() {

  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Connecting WiFi %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());
}

// ---------------- WEBSOCKET ----------------

void connectWebSocket() {

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);

  webSocket.setReconnectInterval(3000);
  webSocket.enableHeartbeat(15000,3000,2);

  webSocket.onEvent(onWebSocketEvent);
}

void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length) {

  switch(type) {

    case WStype_CONNECTED:
      Serial.println("WebSocket connected");
      break;

    case WStype_DISCONNECTED:
      Serial.println("WebSocket disconnected");
      break;

    case WStype_TEXT:
      Serial.printf("Server: %.*s\n", length, payload);
      break;

    default:
      break;
  }
}

// ---------------- SEND IMAGE ----------------

void sendFrame() {

  camera_fb_t *fb = esp_camera_fb_get();

  if (!fb) {
    Serial.println("Frame failed");
    return;
  }

  webSocket.sendBIN(fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// ---------------- SEND TELEMETRY ----------------

void sendTelemetry() {

  String payload = buildTelemetryJson();

  webSocket.sendTXT(payload);
}

String buildTelemetryJson() {

  String json;

  json += "{\"buoyId\":\"";
  json += BUOY_ID;
  json += "\",\"status\":\"online\",\"gps\":\"";
  json += buildGps();
  json += "\",\"compass\":\"";
  json += buildCompass();
  json += "\"}";

  return json;
}

// ---------------- GPS STRING ----------------

String buildGps() {

  String gps;

  gps += String(gpsSats);
  gps += ",";
  gps += String(gpsLat,6);
  gps += ",";
  gps += String(gpsLon,6);

  return gps;
}

// ---------------- COMPASS STRING ----------------

String buildCompass() {

  return String(compassHeading);
}
