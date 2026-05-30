import numpy as np
from skimage.measure import approximate_polygon
from typing import List


def simplify_polygon(points: List[List[float]], epsilon: float = 1.0, max_points: int = 20) -> List[List[float]]:
    if len(points) <= 3:
        return points

    points_array = np.array(points)

    try:
        simplified = approximate_polygon(points_array, tolerance=epsilon)

        while len(simplified) > max_points and epsilon < 10:
            epsilon *= 1.5
            simplified = approximate_polygon(points_array, tolerance=epsilon)

        if len(simplified) > max_points:
            indices = np.linspace(0, len(simplified) - 1, max_points, dtype=int)
            simplified = simplified[indices]

        if not np.array_equal(simplified[0], simplified[-1]):
            simplified = np.vstack([simplified, simplified[0]])

        return simplified.tolist()
    except Exception as e:
        print(f"Ошибка при упрощении полигона: {e}")

        if len(points) > max_points:
            indices = np.linspace(0, len(points) - 1, max_points - 1, dtype=int)
            simplified = [points[i] for i in indices]
            simplified.append(simplified[0])
            return simplified
        return points


def convert_mask_to_polygon(mask: List[List[float]], img_width: int, img_height: int) -> List[List[float]]:
    percent_contours = []
    for point in mask:
        x_percent = (point[0] / img_width) * 100
        y_percent = (point[1] / img_height) * 100
        percent_contours.append([x_percent, y_percent])
    
    return percent_contours
