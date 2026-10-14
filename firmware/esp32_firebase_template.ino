/*
  ESP32 Water Quality Sender to Firebase Realtime Database

  Data flow:
  Sensor temperature, pH, DO -> ESP32 -> Wi-Fi -> Firebase -> Website dashboard

  Replace the sensor-reading functions with calibrated formulas from your actual sensors.
  Do not use the example pH/DO formulas for final research data without calibration.
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <time.h>

// =========================
// Wi-Fi configuration
// =========================
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// =========================
// Firebase configuration
// Example: https://your-project-id-default-rtdb.firebaseio.com
// Do not include trailing slash.
// =========================
const char* FIREBASE_HOST = "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com";

// For a quick internal prototype, you may leave FIREBASE_AUTH empty if your Firebase rules allow write access.
// For proper use, configure Firebase Authentication and put the database token here.
const char* FIREBASE_AUTH = "";

// =========================
// Pond metadata
// =========================
const char* POND_NAME = "Gourami";  // Catfish, Gourami, Nilem, Tilapia

// =========================
// Pin configuration
// Adjust based on your wiring.
// =========================
const int PH_PIN = 34;
const int DO_PIN = 35;
const int TEMP_PIN = 32;  // Placeholder if using analog temp sensor. DS18B20 needs a different library.

// Send interval. Use 900000 for 15 minutes. Use 5000 for testing.
const unsigned long SEND_INTERVAL_MS = 900000;
unsigned long lastSend = 0;

String authQuery() {
  if (String(FIREBASE_AUTH).length() == 0) return "";
  return String("?auth=") + FIREBASE_AUTH;
}

String isoTimestamp() {
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    return String(millis());
  }
  char buffer[32];
  strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S+07:00", &timeinfo);
  return String(buffer);
}

float readTemperature() {
  // Replace with calibrated sensor reading.
  int raw = analogRead(TEMP_PIN);
  float voltage = raw * 3.3 / 4095.0;
  float tempC = 25.0 + voltage * 3.0;  // placeholder only
  return tempC;
}

float readPH() {
  // Replace with your calibrated pH conversion.
  // Example placeholder formula. Final research data must use calibration buffer data.
  int raw = analogRead(PH_PIN);
  float voltage = raw * 3.3 / 4095.0;
  float ph = 7.0 + ((2.50 - voltage) / 0.18);
  return ph;
}

float readDO() {
  // Replace with calibrated DO conversion from your DO sensor manufacturer.
  // Example placeholder formula. Final research data must use calibration data.
  int raw = analogRead(DO_PIN);
  float voltage = raw * 3.3 / 4095.0;
  float dissolvedOxygen = voltage * 3.0;
  return dissolvedOxygen;
}

String makePayload(float temp, float ph, float dissolvedOxygen) {
  String payload = "{";
  payload += "\"timestamp\":\"" + isoTimestamp() + "\",";
  payload += "\"pond\":\"" + String(POND_NAME) + "\",";
  payload += "\"temp\":" + String(temp, 2) + ",";
  payload += "\"ph\":" + String(ph, 2) + ",";
  payload += "\"do\":" + String(dissolvedOxygen, 2);
  payload += "}";
  return payload;
}

bool sendToFirebase(const String& path, const String& payload, const String& method) {
  WiFiClientSecure client;
  client.setInsecure();  // For prototype. For production, use Firebase SSL certificate.

  HTTPClient https;
  String url = String(FIREBASE_HOST) + path + ".json" + authQuery();

  if (!https.begin(client, url)) {
    Serial.println("HTTPS begin failed");
    return false;
  }

  https.addHeader("Content-Type", "application/json");
  int code;
  if (method == "PUT") code = https.PUT(payload);
  else code = https.POST(payload);

  String response = https.getString();
  https.end();

  Serial.print(method);
  Serial.print(" ");
  Serial.print(path);
  Serial.print(" -> HTTP ");
  Serial.println(code);
  Serial.println(response);

  return code >= 200 && code < 300;
}

void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected. IP: ");
  Serial.println(WiFi.localIP());
}

void setupTime() {
  // Indonesia WIB = UTC+7. NTP is used so timestamp is readable by the dashboard.
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  connectWiFi();
  setupTime();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  if (millis() - lastSend >= SEND_INTERVAL_MS || lastSend == 0) {
    lastSend = millis();

    float temp = readTemperature();
    float ph = readPH();
    float dissolvedOxygen = readDO();
    String payload = makePayload(temp, ph, dissolvedOxygen);

    // latest: used by dashboard live card
    sendToFirebase("/readings/latest", payload, "PUT");

    // history: used for storing time-series data
    sendToFirebase("/readings/history", payload, "POST");
  }
}
