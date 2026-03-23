from __future__ import annotations

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase

from verein.contact_management.doctype.supporter.supporter import get_full_name
from verein.contact_management.page.geo_radius_search.geo_radius_search import (
	export_records,
	search_records,
)


class TestSupporter(FrappeTestCase):
	def test_full_name_is_computed(self):
		supporter = make_supporter(first_name="Ada", last_name="Lovelace")
		self.assertEqual(supporter.full_name, get_full_name("Ada", "Lovelace"))

	def test_spouse_link_is_synced_bidirectionally(self):
		left = make_supporter(first_name="Left")
		right = make_supporter(first_name="Right")

		left.spouse = right.name
		left.save()

		self.assertEqual(frappe.get_doc("Supporter", right.name).spouse, left.name)

		left.spouse = None
		left.save()

		self.assertIsNone(frappe.get_doc("Supporter", right.name).spouse)

	def test_spouse_conflict_is_rejected(self):
		first = make_supporter(first_name="First")
		second = make_supporter(first_name="Second")
		third = make_supporter(first_name="Third")

		first.spouse = second.name
		first.save()

		third.spouse = second.name
		with self.assertRaises(frappe.ValidationError):
			third.save()

	def test_duplicate_relationship_rows_are_rejected(self):
		network = make_network()
		experience = make_experience()
		supporter = make_supporter(first_name="Duplicate")

		supporter.append("networks", {"network": network.name})
		supporter.append("networks", {"network": network.name})
		with self.assertRaises(frappe.ValidationError):
			supporter.save()

		supporter.reload()
		supporter.set("networks", [])
		supporter.append("experiences", {"experience": experience.name})
		supporter.append("experiences", {"experience": experience.name})
		with self.assertRaises(frappe.ValidationError):
			supporter.save()

	def test_supporter_radius_search_combines_network_and_experience_filters(self):
		matching_network = make_network(network_name="Matching Network")
		other_network = make_network(network_name="Other Network")
		matching_experience = make_experience(experience_name="Matching Experience")
		other_experience = make_experience(experience_name="Other Experience")

		matching = make_supporter(first_name="Match", latitude=52.5200, longitude=13.4050)
		matching.append("networks", {"network": matching_network.name})
		matching.append("experiences", {"experience": matching_experience.name})
		matching.save()

		wrong_relation = make_supporter(
			first_name="Wrong Relation", latitude=52.5210, longitude=13.4060
		)
		wrong_relation.append("networks", {"network": other_network.name})
		wrong_relation.append("experiences", {"experience": matching_experience.name})
		wrong_relation.save()

		too_far = make_supporter(first_name="Too Far", latitude=48.1371, longitude=11.5754)
		too_far.append("networks", {"network": matching_network.name})
		too_far.append("experiences", {"experience": matching_experience.name})
		too_far.save()

		wrong_experience = make_supporter(
			first_name="Wrong Experience", latitude=52.5220, longitude=13.4070
		)
		wrong_experience.append("networks", {"network": matching_network.name})
		wrong_experience.append("experiences", {"experience": other_experience.name})
		wrong_experience.save()

		results = search_records(
			search_doctype="Supporter",
			latitude=52.5200,
			longitude=13.4050,
			radius_km=10,
			networks=[matching_network.name],
			experiences=[matching_experience.name],
		)

		self.assertEqual([row["name"] for row in results], [matching.name])
		self.assertEqual(results[0]["matched_networks"], [matching_network.name])
		self.assertEqual(results[0]["matched_experiences"], [matching_experience.name])
		self.assertEqual(results[0]["latitude"], 52.52)
		self.assertEqual(results[0]["longitude"], 13.405)

	def test_supporter_radius_export_contains_match_columns(self):
		network = make_network(network_name="Export Network")
		experience = make_experience(experience_name="Export Experience")
		supporter = make_supporter(first_name="Export", latitude=52.5200, longitude=13.4050)
		supporter.append("networks", {"network": network.name})
		supporter.append("experiences", {"experience": experience.name})
		supporter.save()

		with patch(
			"verein.contact_management.page.geo_radius_search.geo_radius_search.build_xlsx_response"
		) as build_response:
			export_records(
				search_doctype="Supporter",
				latitude=52.5200,
				longitude=13.4050,
				radius_km=10,
				networks=[network.name],
				experiences=[experience.name],
			)

		headers = build_response.call_args.args[0][0]
		row = build_response.call_args.args[0][1]
		self.assertEqual(headers[-2:], ["Matched Networks", "Matched Experiences"])
		self.assertEqual(row[-2:], [network.name, experience.name])


def make_supporter(**overrides):
	values = {
		"doctype": "Supporter",
		"first_name": "Supporter",
		"last_name": frappe.generate_hash(length=6),
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def make_network(**overrides):
	type_name = ensure_network_type()
	values = {
		"doctype": "Network",
		"network_name": f"Network {frappe.generate_hash(length=6)}",
		"type": type_name,
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def make_experience(**overrides):
	type_name = ensure_experience_type()
	values = {
		"doctype": "Experience",
		"experience_name": f"Experience {frappe.generate_hash(length=6)}",
		"type": type_name,
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def ensure_network_type() -> str:
	name = "Test Network Type"
	if not frappe.db.exists("Network Type", name):
		frappe.get_doc({"doctype": "Network Type", "type_name": name}).insert()
	return name


def ensure_experience_type() -> str:
	name = "Test Experience Type"
	if not frappe.db.exists("Experience Type", name):
		frappe.get_doc({"doctype": "Experience Type", "type_name": name}).insert()
	return name
