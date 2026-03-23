from __future__ import annotations

import frappe
from frappe.tests.utils import FrappeTestCase

from verein.contact_management.doctype.experience.experience import (
	add_supporters,
	get_linked_supporters,
	remove_supporter,
)


class TestExperience(FrappeTestCase):
	def test_linked_supporters_can_be_added_and_removed_from_experience(self):
		experience = make_experience()
		supporter = make_supporter()

		add_supporters(experience.name, [supporter.name])
		self.assertTrue(
			frappe.db.exists("Supporter Experience", {"parent": supporter.name, "experience": experience.name})
		)
		self.assertEqual([row["name"] for row in get_linked_supporters(experience.name)], [supporter.name])

		remove_supporter(experience.name, supporter.name)
		self.assertFalse(
			frappe.db.exists("Supporter Experience", {"parent": supporter.name, "experience": experience.name})
		)


def make_experience(**overrides):
	type_name = ensure_experience_type()
	values = {
		"doctype": "Experience",
		"experience_name": f"Experience {frappe.generate_hash(length=6)}",
		"type": type_name,
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def make_supporter(**overrides):
	values = {
		"doctype": "Supporter",
		"first_name": "Experience",
		"last_name": frappe.generate_hash(length=6),
	}
	values.update(overrides)
	return frappe.get_doc(values).insert()


def ensure_experience_type() -> str:
	name = "Test Experience Type"
	if not frappe.db.exists("Experience Type", name):
		frappe.get_doc({"doctype": "Experience Type", "type_name": name}).insert()
	return name
