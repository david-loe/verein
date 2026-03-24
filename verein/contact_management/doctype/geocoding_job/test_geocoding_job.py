from __future__ import annotations

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from verein.contact_management.doctype.geocoding_job.geocoding_job import get_nested_value
from verein.contact_management.utils import enqueue_geocoding_job


class TestGeocodingJob(FrappeTestCase):
	def test_get_nested_value_supports_lists_and_dicts(self):
		payload = {"results": [{"location": {"lat": "52.5", "lng": "13.4"}}]}
		self.assertEqual(get_nested_value(payload, "results.0.location.lat"), "52.5")
		self.assertIsNone(get_nested_value(payload, "results.3.location.lat"))

	def test_generic_job_updates_network_coordinates(self):
		network = make_network(
			address_line_1="Alexanderplatz 1",
			city="Berlin",
			postal_code="10178",
			country="Germany",
		)
		job = frappe.get_doc(
			{
				"doctype": "Geocoding Job",
				"reference_doctype": "Network",
				"reference_name": network.name,
			}
		).insert()

		settings = frappe._dict(
			{
				"url": "https://example.test?q={{ address_line_1 }}",
				"lat_param": "result.lat",
				"lon_param": "result.lon",
				"headers": None,
			}
		)

		with patch(
			"verein.contact_management.doctype.geocoding_job.geocoding_job.requests.get",
			return_value=MockResponse({"result": {"lat": 52.5200, "lon": 13.4050}}),
		):
			cast_job = frappe.get_doc("Geocoding Job", job.name)
			cast_job.run(settings)

		network.reload()
		self.assertEqual(network.latitude, 52.52)
		self.assertEqual(network.longitude, 13.405)
		self.assertEqual(cast_job.status, "Completed")

	def test_supporter_jobs_use_reference_name_only(self):
		supporter = frappe.get_doc(
			{
				"doctype": "Supporter",
				"first_name": "Legacy",
				"last_name": frappe.generate_hash(length=6),
			}
		).insert()
		enqueue_geocoding_job("Supporter", supporter.name)

		jobs = frappe.get_all(
			"Geocoding Job",
			filters={"reference_doctype": "Supporter", "reference_name": supporter.name},
			fields=["name", "reference_doctype", "reference_name"],
		)
		self.assertEqual(len(jobs), 1)
		self.assertEqual(jobs[0].reference_doctype, "Supporter")
		self.assertEqual(jobs[0].reference_name, supporter.name)


class MockResponse:
	def __init__(self, payload):
		self.payload = payload

	def raise_for_status(self):
		return None

	def json(self):
		return self.payload


def make_network(**overrides):
	type_name = ensure_network_type()
	values = {
		"doctype": "Network",
		"network_name": f"Network {frappe.generate_hash(length=6)}",
		"type": type_name,
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def ensure_network_type() -> str:
	name = "Test Network Type"
	if not frappe.db.exists("Network Type", name):
		frappe.get_doc({"doctype": "Network Type", "type_name": name}).insert()
	return name
