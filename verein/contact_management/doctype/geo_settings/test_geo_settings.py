import frappe
from frappe.tests.utils import FrappeTestCase

from verein.contact_management.doctype.geo_settings.geo_settings import get_map_defaults


class TestGeoSettings(FrappeTestCase):
	def test_get_map_defaults_returns_configured_values(self):
		settings = frappe.get_single("Geo Settings")
		settings.default_map_latitude = 52.52
		settings.default_map_longitude = 13.405
		settings.default_map_zoom = 9
		settings.save()

		self.assertEqual(
			get_map_defaults(),
			{"latitude": 52.52, "longitude": 13.405, "zoom": 9},
		)

	def test_get_map_defaults_uses_germany_fallback(self):
		frappe.db.set_single_value("Geo Settings", "default_map_latitude", "")
		frappe.db.set_single_value("Geo Settings", "default_map_longitude", "")
		frappe.db.set_single_value("Geo Settings", "default_map_zoom", "")

		self.assertEqual(
			get_map_defaults(),
			{"latitude": 51.1657, "longitude": 10.4515, "zoom": 6},
		)
