#include "esp_camera.h"
#include "FS.h"
#include "SD.h"
#include "SPI.h"
#include "WiFi.h"
#include "WebServer.h"

// --- WiFi Credentials ---
const char* ssid = "Internetas";
const char* password = "12345678";

#define CAMERA_MODEL_XIAO_ESP32S3
#include "camera_pins.h"

WebServer server(80);
unsigned long lastCaptureTime = 0; 
int imageCount = 1;                
bool camera_sign = false;          
bool sd_sign = false;              

// --- Web Server Handlers ---

// This sends the HTML page to your browser
void handleRoot() {
  String html = "<html><head><meta name='viewport' content='width=device-width, initial-scale=1.0'>";
  html += "<title>XIAO ESP32S3 Sense</title></head><body style='text-align:center; font-family:sans-serif;'>";
  html += "<h1>Live 640x480 View</h1>";
  html += "<img id='stream' src='/capture' style='width:640px; max-width:100%; height:auto; border:2px solid #333;'>";
  html += "<p>Updating every second...</p>";
  // JavaScript to refresh the image every 1000ms
  html += "<script>setInterval(function(){ document.getElementById('stream').src='/capture?t='+new Date().getTime(); }, 1000);</script>";
  html += "</body></html>";
  server.send(200, "text/html", html);
}

// This captures a fresh frame and sends it to the browser
void handleCapture() {
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "text/plain", "Camera Capture Failed");
    return;
  }
  server.sendHeader("Content-Type", "image/jpeg");
  server.sendContent((const char *)fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

// --- SD Card Function ---
void writeFile(fs::FS &fs, const char * path, uint8_t * data, size_t len){
    File file = fs.open(path, FILE_WRITE);
    if(!file) return;
    file.write(data, len);
    file.close();
}

void photo_save(const char * fileName) {
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return;
  writeFile(SD, fileName, fb->buf, fb->len);
  esp_camera_fb_return(fb);
}

void setup() {
  Serial.begin(115200);

  // 1. Camera Configuration
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM; config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM; config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM; config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM; config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_VGA; // Set to 640x480
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 12;
  config.fb_count = 1;

  if (psramFound()) {
    config.fb_count = 2;
    config.grab_mode = CAMERA_GRAB_LATEST;
  }

  if (esp_camera_init(&config) == ESP_OK) camera_sign = true;

  // 2. SD Card (using your working logic)
  if(SD.begin(21)) {
    sd_sign = true;
    Serial.println("SD Card Mounted!");
  }

  // 3. WiFi Setup
  WiFi.begin(ssid, password);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
  Serial.print("IP Address: http://");
  Serial.println(WiFi.localIP());

  // 4. Server Routes
  server.on("/", handleRoot);
  server.on("/capture", handleCapture);
  server.begin();
}

void loop() {
  server.handleClient(); // Handle web browser requests

  if(camera_sign && sd_sign){
    unsigned long now = millis();
    // Save to SD every 60 seconds
    if ((now - lastCaptureTime) >= 60000) {
      char filename[32];
      sprintf(filename, "/image%d.jpg", imageCount);
      photo_save(filename);
      Serial.printf("Saved to SD: %s\n", filename);
      imageCount++;
      lastCaptureTime = now;
    }
  }
}
