from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase

from verein.contact_management.doctype.network.network import (
	add_supporters,
	get_linked_supporters,
	remove_supporter,
)
from verein.contact_management.page.geo_radius_search.geo_radius_search import search_records


class TestNetwork(FrappeTestCase):
	def test_network_address_creates_generic_geocoding_job(self):
		network = make_network(
			address_line_1="Alexanderplatz 1",
			city="Berlin",
			postal_code="10178",
			country="Germany",
		)

		job_name = frappe.db.get_value(
			"Geocoding Job",
			{"reference_doctype": "Network", "reference_name": network.name},
			"name",
		)
		self.assertTrue(job_name)

	def test_linked_supporters_can_be_added_and_removed_from_network(self):
		network = make_network()
		supporter = make_supporter()

		add_supporters(network.name, [supporter.name])
		self.assertTrue(
			frappe.db.exists("Supporter Network", {"parent": supporter.name, "network": network.name})
		)
		self.assertEqual([row["name"] for row in get_linked_supporters(network.name)], [supporter.name])

		remove_supporter(network.name, supporter.name)
		self.assertFalse(
			frappe.get_all("Supporter Network", filters={"parent": supporter.name, "network": network.name})
		)

	def test_network_radius_search_respects_doctype_filters(self):
		matching_type = f"Test Network Type {frappe.generate_hash(length=6)}"
		other_type = f"Other Test Network Type {frappe.generate_hash(length=6)}"
		if not frappe.db.exists("Network Type", matching_type):
			frappe.get_doc({"doctype": "Network Type", "type_name": matching_type}).insert()
		if not frappe.db.exists("Network Type", other_type):
			frappe.get_doc({"doctype": "Network Type", "type_name": other_type}).insert()

		matching = make_network(
			network_name="Nearby Network",
			type=matching_type,
			latitude=52.5200,
			longitude=13.4050,
		)
		matching.save()

		wrong_type = make_network(
			network_name="Wrong Type Network",
			type=other_type,
			latitude=52.5210,
			longitude=13.4060,
		)
		wrong_type.save()

		too_far = make_network(
			network_name="Far Away Network",
			type=matching_type,
			latitude=48.1371,
			longitude=11.5754,
		)
		too_far.save()

		results = search_records(
			search_doctype="Network",
			latitude=52.5200,
			longitude=13.4050,
			radius_km=10,
			filters=[["type", "=", matching_type]],
		)

		self.assertEqual([row["name"] for row in results], [matching.name])
		self.assertEqual(results[0]["latitude"], 52.52)
		self.assertEqual(results[0]["longitude"], 13.405)

	def test_network_radius_search_accepts_direct_network_type_filter(self):
		matching_type = f"Direct Filter Type {frappe.generate_hash(length=6)}"
		other_type = f"Other Direct Filter Type {frappe.generate_hash(length=6)}"
		for type_name in (matching_type, other_type):
			if not frappe.db.exists("Network Type", type_name):
				frappe.get_doc({"doctype": "Network Type", "type_name": type_name}).insert()

		matching = make_network(
			network_name="Typed Nearby Network",
			type=matching_type,
			latitude=52.5200,
			longitude=13.4050,
		)
		matching.save()

		wrong_type = make_network(
			network_name="Typed Wrong Network",
			type=other_type,
			latitude=52.5205,
			longitude=13.4055,
		)
		wrong_type.save()

		results = search_records(
			search_doctype="Network",
			latitude=52.5200,
			longitude=13.4050,
			radius_km=10,
			network_type=matching_type,
		)

		self.assertEqual([row["name"] for row in results], [matching.name])


def make_network(**overrides):
	type_name = ensure_network_type()
	values = {
		"doctype": "Network",
		"network_name": f"Network {frappe.generate_hash(length=6)}",
		"type": type_name,
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def make_supporter(**overrides):
	values = {
		"doctype": "Supporter",
		"first_name": "Network",
		"last_name": frappe.generate_hash(length=6),
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def ensure_network_type() -> str:
	name = "Test Network Type"
	if not frappe.db.exists("Network Type", name):
		frappe.get_doc({"doctype": "Network Type", "type_name": name}).insert()
	return name
