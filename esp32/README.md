# ESP32

## Name

Change the BUOY_ID of each buoy so that each one has a unique ID and they do not overlap.

```
static const char* BUOY_ID = "buoy-01";
```

## Wi-Fi hotspot

The ESP32 needs to connect to a Wi-Fi hotspot to send data. To set that up, WIFI_SSID and WIFI_PASSWORD should be changed to the SSID and password of your hotspot.

```
static const char* WIFI_SSID = "Internetas";
static const char* WIFI_PASSWORD = "12345678";
```

## Websocket

The ESP32 sends data to a WebSocket at an IP address defined by WS_HOST. Change that IP address to the address of your WebSocket.

```
static const char* WS_HOST = "10.249.211.51";
```
