from __future__ import annotations

import frappe
from frappe.tests import UnitTestCase

from verein.donation_management.cost_center_dashboard import upsert_budget
from verein.donation_management.test_helpers import make_access, make_budget, make_cost_center, make_user


class TestCostCenterBudget(UnitTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_duplicate_period_is_rejected(self):
		cost_center = make_cost_center()
		make_budget(cost_center, "2026-01-01", 100)

		with self.assertRaises(frappe.ValidationError):
			make_budget(cost_center, "2026-01-01", 120)

	def test_negative_budget_is_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			make_budget(make_cost_center(), "2026-01-01", -1)

	def test_from_date_is_normalized_to_month_start(self):
		budget = make_budget(make_cost_center(), "2026-01-17", 100)

		self.assertEqual(str(budget.from_date), "2026-01-01")

	def test_viewer_without_manage_access_cannot_write(self):
		viewer = make_user(f"dm-budget-view-{frappe.generate_hash(length=6)}@example.com", ["Donation Management User"])
		cost_center = make_cost_center()
		make_access(viewer, cost_center, access_level="View")

		frappe.set_user(viewer)
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(
				{
					"doctype": "Cost Center Budget",
					"cost_center": cost_center,
					"from_date": "2026-01-01",
					"budget_amount": 100,
				}
			).insert()

	def test_manage_access_can_upsert_own_budget(self):
		viewer = make_user(f"dm-budget-manage-{frappe.generate_hash(length=6)}@example.com", ["Donation Management User"])
		cost_center = make_cost_center()
		make_access(viewer, cost_center, access_level="Manage")

		frappe.set_user(viewer)
		result = upsert_budget(cost_center, "2026-02-15", 250)

		self.assertEqual(result["budget_amount"], 250)
		self.assertEqual(result["from_date"], "2026-02-01")
		self.assertTrue(
			frappe.db.exists(
				"Cost Center Budget",
				{"cost_center": cost_center, "from_date": "2026-02-01", "budget_amount": 250},
			)
		)
