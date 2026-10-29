import unittest

from server.inference.signal_observation import observe_signal


def image_with_color(width, height, color=(0, 0, 0)):
    return [[color for _ in range(width)] for _ in range(height)]


class ObserveSignalImageTests(unittest.TestCase):
    def test_counts_pixels_only_inside_configured_crop(self):
        image = image_with_color(20, 20)
        region = {"x": 0.25, "y": 0.25, "width": 0.5, "height": 0.5}
        # Red pixels outside the configured crop must not influence the score.
        for row in range(5):
            for column in range(5):
                image[row][column] = (0, 0, 255)
        # 20 red pixels inside a 10x10 crop produce a 0.2 leading-color ratio.
        for row in range(6, 10):
            for column in range(6, 11):
                image[row][column] = (0, 0, 255)

        result = observe_signal(image, region)

        self.assertEqual(result["colorScores"], {"red": 0.2, "yellow": 0.0, "green": 0.0})

    def test_uses_saturated_hsv_ranges_for_all_lamp_colors(self):
        image = image_with_color(9, 3)
        colors = [(0, 0, 255), (0, 255, 255), (0, 255, 0)]  # BGR red, yellow, green.
        for column, color in enumerate(colors):
            for row in range(3):
                image[row][column * 3:column * 3 + 3] = [color] * 3

        result = observe_signal(image, {"x": 0, "y": 0, "width": 1, "height": 1})

        self.assertEqual(result["colorScores"], {"red": 0.333333, "yellow": 0.333333, "green": 0.333333})

    def test_ignores_unsaturated_and_too_dim_pixels(self):
        image = image_with_color(6, 3, color=(80, 80, 80))
        for row in range(3):
            image[row][3:] = [(0, 0, 80)] * 3

        result = observe_signal(image, {"x": 0, "y": 0, "width": 1, "height": 1})

        self.assertEqual(result["colorScores"], {"red": 0.0, "yellow": 0.0, "green": 0.0})

    def test_reports_too_small_crop_without_claiming_pixel_evidence(self):
        image = image_with_color(10, 10, color=(0, 0, 255))

        result = observe_signal(image, {"x": 0, "y": 0, "width": 0.2, "height": 0.2})

        self.assertEqual(result, {
            "signalRegionTooSmall": True,
            "colorScores": {"red": 0.0, "yellow": 0.0, "green": 0.0},
        })


if __name__ == "__main__":
    unittest.main()
