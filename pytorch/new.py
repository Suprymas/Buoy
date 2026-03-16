import cv2
import numpy as np
from inference import get_model

# --- CONFIGURATION ---
ROBOFLOW_API_KEY = "Xd3fGjPQkJQf1JtSLqJN"
MODEL_ID = "cloud-master-1.1/1"

model = get_model(model_id=MODEL_ID, api_key=ROBOFLOW_API_KEY)


def calculate_direction_with_cloud_master(img_path1, img_path2):
    img1 = cv2.imread(img_path1)
    img2 = cv2.imread(img_path2)
    if img1 is None or img2 is None:
        return f"Error: image not found"

    h, w = img1.shape[:2]

    # ── 1. CLOUD MASK via Roboflow ────────────────────────────────────────────
    results = model.infer(img1, confidence=0.4)[0]
    print(f"--- DEBUG: Found {len(results.predictions)} cloud objects ---")

    cloud_mask = np.zeros((h, w), dtype=np.uint8)
    for prediction in results.predictions:
        if hasattr(prediction, "points") and prediction.points:
            points = np.array([[p.x, p.y] for p in prediction.points], dtype=np.int32)
            cv2.fillPoly(cloud_mask, [points], 255)
        else:
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

    if not np.any(cloud_mask):
        return "Model did not detect any clouds."

    cv2.imwrite("cloud_mask.jpg", cloud_mask)

    # ── 2. OPTICAL FLOW ───────────────────────────────────────────────────────
    gray1 = cv2.GaussianBlur(cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY), (7, 7), 0)
    gray2 = cv2.GaussianBlur(cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY), (7, 7), 0)
    flow = cv2.calcOpticalFlowFarneback(gray1, gray2, None, 0.5, 3, 101, 3, 5, 1.2, 0)

    fx = flow[..., 0]  # positive = moving RIGHT
    fy = flow[..., 1]  # positive = moving DOWN
    mag = np.sqrt(fx**2 + fy**2)

    # ── 3. KEY  ONLY USE PIXELS WITH REAL MOTION ─────────────────────────
    # Optical flow assigns tiny non-zero values everywhere (noise).
    # We only trust the top 10% of movers WITHIN the cloud mask.
    # This eliminates noise that corrupts the median/mean.
    cloud_mags = mag[cloud_mask > 0]
    if len(cloud_mags) == 0:
        return "Cloud mask empty after filtering."

    motion_threshold = np.percentile(cloud_mags, 90)  # top 10% of cloud pixels
    # Also require an absolute minimum to reject near-zero noise
    motion_threshold = max(motion_threshold, 0.3)

    final_mask = (mag > motion_threshold) & (cloud_mask > 0)

    if not np.any(final_mask):
        # Fallback: use all cloud pixels if threshold was too aggressive
        final_mask = (mag > 0.05) & (cloud_mask > 0)

    if not np.any(final_mask):
        return "Clouds found, but no meaningful movement detected."

    print(
        f"--- DEBUG: Using {final_mask.sum()} pixels for direction (motion threshold={motion_threshold:.3f}) ---"
    )

    # ── 4. CORRECT ANGLE CALCULATION ─────────────────────────────────────────
    # WRONG: np.median(ang) - circular data median is meaningless
    # RIGHT: average the X and Y flow components, then compute angle once
    weights = mag[final_mask]
    masked_fx = fx[final_mask]
    masked_fy = fy[final_mask]

    # Weighted average of actual motion vectors
    mean_x = np.average(masked_fx, weights=weights)
    mean_y = np.average(masked_fy, weights=weights)

    dominant_angle_deg = np.degrees(np.arctan2(mean_y, mean_x)) % 360

    avg_speed = np.mean(weights)
    print(
        f"--- DEBUG: Mean flow X={mean_x:.3f} (+ = right), Y={mean_y:.3f} (+ = down) ---"
    )
    print(f"--- DEBUG: Avg cloud speed = {avg_speed:.3f} px/frame ---")

    # ── 5. DIAGNOSTIC IMAGE ───────────────────────────────────────────────────
    diagnostic_img = img1.copy()
    diagnostic_img[~final_mask] = (diagnostic_img[~final_mask] * 0.3).astype(
        np.uint8
    )  # dim non-tracked areas

    # Draw direction arrow
    cx, cy = w // 2, h // 2
    rad = np.radians(dominant_angle_deg)
    length = 150
    ex = int(cx + length * np.cos(rad))
    ey = int(cy + length * np.sin(rad))
    cv2.arrowedLine(diagnostic_img, (cx, cy), (ex, ey), (0, 255, 0), 5, tipLength=0.3)

    # Label
    label = f"{dominant_angle_deg:.1f} deg  |  0=Right 90=Down 180=Left 270=Up"
    cv2.putText(
        diagnostic_img, label, (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2
    )

    cv2.imwrite("tracking_diagnostic.jpg", diagnostic_img)
    print("Saved tracking_diagnostic.jpg")

    return dominant_angle_deg


# --- EXECUTION ---
heading = calculate_direction_with_cloud_master(
    "images/Image15.png", "images/Image16.png"
)

if isinstance(heading, (int, float)):
    print(f"\nCloud-Master Heading: {heading:.2f} degrees")
    print(f"  0° = Right  |  90° = Down  |  180° = Left  |  270° = Up")
else:
    print(f"Result: {heading}")
