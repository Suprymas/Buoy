import cv2
import numpy as np
from inference import get_model

# --- CONFIGURATION ---
# Replace with your actual Roboflow API Key
ROBOFLOW_API_KEY = "Xd3fGjPQkJQf1JtSLqJN"
MODEL_ID = "cloud-master-1.1/1"  # This matches the link you provided

# Load the cloud-specific model
model = get_model(model_id=MODEL_ID, api_key=ROBOFLOW_API_KEY)


def calculate_direction_with_cloud_master(img_path1, img_path2):
    img1 = cv2.imread(img_path1)
    img2 = cv2.imread(img_path2)
    if img1 is None:
        return f"Error: {img_path1} not found"

    # 1. Get Detections and PRINT the raw response
    # We set confidence very low (0.05) just to see if it catches ANYTHING
    results = model.infer(img1, confidence=0.4)[0]

    print(f"--- DEBUG: Found {len(results.predictions)} objects ---")

    # 2. DRAW BOXES MANUALLY (Reliable)
    # 2. Create the Pixel-Perfect Mask
    h, w = img1.shape[:2]
    cloud_mask = np.zeros((h, w), dtype=np.uint8)

    for prediction in results.predictions:
        # Check if 'points' exist (this is the segmentation data)
        if hasattr(prediction, "points") and prediction.points:
            # Convert the list of points to a NumPy array for OpenCV
            points = np.array([[p.x, p.y] for p in prediction.points], dtype=np.int32)

            # Fill the actual shape of the cloud with white
            cv2.fillPoly(cloud_mask, [points], 255)
        else:
            # Fallback to Box if segmentation data isn't in this specific result
            x, y, bw, bh = (
                prediction.x,
                prediction.y,
                prediction.width,
                prediction.height,
            )
            cv2.rectangle(
                cloud_mask,
                (int(x - bw / 2), int(y - bh / 2)),
                (int(x + bw / 2), int(y + bh / 2)),
                255,
                -1,
            )

    cv2.imwrite("cloud_master_mask_PERFECT.jpg", cloud_mask)

    # 3. Create the Mask
    h, w = img1.shape[:2]
    cloud_mask = np.zeros((h, w), dtype=np.uint8)

    for prediction in results.predictions:
        # Roboflow sometimes returns 'x, y' as center points
        x, y, width, height = (
            prediction.x,
            prediction.y,
            prediction.width,
            prediction.height,
        )
        x1, y1 = int(x - width / 2), int(y - height / 2)
        x2, y2 = int(x + width / 2), int(y + height / 2)
        cv2.rectangle(cloud_mask, (x1, y1), (x2, y2), 255, -1)

    if not np.any(cloud_mask):
        return "Model did not detect any clouds. Check debug_detections.jpg"

    # 4. Standard Optical Flow Math
    gray1 = cv2.GaussianBlur(cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY), (7, 7), 0)
    gray2 = cv2.GaussianBlur(cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY), (7, 7), 0)
    flow = cv2.calcOpticalFlowFarneback(gray1, gray2, None, 0.5, 3, 101, 3, 5, 1.2, 0)

    mag, ang = cv2.cartToPolar(flow[..., 0], flow[..., 1])

    if np.any(cloud_mask > 0):
        avg_speed = np.mean(mag[cloud_mask > 0])
        print(f"--- DEBUG: Clouds are moving at {avg_speed:.4f} pixels per frame ---")

    final_mask = (mag > 0.001) & (cloud_mask > 0)

    if not np.any(final_mask):
        return "Clouds found, but no movement detected within them."

    # dominant_angle_rad = np.median(ang[final_mask])
    # return np.rad2deg(dominant_angle_rad) % 360

    weights = mag[final_mask]
    angles = ang[final_mask]
    # Weighted Circular Mean
    mean_sin = np.average(np.sin(angles), weights=weights)
    mean_cos = np.average(np.cos(angles), weights=weights)

    dominant_angle_deg = np.degrees(np.arctan2(mean_sin, mean_cos)) % 360

    diagnostic_img = img1.copy()

    # Where final_mask is False, set pixel to black
    diagnostic_img[~final_mask] = [0, 0, 0]

    # 2. Draw a big arrow showing the 'Dominant Direction' (the 160°)
    center_x, center_y = w // 2, h // 2
    # Calculate end point of the arrow (length 100 pixels)
    rad = np.radians(dominant_angle_deg)
    end_x = int(center_x + 100 * np.cos(rad))
    end_y = int(center_y + 100 * np.sin(rad))

    cv2.arrowedLine(
        diagnostic_img, (center_x, center_y), (end_x, end_y), (0, 255, 0), 5
    )

    # 3. Save it
    cv2.imwrite("tracking_diagnostic.jpg", diagnostic_img)
    print(
        "Check 'tracking_diagnostic.jpg' to see the tracked pixels and direction arrow."
    )
    # angles = ang[final_mask]
    # mean_sin = np.mean(np.sin(angles))
    # mean_cos = np.mean(np.cos(angles))
    # dominant_angle_deg = np.degrees(np.arctan2(mean_sin, mean_cos)) % 360
    return dominant_angle_deg


# --- EXECUTION ---
heading = calculate_direction_with_cloud_master("Image19.png", "Image20.png")
if isinstance(heading, (int, float)):
    print(f"Cloud-Master Heading: {heading:.2f} degrees")
else:
    # This will print: "Cloud-Master found no clouds in this frame."
    print(f"Result: {heading}")

