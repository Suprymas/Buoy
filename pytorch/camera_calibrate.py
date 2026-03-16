import numpy as np
import cv2
import glob

# ==========================================
# CONFIGURATION
# ==========================================
# Number of INSIDE corners on your chessboard
# If your board is 7x9 squares, the internal corners are 6x8
CHECKERBOARD = (6, 8)
# The path to your images (e.g., "calibration_images/*.jpg")
IMAGE_PATH = "imagesCal/*.jpg"

# Stop criteria for refining corner detection
criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001)

# Prepare object points (0,0,0), (1,0,0), (2,0,0) ... (6,7,0)
objp = np.zeros((CHECKERBOARD[0] * CHECKERBOARD[1], 3), np.float32)
objp[:, :2] = np.mgrid[0 : CHECKERBOARD[0], 0 : CHECKERBOARD[1]].T.reshape(-1, 2)

objpoints = []  # 3d point in real world space
imgpoints = []  # 2d points in image plane

images = glob.glob(IMAGE_PATH)

if not images:
    print("No images found! Check your IMAGE_PATH.")
    exit()

for fname in images:
    img = cv2.imread(fname)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Find the chess board corners
    ret, corners = cv2.findChessboardCorners(gray, CHECKERBOARD, None)

    if ret:
        objpoints.append(objp)

        # Refine the pixel coordinates for better accuracy
        corners2 = cv2.cornerSubPix(gray, corners, (11, 11), (-1, -1), criteria)
        imgpoints.append(corners2)

        # Draw and display the corners to verify
        cv2.drawChessboardCorners(img, CHECKERBOARD, corners2, ret)
        cv2.imshow("Calibration Check", img)
        cv2.waitKey(100)

cv2.destroyAllWindows()

# ==========================================
# CALCULATE CALIBRATION
# ==========================================
ret, mtx, dist, rvecs, tvecs = cv2.calibrateCamera(
    objpoints, imgpoints, gray.shape[::-1], None, None
)

print("\n--- Calibration Results ---")
print("\nCamera Matrix (K):")
print(mtx)
print("\nDistortion Coefficients (D):")
print(dist)

# Save the results to a file
np.savez("calibration_data.npz", mtx=mtx, dist=dist)
print("\nResults saved to calibration_data.npz")


img = cv2.imread("./test.jpg")
h, w = img.shape[:2]

# Refine the camera matrix for the specific image size
new_mtx, roi = cv2.getOptimalNewCameraMatrix(mtx, dist, (w, h), 1, (w, h))

# Undistort
dst = cv2.undistort(img, mtx, dist, None, new_mtx)

# Crop the result (undistorting creates black edges)
x, y, w, h = roi
dst = dst[y : y + h, x : x + w]
cv2.imwrite("calibrated_result.png", dst)
