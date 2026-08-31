from __future__ import annotations

import frappe
from frappe.tests import UnitTestCase

from verein.donation_management.test_helpers import make_access, make_cost_center, make_user


class TestCostCenterAccess(UnitTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_active_duplicate_is_rejected(self):
		user = make_user(f"dm-viewer-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()
		make_access(user, cost_center)

		with self.assertRaises(frappe.ValidationError):
			make_access(user, cost_center)

	def test_company_is_derived_from_cost_center(self):
		cost_center = make_cost_center()
		access = frappe.new_doc("Cost Center Access")
		access.cost_center = cost_center
		access.company = None
		access.validate_company()

		self.assertEqual(access.company, frappe.db.get_value("Cost Center", cost_center, "company"))

	def test_cost_center_from_another_company_is_rejected(self):
		cost_center = make_cost_center()
		access = frappe.new_doc("Cost Center Access")
		access.cost_center = cost_center
		access.company = "Another Company"

		with self.assertRaises(frappe.ValidationError):
			access.validate_company()

	def test_inactive_historical_duplicate_is_allowed(self):
		user = make_user(f"dm-inactive-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()
		make_access(user, cost_center, active=0)
		active_access = make_access(user, cost_center, active=1)

		self.assertTrue(active_access.name)

	def test_viewer_sees_only_own_active_access_rows(self):
		viewer = make_user(f"dm-own-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		other = make_user(f"dm-other-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		viewer_access = make_access(viewer, make_cost_center())
		make_access(viewer, make_cost_center(), active=0)
		make_access(other, make_cost_center())

		frappe.set_user(viewer)
		rows = frappe.get_list("Cost Center Access", fields=["name"])

		self.assertEqual([row.name for row in rows], [viewer_access.name])

	def test_manager_sees_all_access_rows(self):
		manager = make_user(f"dm-manager-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Manager"])
		first = make_access(
			make_user(f"dm-managed-a-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"]),
			make_cost_center(),
		)
		second = make_access(
			make_user(f"dm-managed-b-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"]),
			make_cost_center(),
		)

		frappe.set_user(manager)
		names = {row.name for row in frappe.get_list("Cost Center Access", fields=["name"])}

		self.assertIn(first.name, names)
		self.assertIn(second.name, names)
