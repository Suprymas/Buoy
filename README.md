# Buoy system

This repository contains the codebase for the Buoy project, which is designed to monitor environmental conditions and predict upcoming wind shifts. The primary goal is to provide this information to sailing vessels, allowing them to anticipate changes in wind direction and optimize their routes accordingly.

Each buoy is built around the XIAO ESP32S3 platform and integrates several key components. A GPS module is used to determine the precise location of each buoy, enabling accurate mapping and tracking. A compass sensor provides orientation data, allowing the system to infer wind direction based on how the buoy is positioned relative to external forces. Additionally, a wind speed sensor measures real-time wind intensity, giving further context to the environmental conditions.

The ESP32S3’s onboard camera is used to stream a live visual feed from the buoy. This visual data plays an important role in the project’s core idea: analyzing cloud movement to predict wind shifts. By observing the direction and behavior of clouds over time, the system attempts to estimate how wind patterns are likely to change in the near future.

Currently, all collected data is transmitted to a central web server, where it is processed and made accessible through a web application built with React. The application provides a real-time interface for interacting with the system: users can view live camera feeds from each buoy, monitor sensor data streams, and observe buoy positions on a map along with their current orientation. Additionally, a live logging interface displays incoming data from the buoys, allowing for debugging and monitoring.

## Project contents

In the [internal](./internal/) folder you will find the Golang code for the main web server. The purpose of this server is to gather data from multiple buoys. It would host a Web socket server and allow buoys to send that data though it.


In the [esp32](./esp32/) folder you will find [esp_32_boey.ino](./esp32/esp32_boey.ino) which should be uploaded to each buoy. **It is important to change the buoy Id before uploading the code**.

**Device used: [Seeed Studio XIAO ESP32-S3 Sense](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)**


In the [frontend](./frontend/) a simple React dashboard to display the latest datas from the Buoys. A map which displays the buoys and the latest images from them.

In [migrations](./migrations/) folder you will find the schema of the **Timescaledb**.

In [3d models](./3d%20models) folder you will find models for 3d printing the physical buoy itself in .STL, .STEP and .SLDPRT formats.

### **WIP:**
In [imageProcessing](./imageProcessing/) folder stuff was started to begin using OpenCV and YOLO to predict the cloud movements. This is yet to be finished. 


## Docker environment

You will find the [Dockerfile](./Dockerfile) meant to create an image for the web server. And also a [docker compose](./docker-compose.yml) file where the required services are configured.

## Start the project

**!!! Important**
> When you have your Esp ready. Change the Wifi and password to connect to your wifi. To run this project properly. The machine running the websocket server and Esp **must** be on the same network. Also don't forget in the Esp code to declare the address of Websocket server!

Clone the repository

Then create an .env file and copy this into it:
```txt
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=admin
MINIO_SECRET_KEY=password123
DB_USER=postgres
DB_PASSWORD=password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=buoydb
```

Build the image:
```sh
docker build -t buoy-image .
```
And then run:
```sh
docker compose up
```

Then you should start turn on the ESP32 and they should connect to the server if they are on the same wifi.
Open http://localhost:5173 and there you should see the working buoy dashboard (Web app).
If you wish to see the images stored open http://localhost:9001.
## Web app

### Dashboard

<img width="1102" height="826" alt="dashboard" src="https://github.com/user-attachments/assets/d1cb1673-9f1f-4581-ba8d-591b0ffb8b45" />


You can see the buoy name, live camera feed, GPS longitude and latitude, satellite count, and compass readings.

### Map

<img width="1109" height="665" alt="map" src="https://github.com/user-attachments/assets/41bd2439-39e8-4c44-aa6e-ebce305c6739" />

You can see a map on which all buoys are placed. The arrow indicates the wind direction of each buoy.

### Logs

<img width="1094" height="697" alt="image" src="https://github.com/user-attachments/assets/b46abe69-0a02-4cc8-a155-ed3d399da1b3" />

You can see the live feed of all data sent from buoys.


## Troubleshooting

### ESP32 is not connecting to server.

Prefer using your phone as a hotspot instead of Eduroam or other more complex networks. When you are sharing from you phone
enable 2.4Ghz and disable Wifi6. The Esp32 wifi capabilities are not that powerfull.
Also check if you changed ssid and the password in [./esp32/esp32_boey.ino](./esp32/esp32_boey.ino) lines 44-45.
Sometimes there could be some problems that Esp32 doesn't connect on first try to the wifi try waiting for few minutes.



