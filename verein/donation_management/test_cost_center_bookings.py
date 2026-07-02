from __future__ import annotations

import frappe
from frappe.tests import UnitTestCase

from verein.donation_management.cost_center_bookings import get_booking_entries
from verein.donation_management.test_helpers import (
	get_account,
	get_company,
	make_access,
	make_cost_center,
	make_gl_entry,
	make_user,
)


class TestCostCenterBookings(UnitTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_user_without_access_gets_error(self):
		user = make_user(f"dm-bookings-no-access-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()

		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			get_booking_entries(cost_center, "2026-01-01", "2026-01-31")

	def test_leaf_access_returns_income_and_expense_entries(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-bookings-leaf-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		other = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-01-15", credit=200, debit=20)
		make_gl_entry(cost_center, expense_account, "2026-01-16", debit=80, credit=5)
		make_gl_entry(other, income_account, "2026-01-17", credit=900)

		frappe.set_user(user)
		data = get_booking_entries(cost_center, "2026-01-01", "2026-01-31")

		self.assertEqual(len(data["entries"]), 2)
		self.assertEqual(data["summary"]["income"], 180)
		self.assertEqual(data["summary"]["expense"], 75)
		self.assertEqual(data["summary"]["net"], 105)

	def test_group_access_includes_child_cost_centers(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-bookings-group-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		make_access(user, group)
		make_gl_entry(child, income_account, "2026-02-10", credit=175)

		frappe.set_user(user)
		data = get_booking_entries(group, "2026-02-01", "2026-02-28")

		self.assertEqual(len(data["entries"]), 1)
		self.assertEqual(data["entries"][0]["cost_center"], child)
		self.assertEqual(data["summary"]["income"], 175)

	def test_cancelled_entries_are_ignored(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-bookings-cancelled-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-03-05", credit=300)
		make_gl_entry(cost_center, income_account, "2026-03-06", credit=500, is_cancelled=1)

		frappe.set_user(user)
		data = get_booking_entries(cost_center, "2026-03-01", "2026-03-31")

		self.assertEqual(len(data["entries"]), 1)
		self.assertEqual(data["summary"]["income"], 300)

	def test_period_over_36_months_is_allowed(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-bookings-period-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2023-01-15", credit=125)

		frappe.set_user(user)
		data = get_booking_entries(cost_center, "2023-01-01", "2026-02-28")

		self.assertEqual(data["summary"]["income"], 125)

	def test_pagination_keeps_summary_for_full_period(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-bookings-page-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-04-01", credit=100)
		make_gl_entry(cost_center, income_account, "2026-04-02", credit=200)
		make_gl_entry(cost_center, income_account, "2026-04-03", credit=300)

		frappe.set_user(user)
		data = get_booking_entries(cost_center, "2026-04-01", "2026-04-30", limit_start=0, limit=2)

		self.assertEqual(len(data["entries"]), 2)
		self.assertTrue(data["has_more"])
		self.assertEqual(data["next_limit_start"], 2)
		self.assertEqual(data["summary"]["income"], 600)

	def test_sorting_by_net_amount(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-bookings-sort-net-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-05-01", credit=100)
		make_gl_entry(cost_center, income_account, "2026-05-02", credit=50)
		make_gl_entry(cost_center, expense_account, "2026-05-03", debit=30)

		frappe.set_user(user)
		ascending = get_booking_entries(
			cost_center, "2026-05-01", "2026-05-31", order_by="net", order_direction="asc"
		)
		descending = get_booking_entries(
			cost_center, "2026-05-01", "2026-05-31", order_by="net", order_direction="desc"
		)

		self.assertEqual([row["net"] for row in ascending["entries"]], [-30, 50, 100])
		self.assertEqual([row["net"] for row in descending["entries"]], [100, 50, -30])

	def test_sorting_by_account_and_date(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-bookings-sort-fields-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-06-01", credit=100)
		make_gl_entry(cost_center, expense_account, "2026-06-03", debit=30)

		frappe.set_user(user)
		by_account = get_booking_entries(
			cost_center, "2026-06-01", "2026-06-30", order_by="account", order_direction="asc"
		)
		by_account_desc = get_booking_entries(
			cost_center, "2026-06-01", "2026-06-30", order_by="account", order_direction="desc"
		)
		by_date = get_booking_entries(
			cost_center, "2026-06-01", "2026-06-30", order_by="posting_date", order_direction="asc"
		)

		account_labels = [row.account_name or row.account for row in by_account["entries"]]
		desc_account_labels = [row.account_name or row.account for row in by_account_desc["entries"]]
		self.assertEqual(account_labels, list(reversed(desc_account_labels)))
		self.assertEqual([row.posting_date.isoformat() for row in by_date["entries"]], ["2026-06-01", "2026-06-03"])

	def test_sorting_by_remarks(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-bookings-sort-remarks-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-06-01", credit=100, remarks="Zulu")
		make_gl_entry(cost_center, income_account, "2026-06-02", credit=100, remarks="Alpha")

		frappe.set_user(user)
		data = get_booking_entries(
			cost_center, "2026-06-01", "2026-06-30", order_by="remarks", order_direction="asc"
		)

		self.assertEqual([row.remarks for row in data["entries"]], ["Alpha", "Zulu"])

	def test_sorted_pagination_is_stable(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-bookings-sort-page-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		make_access(user, cost_center)
		for amount in [40, 10, 30, 20]:
			make_gl_entry(cost_center, income_account, "2026-07-01", credit=amount)

		frappe.set_user(user)
		first_page = get_booking_entries(
			cost_center, "2026-07-01", "2026-07-31", limit=2, order_by="net", order_direction="asc"
		)
		second_page = get_booking_entries(
			cost_center,
			"2026-07-01",
			"2026-07-31",
			limit_start=first_page["next_limit_start"],
			limit=2,
			order_by="net",
			order_direction="asc",
		)

		self.assertEqual([row["net"] for row in first_page["entries"]], [10, 20])
		self.assertEqual([row["net"] for row in second_page["entries"]], [30, 40])
