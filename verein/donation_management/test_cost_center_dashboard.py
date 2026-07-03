from __future__ import annotations

import frappe
from frappe.tests import UnitTestCase
from frappe.utils import add_days, today

from verein.donation_management.cost_center_dashboard import get_cost_center_balance, get_dashboard_data
from verein.donation_management.test_helpers import (
	get_account,
	get_company,
	make_access,
	make_budget,
	make_cost_center,
	make_gl_entry,
	make_user,
)


class TestCostCenterDashboard(UnitTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_user_without_access_gets_error(self):
		user = make_user(f"dm-no-access-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()

		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			get_dashboard_data(cost_center, "2026-01-01", "2026-01-31")

	def test_leaf_access_only_returns_leaf_entries(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-leaf-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		allowed = make_cost_center(company=company)
		other = make_cost_center(company=company)
		make_access(user, allowed)
		make_gl_entry(allowed, income_account, "2026-01-15", credit=100)
		make_gl_entry(other, income_account, "2026-01-15", credit=900)

		frappe.set_user(user)
		data = get_dashboard_data(allowed, "2026-01-01", "2026-01-31")

		self.assertEqual(data["summary"]["income"], 100)

	def test_group_access_includes_child_cost_centers(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-group-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group)
		make_gl_entry(child, income_account, "2026-02-10", credit=175)

		frappe.set_user(user)
		data = get_dashboard_data(group, "2026-02-01", "2026-02-28")

		self.assertEqual(data["summary"]["income"], 175)

	def test_aggregation_ignores_cancelled_entries_and_calculates_net(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-aggregate-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-03-05", credit=300, debit=20)
		make_gl_entry(cost_center, expense_account, "2026-03-06", debit=90, credit=10)
		make_gl_entry(cost_center, income_account, "2026-03-07", credit=500, is_cancelled=1)

		frappe.set_user(user)
		data = get_dashboard_data(cost_center, "2026-03-01", "2026-03-31")

		self.assertEqual(data["summary"]["income"], 280)
		self.assertEqual(data["summary"]["expense"], 80)
		self.assertEqual(data["summary"]["net"], 200)

	def test_budget_values_continue_until_next_change(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-budget-series-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-04-01", credit=500)
		make_budget(cost_center, "2026-02-01", 300)
		make_budget(cost_center, "2026-05-01", 450)

		frappe.set_user(user)
		data = get_dashboard_data(cost_center, "2026-04-01", "2026-06-30")

		self.assertEqual([row["budget"] for row in data["months"]], [300, 450, 450])
		self.assertEqual(data["summary"]["budget"], 1200)
		self.assertNotIn("budget_delta", data["summary"])
		self.assertNotIn("budget_delta", data["months"][0])

	def test_group_budget_sums_child_effective_budgets(self):
		company = get_company()
		user = make_user(f"dm-group-budget-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		first_child = make_cost_center(company=company, parent_cost_center=group)
		second_child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group)
		make_budget(first_child, "2026-01-01", 100)
		make_budget(second_child, "2026-02-01", 250)

		frappe.set_user(user)
		data = get_dashboard_data(group, "2026-01-01", "2026-03-31")

		self.assertEqual([row["budget"] for row in data["months"]], [100, 350, 350])

	def test_cost_center_balance_is_independent_from_selected_period(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-balance-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2020-01-15", credit=500)
		make_gl_entry(cost_center, expense_account, "2020-01-16", debit=125)
		make_gl_entry(cost_center, income_account, add_days(today(), 1), credit=900)
		make_gl_entry(cost_center, income_account, "2020-01-17", credit=700, is_cancelled=1)

		frappe.set_user(user)
		data = get_dashboard_data(cost_center, "2026-05-01", "2026-05-31")

		self.assertEqual(data["summary"]["net"], 0)
		self.assertEqual(get_cost_center_balance(cost_center), 375)

	def test_group_cost_center_balance_includes_child_cost_centers(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-group-balance-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group)
		make_gl_entry(child, income_account, "2020-02-10", credit=175)

		frappe.set_user(user)

		self.assertEqual(get_cost_center_balance(group), 175)

	def test_user_without_access_cannot_get_cost_center_balance(self):
		user = make_user(f"dm-balance-no-access-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()

		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			get_cost_center_balance(cost_center)

	def test_period_over_36_months_is_allowed(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-period-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2023-01-15", credit=125)

		frappe.set_user(user)
		data = get_dashboard_data(cost_center, "2023-01-01", "2026-02-28")

		self.assertEqual(data["summary"]["income"], 125)
