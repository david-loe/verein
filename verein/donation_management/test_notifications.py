from __future__ import annotations

from datetime import timedelta
from unittest.mock import patch

import frappe
from frappe.tests import UnitTestCase
from frappe.utils import now_datetime

from verein.donation_management.notifications import (
	DELIVERY,
	PREFERENCES,
	get_notification_settings,
	process_user_digest,
	record_donation,
	save_notification_settings,
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


class TestDonationNotifications(UnitTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		frappe.db.savepoint("notification_test")
		self.mail_patch = patch("frappe.sendmail", return_value=frappe._dict(name="test-email-queue"))
		self.mail = self.mail_patch.start()
		self.addCleanup(self.mail_patch.stop)
		self.company = get_company()
		self.account = get_account(self.company, "Income")
		self.center = make_cost_center(company=self.company)
		self.user = make_user(
			f"notify-{frappe.generate_hash(length=8)}@example.com", ["Donation Management User"]
		)
		self.access = make_access(self.user, self.center)
		self.supporter = make_supporter(first_name="Notification", last_name="Donor")
		self.mail.reset_mock()

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback(save_point="notification_test")

	def save(self, new=1, large=1, threshold=100, center=None, user=None):
		frappe.set_user(user or self.user)
		result = save_notification_settings(
			{
				"rules": [
					{
						"cost_center": center or self.center,
						"notify_new_donor": new,
						"notify_large_donation": large,
						"threshold": threshold,
					}
				]
			}
		)
		frappe.set_user("Administrator")
		return result

	def entry(
		self, credit=200, center=None, supporter=None, repost=False, opening=False, anonymous=False, **kwargs
	):
		doc = make_gl_entry(
			center or self.center,
			kwargs.pop("account", self.account),
			kwargs.pop("posting_date", "2026-09-01"),
			credit=credit,
			supporter=supporter or self.supporter.name,
			**kwargs,
		)
		# The shared fixture bypasses voucher validation. Exercise the actual registered
		# submission hook on its persisted GL row without creating a fake journal voucher.
		doc.db_set("docstatus", 1)
		if opening:
			doc.db_set("is_opening", "Yes")
		if anonymous:
			doc.db_set("supporter", None)
		doc.flags.from_repost = repost
		doc.run_method("on_submit")
		return doc

	def deliveries(self):
		return frappe.get_all(DELIVERY, filters={"user": self.user}, fields=["name", "status", "email_queue"])

	def test_settings_are_private_and_cannot_choose_recipient(self):
		other = make_user(
			f"notify-other-{frappe.generate_hash(length=8)}@example.com", ["Donation Management User"]
		)
		self.save()
		make_access(other, self.center)
		frappe.set_user(other)
		self.assertEqual(get_notification_settings()["rules"], [])
		self.assertFalse(frappe.has_permission(PREFERENCES, "read", frappe.get_doc(PREFERENCES, self.user)))
		self.assertEqual(frappe.get_list(PREFERENCES), [])
		save_notification_settings({"user": self.user, "email": "untrusted@example.com", "rules": []})
		self.assertEqual(frappe.get_doc(PREFERENCES, self.user).rules[0].cost_center, self.center)
		self.assertEqual(get_notification_settings()["email"], other)

	def test_generic_write_api_is_not_available(self):
		self.save()
		frappe.set_user(self.user)
		doc = frappe.get_doc(PREFERENCES, self.user)
		with self.assertRaises(frappe.PermissionError):
			doc.save()

	def test_rejects_groups_inaccessible_and_disabled_cost_centers(self):
		group = make_cost_center(is_group=1)
		make_access(self.user, group)
		other = make_cost_center()
		for center in (group, other):
			with self.subTest(center=center), self.assertRaises(frappe.PermissionError):
				self.save(center=center)
		frappe.set_user("Administrator")
		frappe.db.set_value("Cost Center", self.center, "disabled", 1)
		with self.assertRaises(frappe.PermissionError):
			self.save()

	def test_group_permission_allows_leaf_subscription_only(self):
		group = make_cost_center(is_group=1)
		child = make_cost_center(parent_cost_center=group)
		make_access(self.user, group)
		result = self.save(center=child)
		self.assertIn(child, [row.name for row in result["cost_centers"]])
		self.assertNotIn(group, [row.name for row in result["cost_centers"]])

	def test_threshold_and_duplicate_validation(self):
		for value in (0, -1, "invalid", float("inf"), float("nan")):
			with self.subTest(value=value), self.assertRaises(frappe.ValidationError):
				self.save(threshold=value)
		frappe.set_user(self.user)
		with self.assertRaises(frappe.ValidationError):
			save_notification_settings({"rules": [{"cost_center": self.center}] * 2})

	def test_no_historical_backfill_but_backdated_new_bookings_count(self):
		self.entry(credit=400)
		self.save(new=0)
		self.assertEqual(self.deliveries(), [])
		self.entry(posting_date="2025-01-01")
		process_user_digest(self.user)
		self.mail.assert_called_once()

	def test_both_reasons_are_combined_and_repeated_hooks_are_idempotent(self):
		self.save()
		entry = self.entry()
		record_donation(entry)
		self.assertEqual(len(self.deliveries()), 1)
		self.mail.assert_not_called()
		process_user_digest(self.user)
		self.mail.assert_called_once()
		kwargs = self.mail.call_args.kwargs
		self.assertEqual(kwargs["recipients"], [self.user])
		self.assertTrue(kwargs["delayed"])
		self.assertFalse(kwargs["now"])
		self.assertEqual(kwargs["message"].count("<li "), 1)
		self.assertIn("New donor", kwargs["message"])
		self.assertIn("Donation at or above threshold", kwargs["message"])
		self.assertEqual(self.deliveries()[0]["status"], "Queued")
		self.assertEqual(self.deliveries()[0]["email_queue"], "test-email-queue")

	def test_known_donor_is_not_new_even_when_backdated(self):
		self.entry()
		self.save(large=0)
		self.entry(posting_date="2025-01-01")
		process_user_digest(self.user)
		self.mail.assert_not_called()
		self.assertEqual(self.deliveries()[0]["status"], "Skipped")

	def test_donor_is_new_per_cost_center(self):
		other = make_cost_center()
		self.entry(center=other)
		self.save(large=0)
		self.entry(credit=1)
		self.entry(credit=2)
		process_user_digest(self.user)
		self.mail.assert_called_once()
		self.assertEqual(self.mail.call_args.kwargs["message"].count("<li "), 1)

	def test_threshold_is_inclusive_and_not_a_sum(self):
		self.save(new=0)
		for amount in (60, 60, 99.99, 100, 101):
			self.entry(credit=amount)
		process_user_digest(self.user)
		self.assertEqual(self.mail.call_args.kwargs["message"].count("<li "), 2)
		self.assertEqual(sum(row.status == "Queued" for row in self.deliveries()), 2)

	def test_storno_repost_expense_opening_and_missing_supporter_are_excluded(self):
		self.save()
		self.entry(is_cancelled=1)
		self.entry(repost=True)
		self.entry(opening=True)
		self.entry(anonymous=True)
		self.entry(voucher_type="Period Closing Voucher")
		self.entry(credit=0, debit=100)
		self.entry(account=get_account(self.company, "Expense"))
		doc = self.entry()
		frappe.db.set_value("GL Entry", doc.name, "is_cancelled", 1)
		process_user_digest(self.user)
		self.mail.assert_not_called()
		self.assertEqual(len(self.deliveries()), 1)

	def test_users_without_module_role_and_guests_cannot_manage_settings(self):
		other = make_user(f"notify-no-role-{frappe.generate_hash(length=8)}@example.com")
		for user in (other, "Guest"):
			frappe.set_user(user)
			with self.assertRaises(frappe.PermissionError):
				get_notification_settings()
			with self.assertRaises(frappe.PermissionError):
				save_notification_settings({"rules": []})

	def test_disabled_rules_do_not_record_events(self):
		self.save(new=0, large=0)
		self.entry()
		self.assertEqual(self.deliveries(), [])
		process_user_digest(self.user)
		self.mail.assert_not_called()

	def test_threshold_uses_net_amount_in_company_currency(self):
		self.save(new=0)
		self.entry(credit=101, debit=2)
		entry = self.entry(credit=102, debit=1)
		entry.db_set("credit_in_account_currency", 1)
		process_user_digest(self.user)
		self.assertEqual(sum(row.status == "Queued" for row in self.deliveries()), 1)

	def test_one_digest_combines_multiple_cost_centers(self):
		other = make_cost_center()
		make_access(self.user, other)
		frappe.set_user(self.user)
		save_notification_settings(
			{"rules": [{"cost_center": center, "notify_new_donor": 1} for center in (self.center, other)]}
		)
		frappe.set_user("Administrator")
		self.entry()
		self.entry(center=other)
		process_user_digest(self.user)
		self.mail.assert_called_once()
		self.assertEqual(self.mail.call_args.kwargs["message"].count("<h3 "), 2)
		self.assertEqual(self.mail.call_args.kwargs["message"].count("<li "), 2)

	def test_revoked_access_suppresses_pending_email(self):
		self.save()
		self.entry()
		frappe.db.set_value("Cost Center Access", self.access.name, "active", 0)
		process_user_digest(self.user)
		self.mail.assert_not_called()
		self.assertEqual(self.deliveries()[0]["status"], "Skipped")

	def test_disabled_user_suppresses_pending_email(self):
		self.save()
		self.entry()
		frappe.db.set_value("User", self.user, "enabled", 0)
		process_user_digest(self.user)
		self.mail.assert_not_called()

	def test_unchanged_rules_keep_pending_events(self):
		self.save()
		before = frappe.get_doc(PREFERENCES, self.user).rules[0].active_since
		self.entry()
		self.save()
		self.assertEqual(before, frappe.get_doc(PREFERENCES, self.user).rules[0].active_since)
		process_user_digest(self.user)
		self.mail.assert_called_once()

	def test_changed_rules_only_apply_to_future_events(self):
		self.save()
		self.entry()
		self.save(new=0, threshold=150)
		self.entry(credit=160)
		process_user_digest(self.user)
		self.assertEqual(self.mail.call_args.kwargs["message"].count("<li "), 1)
		self.assertEqual(sum(row.status == "Skipped" for row in self.deliveries()), 1)

	def test_removed_rules_suppress_pending_events(self):
		self.save()
		self.entry()
		frappe.set_user(self.user)
		save_notification_settings({"rules": []})
		frappe.set_user("Administrator")
		process_user_digest(self.user)
		self.mail.assert_not_called()

	def test_daily_idempotency_and_next_day_delivery(self):
		self.save(new=0)
		self.entry()
		process_user_digest(self.user)
		self.entry()
		process_user_digest(self.user)
		self.mail.assert_called_once()
		self.assertEqual(sum(row.status == "Pending" for row in self.deliveries()), 1)
		with patch(
			"verein.donation_management.notifications.now_datetime",
			return_value=now_datetime() + timedelta(days=1),
		):
			process_user_digest(self.user)
		self.assertEqual(self.mail.call_count, 2)

	def test_queue_failure_can_be_retried(self):
		self.save()
		self.entry()
		self.mail.side_effect = RuntimeError("queue unavailable")
		with self.assertRaises(RuntimeError):
			process_user_digest(self.user)
		self.assertEqual(self.deliveries()[0]["status"], "Pending")
		self.assertIsNone(frappe.db.get_value(PREFERENCES, self.user, "last_digest_date"))
		self.mail.side_effect = None
		process_user_digest(self.user)
		self.assertEqual(self.deliveries()[0]["status"], "Queued")

	def test_booking_rollback_also_rolls_back_notification(self):
		self.save()
		frappe.db.savepoint("before_notification_booking")
		self.entry()
		self.assertEqual(len(self.deliveries()), 1)
		frappe.db.rollback(save_point="before_notification_booking")
		self.assertEqual(self.deliveries(), [])

	def test_html_escaping_and_language_restoration(self):
		self.save()
		frappe.db.set_value("User", self.user, "language", "de")
		frappe.db.set_value("Supporter", self.supporter.name, "full_name", "<script>bad</script>")
		self.entry()
		previous_lang = frappe.local.lang
		process_user_digest(self.user)
		self.assertEqual(frappe.local.lang, previous_lang)
		message = self.mail.call_args.kwargs["message"]
		self.assertIn("&lt;script&gt;", message)
		self.assertNotIn("<script>", message)
