#include <WiFi.h>
#include <WebSocketsClient.h>
#include "esp_camera.h"
#include <Wire.h>
#include <TinyGPS++.h>
#include <QMC5883LCompass.h>
/* ================= CAMERA PINS ================= */

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

/* ================= COMPASS ================= */

#define COMPASS_ADDR 0x1E
#define SDA_PIN 5
#define SCL_PIN 6
QMC5883LCompass compass;


/* ================= GPS ================= */

#define GPS_RX 44
#define GPS_TX 43

HardwareSerial GPS(1);
TinyGPSPlus gps;
/* ================= WIFI ================= */

static const char* WIFI_SSID = "*******";
static const char* WIFI_PASSWORD = "*******";

/* ================= WEBSOCKET ================= */

static const char* WS_HOST = "10.249.211.51";
static const uint16_t WS_PORT = 8080;
static const char* WS_PATH = "/ws";

/* ================= DEVICE ================= */

static const char* BUOY_ID = "buoy-01";

/* ================= TIMING ================= */

static const unsigned long IMAGE_INTERVAL_MS = 2000;
static const unsigned long TELEMETRY_INTERVAL_MS = 1000;
static const unsigned long WS_CONNECT_INTERVAL_MS = 5000;

/* ================= GLOBALS ================= */

WebSocketsClient webSocket;

unsigned long lastImageAt = 0;
unsigned long lastTelemetryAt = 0;
unsigned long lastWebSocketConnectAttemptAt = 0;

/* GPS DATA */

float gpsLat = 0;
float gpsLon = 0;
String gpsSats = "0";

/* ================= FUNCTIONS ================= */

bool initCamera();
void connectWifi();
void connectWebSocket();
void onWebSocketEvent(WStype_t type, uint8_t* payload, size_t length);

void sendFrame();
void sendTelemetry();

String buildTelemetryJson();
String readCompass();

void readGPS();
void parseGPS(String line);
float nmeaToDecimal(String raw, String dir);

/* ================= SETUP ================= */

void setup() {

  Serial.begin(115200);
  delay(1000);

  Serial.println("System starting");

  Serial.print("PSRAM: ");
  Serial.println(psramFound());

  /* QMC5883 
     Used HGLRC M100 compass, Make sure to calibrate it.
  */
  compass.init();
  compass.setCalibrationOffsets(-65.00, 560.00, -7.00);
  compass.setCalibrationScales(1.00, 1.02, 0.98);
  Serial.println("Compass started");

  /* GPS UART */

  GPS.begin(115200, SERIAL_8N1, GPS_RX, GPS_TX);
  Serial.println("GPS started");

  if (!initCamera()) {
    Serial.println("Camera init failed");
    while (true) delay(1000);
  }

  connectWifi();
  connectWebSocket();
}

/* ================= LOOP ================= */

void loop() {
  webSocket.loop();
  readGPS();

  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED)
    connectWifi();

  if (!webSocket.isConnected() &&
      WiFi.status() == WL_CONNECTED &&
      now - lastWebSocketConnectAttemptAt >= WS_CONNECT_INTERVAL_MS)
      connectWebSocket();

  if (webSocket.isConnected() &&
      now - lastTelemetryAt >= TELEMETRY_INTERVAL_MS) {

    lastTelemetryAt = now;
    sendTelemetry();
  }

  if (webSocket.isConnected() &&
      now - lastImageAt >= IMAGE_INTERVAL_MS) {

    lastImageAt = now;
    sendFrame();
  }
}

/* ================= CAMERA ================= */

bool initCamera() {

  camera_config_t config = {};

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

  config.frame_size = FRAMESIZE_VGA;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);

  if (err != ESP_OK) {
    Serial.printf("Camera init error: 0x%x\n", err);
    return false;
  }

  Serial.println("Camera started");
  return true;
}

/* ================= WIFI ================= */

void connectWifi() {

  if (WiFi.status() == WL_CONNECTED) return;

  Serial.printf("Connecting to WiFi: %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - start < 10000) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
  }
}

/* ================= WEBSOCKET ================= */

void connectWebSocket() {

  lastWebSocketConnectAttemptAt = millis();

  Serial.printf("Connecting WS: ws://%s:%u%s\n",
                WS_HOST, WS_PORT, WS_PATH);

  webSocket.begin(WS_HOST, WS_PORT, WS_PATH);
  webSocket.onEvent(onWebSocketEvent);
  webSocket.setReconnectInterval(3000);
}

/* ================= WEBSOCKET EVENTS ================= */

void onWebSocketEvent(WStype_t type,
                      uint8_t* payload,
                      size_t length) {

  if (type == WStype_CONNECTED)
    Serial.println("WebSocket connected");

  if (type == WStype_DISCONNECTED)
    Serial.println("WebSocket disconnected");
}

/* ================= CAMERA FRAME ================= */

void sendFrame() {

  camera_fb_t* frame = esp_camera_fb_get();

  if (!frame) {
    Serial.println("Camera capture failed");
    return;
  }

  webSocket.sendBIN(frame->buf, frame->len);

  esp_camera_fb_return(frame);
}

/* ================= TELEMETRY ================= */

void sendTelemetry() {

  String payload = buildTelemetryJson();

  webSocket.sendTXT(payload);

  Serial.println(payload);
}

/* ================= TELEMETRY JSON ================= */

String buildTelemetryJson() {

  String json;

  json += "{\"type\":\"telemetry\",\"buoyId\":\"";
  json += BUOY_ID;
  json += "\",\"gps\":\"";
  json += String(gpsLat,6);
  json += ",";
  json += String(gpsLon,6);
  json += "\",\"sats\":\"";
  json += gpsSats;
  json += "\",\"compass\":\"";
  json += readCompass();
  json += "\"}";

  return json;
}

/* ================= COMPASS ================= */

String readCompass() {
	compass.read();
	
	int a = compass.getAzimuth();
	int flippedAzimuth = 360 - a;
  if (flippedAzimuth >= 360) flippedAzimuth -= 360;

  return String(flippedAzimuth);
}

/* ================= GPS ================= */

void readGPS() {
  while (GPS.available()) {
    gps.encode(GPS.read());
  }
  
  if (gps.location.isUpdated()) {
    gpsLat = gps.location.lat();
    gpsLon = gps.location.lng();
    gpsSats = String(gps.satellites.value());
  }
}

