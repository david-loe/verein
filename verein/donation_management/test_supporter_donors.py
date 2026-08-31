from __future__ import annotations

import frappe
from frappe.tests import UnitTestCase

from verein.donation_management.doctype.supporter_contact_change_request.supporter_contact_change_request import (
	approve_request,
	reject_request,
)
from verein.donation_management.supporter_donors import (
	create_contact_change_request,
	get_donor_bookings,
	get_donors,
)
from verein.donation_management.test_helpers import (
	get_account,
	get_company,
	make_access,
	make_cost_center,
	make_gl_entry,
	make_supporter,
	make_user,
)


class TestSupporterDonors(UnitTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_user_without_access_gets_error(self):
		user = make_user(f"dm-donors-no-access-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center()

		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			get_donors(cost_center, "2026-01-01", "2026-01-31")

	def test_leaf_access_returns_income_supporters_only(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(f"dm-donors-leaf-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		other = make_cost_center(company=company)
		supporter = make_supporter(first_name="Ada", last_name="Donor")
		expense_supporter = make_supporter(first_name="Expense", last_name="Only")
		other_supporter = make_supporter(first_name="Other", last_name="Cost Center")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-01-15", credit=200, debit=20, supporter=supporter.name)
		make_gl_entry(cost_center, income_account, "2026-01-16", credit=50, supporter=supporter.name)
		make_gl_entry(cost_center, expense_account, "2026-01-17", debit=80, supporter=expense_supporter.name)
		make_gl_entry(other, income_account, "2026-01-18", credit=900, supporter=other_supporter.name)

		frappe.set_user(user)
		data = get_donors(cost_center, "2026-01-01", "2026-01-31")

		self.assertEqual(data["summary"]["donor_count"], 1)
		self.assertEqual(data["summary"]["amount"], 230)
		self.assertEqual([row.name for row in data["donors"]], [supporter.name])
		self.assertEqual(data["donors"][0].first_name, "Ada")
		self.assertEqual(data["donors"][0].last_name, "Donor")
		self.assertEqual(data["donors"][0].booking_count, 2)
		self.assertEqual(data["donors"][0].contact_or_address_modified, supporter.contact_or_address_modified)

	def test_group_access_includes_child_cost_centers(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-group-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		supporter = make_supporter(first_name="Group", last_name="Donor")
		make_access(user, group)
		make_gl_entry(child, income_account, "2026-02-10", credit=175, supporter=supporter.name)

		frappe.set_user(user)
		data = get_donors(group, "2026-02-01", "2026-02-28")

		self.assertEqual(data["summary"]["donor_count"], 1)
		self.assertEqual(data["donors"][0].name, supporter.name)

	def test_sorting_by_contact_or_address_modified(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(
			f"dm-donors-sort-address-modified-{frappe.generate_hash(length=6)}@example.com",
			["Cost Center Viewer"],
		)
		cost_center = make_cost_center(company=company)
		older_supporter = make_supporter(first_name="Older", last_name="Address")
		newer_supporter = make_supporter(first_name="Newer", last_name="Address")
		frappe.db.set_value(
			"Supporter",
			older_supporter.name,
			"contact_or_address_modified",
			"2026-01-01T08:00:00+00:00",
			update_modified=False,
		)
		frappe.db.set_value(
			"Supporter",
			newer_supporter.name,
			"contact_or_address_modified",
			"2026-01-02T08:00:00+00:00",
			update_modified=False,
		)
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-02-10", credit=100, supporter=older_supporter.name)
		make_gl_entry(cost_center, income_account, "2026-02-10", credit=100, supporter=newer_supporter.name)

		frappe.set_user(user)
		ascending = get_donors(
			cost_center,
			"2026-02-01",
			"2026-02-28",
			order_by="contact_or_address_modified",
			order_direction="asc",
		)
		descending = get_donors(
			cost_center,
			"2026-02-01",
			"2026-02-28",
			order_by="contact_or_address_modified",
			order_direction="desc",
		)

		self.assertEqual([row.name for row in ascending["donors"]], [older_supporter.name, newer_supporter.name])
		self.assertEqual([row.name for row in descending["donors"]], [newer_supporter.name, older_supporter.name])

	def test_search_filters_rows_and_summary(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-search-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		matching = make_supporter(first_name="UniqueSearch", last_name="Donor")
		other = make_supporter(first_name="Different", last_name="Donor")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-02-10", credit=125, supporter=matching.name)
		make_gl_entry(cost_center, income_account, "2026-02-11", credit=500, supporter=other.name)

		frappe.set_user(user)
		data = get_donors(cost_center, "2026-02-01", "2026-02-28", search="UniqueSearch")

		self.assertEqual([row.name for row in data["donors"]], [matching.name])
		self.assertEqual(data["summary"]["donor_count"], 1)
		self.assertEqual(data["summary"]["amount"], 125)

	def test_donor_bookings_require_cost_center_access(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(
			f"dm-donor-bookings-no-access-{frappe.generate_hash(length=6)}@example.com",
			["Cost Center Viewer"],
		)
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="No", last_name="Access")
		make_gl_entry(cost_center, income_account, "2026-02-10", credit=175, supporter=supporter.name)

		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			get_donor_bookings(supporter.name, cost_center, "2026-02-01", "2026-02-28")

	def test_donor_bookings_returns_selected_supporter_income_entries(self):
		company = get_company()
		income_account = get_account(company, "Income")
		expense_account = get_account(company, "Expense")
		user = make_user(
			f"dm-donor-bookings-leaf-{frappe.generate_hash(length=6)}@example.com",
			["Cost Center Viewer"],
		)
		cost_center = make_cost_center(company=company)
		other_cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Booking", last_name="Donor")
		other_supporter = make_supporter(first_name="Other", last_name="Donor")
		make_access(user, cost_center)
		make_gl_entry(
			cost_center,
			income_account,
			"2026-02-10",
			credit=175,
			remarks="Second",
			supporter=supporter.name,
		)
		make_gl_entry(cost_center, income_account, "2026-02-11", credit=50, debit=5, supporter=supporter.name)
		make_gl_entry(cost_center, income_account, "2026-02-12", credit=900, supporter=other_supporter.name)
		make_gl_entry(other_cost_center, income_account, "2026-02-13", credit=800, supporter=supporter.name)
		make_gl_entry(cost_center, expense_account, "2026-02-14", debit=700, supporter=supporter.name)
		make_gl_entry(cost_center, income_account, "2026-02-15", credit=600, is_cancelled=1, supporter=supporter.name)

		frappe.set_user(user)
		data = get_donor_bookings(supporter.name, cost_center, "2026-02-01", "2026-02-28")

		self.assertEqual(len(data["bookings"]), 2)
		self.assertEqual([row.amount for row in data["bookings"]], [45, 175])
		self.assertEqual({row.cost_center for row in data["bookings"]}, {cost_center})
		self.assertEqual(data["bookings"][1].remarks, "Second")

	def test_donor_bookings_group_access_includes_child_cost_centers(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(
			f"dm-donor-bookings-group-{frappe.generate_hash(length=6)}@example.com",
			["Cost Center Viewer"],
		)
		group = make_cost_center(company=company, is_group=1)
		child = make_cost_center(company=company, parent_cost_center=group)
		supporter = make_supporter(first_name="Child", last_name="Donor")
		make_access(user, group)
		make_gl_entry(child, income_account, "2026-02-10", credit=175, supporter=supporter.name)

		frappe.set_user(user)
		data = get_donor_bookings(supporter.name, group, "2026-02-01", "2026-02-28")

		self.assertEqual(len(data["bookings"]), 1)
		self.assertEqual(data["bookings"][0].cost_center, child)

	def test_donor_bookings_pagination_is_stable(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(
			f"dm-donor-bookings-page-{frappe.generate_hash(length=6)}@example.com",
			["Cost Center Viewer"],
		)
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Paged", last_name="Donor")
		make_access(user, cost_center)
		for amount, day in [(10, "01"), (20, "02"), (30, "03")]:
			make_gl_entry(cost_center, income_account, f"2026-03-{day}", credit=amount, supporter=supporter.name)

		frappe.set_user(user)
		first_page = get_donor_bookings(supporter.name, cost_center, "2026-03-01", "2026-03-31", limit=2)
		second_page = get_donor_bookings(
			supporter.name,
			cost_center,
			"2026-03-01",
			"2026-03-31",
			limit_start=first_page["next_limit_start"],
			limit=2,
		)

		self.assertTrue(first_page["has_more"])
		self.assertEqual([row.amount for row in first_page["bookings"]], [30, 20])
		self.assertEqual([row.amount for row in second_page["bookings"]], [10])

	def test_cancelled_and_empty_supporter_entries_are_ignored(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-cancelled-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Valid", last_name="Donor")
		cancelled_supporter = make_supporter(first_name="Cancelled", last_name="Donor")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-03-05", credit=300, supporter=supporter.name)
		make_gl_entry(
			cost_center,
			income_account,
			"2026-03-06",
			credit=500,
			is_cancelled=1,
			supporter=cancelled_supporter.name,
		)
		make_gl_entry(cost_center, income_account, "2026-03-07", credit=700)

		frappe.set_user(user)
		data = get_donors(cost_center, "2026-03-01", "2026-03-31")

		self.assertEqual(data["summary"]["donor_count"], 1)
		self.assertEqual(data["donors"][0].name, supporter.name)

	def test_out_of_range_page_keeps_summary(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-empty-page-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Summary", last_name="Fallback")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-03-05", credit=125, supporter=supporter.name)

		frappe.set_user(user)
		data = get_donors(cost_center, "2026-03-01", "2026-03-31", limit_start=100, limit=20)

		self.assertEqual(data["donors"], [])
		self.assertEqual(data["summary"]["donor_count"], 1)
		self.assertEqual(data["summary"]["amount"], 125)

	def test_create_and_approve_contact_change_request(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-request-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		reviewer = make_user(
			f"dm-donors-reviewer-{frappe.generate_hash(length=6)}@example.com",
			["Supporter Change Reviewer"],
		)
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Pending", last_name="Change", email_address="old@example.com")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-04-05", credit=300, supporter=supporter.name)

		frappe.set_user(user)
		result = create_contact_change_request(
			supporter.name,
			cost_center,
			"2026-04-01",
			"2026-04-30",
			{"email_address": "new@example.com", "city": "Berlin"},
		)

		request = frappe.get_doc("Supporter Contact Change Request", result["name"])
		self.assertEqual(request.status, "Pending")
		self.assertEqual(len(request.changes), 2)

		with self.assertRaises(frappe.ValidationError):
			approve_request(request.name)

		frappe.set_user(reviewer)
		approve_request(request.name, "Looks good")

		supporter.reload()
		self.assertEqual(supporter.email_address, "new@example.com")
		self.assertEqual(supporter.city, "Berlin")
		self.assertEqual(frappe.db.get_value("Supporter Contact Change Request", request.name, "status"), "Approved")

	def test_reject_contact_change_request_keeps_supporter_unchanged(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-reject-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		reviewer = make_user(
			f"dm-donors-reject-reviewer-{frappe.generate_hash(length=6)}@example.com",
			["Supporter Change Reviewer"],
		)
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Reject", last_name="Change", phone="123")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-05-05", credit=300, supporter=supporter.name)

		frappe.set_user(user)
		result = create_contact_change_request(
			supporter.name,
			cost_center,
			"2026-05-01",
			"2026-05-31",
			{"phone": "999"},
		)

		frappe.set_user(reviewer)
		reject_request(result["name"], "Not verified")

		supporter.reload()
		self.assertEqual(supporter.phone, "123")
		self.assertEqual(frappe.db.get_value("Supporter Contact Change Request", result["name"], "status"), "Rejected")

	def test_unsupported_change_field_is_rejected(self):
		company = get_company()
		income_account = get_account(company, "Income")
		user = make_user(f"dm-donors-bad-field-{frappe.generate_hash(length=6)}@example.com", ["Cost Center Viewer"])
		cost_center = make_cost_center(company=company)
		supporter = make_supporter(first_name="Bad", last_name="Field")
		make_access(user, cost_center)
		make_gl_entry(cost_center, income_account, "2026-06-05", credit=300, supporter=supporter.name)

		frappe.set_user(user)
		with self.assertRaises(frappe.ValidationError):
			create_contact_change_request(
				supporter.name,
				cost_center,
				"2026-06-01",
				"2026-06-30",
				{"spouse": "invalid"},
			)
