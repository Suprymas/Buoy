# Buoy system

This repository is meant for Bouy devices which measure windspeed, direction, track gps and take pictures. The idea is that there could be several bouys which would predict upcoming wind changes. This would help autonomous sailing boats pick better routes.

## Project contents

In the [internal](./internal/) folder you will find the Golang code for the main web server. The purpose of this server is to gather data from mulitple bouys. It would host a websocket server and allow bouys to send that data though it.


In the [esp32](./esp32/) folder you will find [esp_32_boey.ino](./esp32/esp32_boey.ino) which should be uploaded to each bouy. **It is important to change the bouy Id before uploading the code**.

**Device used: [Seeed Studio XIAO ESP32-S3 Sense](https://wiki.seeedstudio.com/xiao_esp32s3_getting_started/)**


In the [frontend](./frontend/) a simple React dashboard to display the latest datas from the Bouys. A map which displays the buoys and the latest images from them.

In [migrations](./migrations/) folder you will find the schema of the **Timescaledb**.

### **WIP:**
In [pytorch](./pytorch/) folder stuff was started to begin using OpenCV and YOLO to predict the cloud movements. This is yet to be finished. 


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
docker build -t bouy-image .
```
And then run:
```sh
docker compose up
```