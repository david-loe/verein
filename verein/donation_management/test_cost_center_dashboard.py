from __future__ import annotations

import frappe
from erpnext.accounts.utils import get_fiscal_year
from frappe.tests import UnitTestCase
from frappe.utils import add_days, getdate, today

from verein.donation_management.cost_center_dashboard import (
	get_accessible_cost_centers,
	get_cost_center_balance,
	get_dashboard_data,
)
from verein.donation_management.test_helpers import (
	ensure_fiscal_year_for_date,
	get_account,
	get_company,
	make_access,
	make_budget,
	make_cost_center,
	make_gl_entry,
	make_user,
)


class TestCostCenterDashboard(UnitTestCase):
	def setUp(self):
		frappe.db.set_single_value("Donation Management Settings", "allow_group_cost_centers", 0)
		frappe.db.set_single_value("Donation Management Settings", "cost_center_display", "Cost Center Name")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.set_single_value("Donation Management Settings", "allow_group_cost_centers", 0)
		frappe.db.set_single_value("Donation Management Settings", "cost_center_display", "Cost Center Name")

	def get_current_fiscal_year_start(self, company: str):
		ensure_fiscal_year_for_date(today())
		_, year_start_date, _ = get_fiscal_year(today(), company=company)
		return getdate(year_start_date)

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

	def test_group_access_exposes_leaf_cost_centers_by_default(self):
		company = get_company()
		user = make_user(f"dm-group-options-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group)

		frappe.set_user(user)
		rows = get_accessible_cost_centers()
		rows_by_name = {row.name: row for row in rows}

		self.assertNotIn(group, rows_by_name)
		self.assertIn(child, rows_by_name)
		self.assertFalse(rows_by_name[child].can_manage_budget)
		self.assertEqual(rows_by_name[child].company, company)

	def test_setting_allows_group_cost_centers(self):
		company = get_company()
		user = make_user(f"dm-group-options-enabled-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group)
		frappe.db.set_single_value("Donation Management Settings", "allow_group_cost_centers", 1)

		frappe.set_user(user)
		names = {row.name for row in get_accessible_cost_centers()}

		self.assertIn(group, names)
		self.assertIn(child, names)

	def test_group_manage_access_is_inherited_by_leaf_options(self):
		company = get_company()
		user = make_user(f"dm-group-manage-options-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group, access_level="Manage")

		frappe.set_user(user)
		rows_by_name = {row.name: row for row in get_accessible_cost_centers()}

		self.assertTrue(rows_by_name[child].can_manage_budget)

	def test_cost_center_display_defaults_to_name(self):
		company = get_company()
		cost_center = make_cost_center(company=company)
		frappe.db.set_value("Cost Center", cost_center, "cost_center_number", "4711")

		rows_by_name = {row.name: row for row in get_accessible_cost_centers()}

		self.assertEqual(rows_by_name[cost_center].display_name, rows_by_name[cost_center].cost_center_name)
		self.assertEqual(rows_by_name[cost_center].cost_center_number, "4711")

	def test_setting_displays_cost_center_number_before_name(self):
		company = get_company()
		cost_center = make_cost_center(company=company)
		frappe.db.set_value("Cost Center", cost_center, "cost_center_number", "4711")
		frappe.db.set_single_value(
			"Donation Management Settings", "cost_center_display", "Cost Center Number and Name"
		)

		rows_by_name = {row.name: row for row in get_accessible_cost_centers()}

		self.assertEqual(
			rows_by_name[cost_center].display_name,
			f"4711 – {rows_by_name[cost_center].cost_center_name}",
		)

	def test_cost_center_number_display_falls_back_to_name(self):
		company = get_company()
		cost_center = make_cost_center(company=company)
		frappe.db.set_single_value(
			"Donation Management Settings", "cost_center_display", "Cost Center Number and Name"
		)

		rows_by_name = {row.name: row for row in get_accessible_cost_centers()}

		self.assertEqual(rows_by_name[cost_center].display_name, rows_by_name[cost_center].cost_center_name)

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
		asset_account = get_account(company, "Asset")
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-balance-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		fiscal_year_start = self.get_current_fiscal_year_start(company)
		make_access(user, cost_center)
		make_gl_entry(
			cost_center,
			asset_account,
			fiscal_year_start,
			credit=1000,
		)
		make_gl_entry(cost_center, income_account, fiscal_year_start, credit=50)
		make_gl_entry(cost_center, income_account, add_days(fiscal_year_start, -1), credit=500)
		make_gl_entry(cost_center, income_account, today(), credit=300)
		make_gl_entry(cost_center, expense_account, today(), debit=75)
		make_gl_entry(cost_center, income_account, add_days(today(), 1), credit=900)
		make_gl_entry(cost_center, income_account, today(), credit=700, is_cancelled=1)

		frappe.set_user(user)
		data = get_dashboard_data(cost_center, "2026-05-01", "2026-05-31")

		self.assertEqual(data["summary"]["net"], 0)
		self.assertEqual(get_cost_center_balance(cost_center), 1275)

	def test_group_cost_center_balance_includes_child_cost_centers(self):
		company = get_company()
		asset_account = get_account(company, "Asset")
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-group-balance-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		fiscal_year_start = self.get_current_fiscal_year_start(company)
		make_access(user, group)
		make_gl_entry(
			child,
			asset_account,
			fiscal_year_start,
			credit=175,
		)
		make_gl_entry(child, expense_account, today(), debit=25)

		frappe.set_user(user)

		self.assertEqual(get_cost_center_balance(group), 150)

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
