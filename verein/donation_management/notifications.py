from __future__ import annotations

import hashlib
import math
from html import escape

import frappe
from frappe import _
from frappe.utils import (
	cint,
	flt,
	fmt_money,
	formatdate,
	get_datetime,
	get_system_timezone,
	get_url,
	now_datetime,
)

from verein.donation_management.cost_center_dashboard import get_accessible_cost_centers
from verein.donation_management.permissions import has_cost_center_access

PREFERENCES = "Donation Notification Preferences"
RULE = "Donation Notification Rule"
DELIVERY = "Donation Notification Delivery"
PAGE_ROLES = {"System Manager", "Donation Management Manager", "Donation Management User"}


def eligible_user(user: str) -> bool:
	return user != "Guest" and bool(
		frappe.db.get_value("User", user, "enabled") and PAGE_ROLES.intersection(frappe.get_roles(user))
	)


def require_user() -> str:
	user = frappe.session.user
	if not eligible_user(user):
		frappe.throw(_("You are not allowed to manage donation notifications."), frappe.PermissionError)
	return user


@frappe.whitelist()
def get_notification_settings() -> dict:
	user = require_user()
	cost_centers = [row for row in get_accessible_cost_centers() if not row.is_group]
	for row in cost_centers:
		row["currency"] = frappe.get_cached_value("Company", row.company, "default_currency")
	allowed = {row.name for row in cost_centers}
	rules = frappe.get_all(
		RULE,
		filters={"parent": user, "parenttype": PREFERENCES, "parentfield": "rules"},
		fields=["cost_center", "notify_new_donor", "notify_large_donation", "threshold"],
		order_by="idx asc",
	)
	return {
		"email": frappe.db.get_value("User", user, "email"),
		"timezone": get_system_timezone(),
		"cost_centers": cost_centers,
		"rules": [row for row in rules if row.cost_center in allowed],
	}


@frappe.whitelist(methods=["POST"])
def save_notification_settings(settings: dict | str) -> dict:
	user = require_user()
	settings = frappe.parse_json(settings) if isinstance(settings, str) else settings
	if not isinstance(settings, dict) or not isinstance(settings.get("rules"), list):
		frappe.throw(_("Invalid notification settings."))
	# Also serialize the first save, before a preferences row exists.
	frappe.db.get_value("User", user, "name", for_update=True)
	if frappe.db.exists(PREFERENCES, user):
		doc = frappe.get_doc(PREFERENCES, user, for_update=True)
	else:
		doc = frappe.get_doc({"doctype": PREFERENCES, "user": user})
	doc.set("rules", [])
	for row in settings["rules"]:
		if not isinstance(row, dict):
			frappe.throw(_("Invalid notification settings."))
		doc.append(
			"rules",
			{
				key: row.get(key)
				for key in ("cost_center", "notify_new_donor", "notify_large_donation", "threshold")
			},
		)
	doc.save(ignore_permissions=True)
	return get_notification_settings()


def validate_preferences(doc) -> None:
	user = require_user()
	if doc.user != user:
		frappe.throw(_("You can only change your own notification settings."), frappe.PermissionError)
	previous = doc.get_doc_before_save()
	old_rules = {row.cost_center: row for row in previous.rules} if previous else {}
	seen = set()
	for row in doc.rules:
		if row.cost_center in seen:
			frappe.throw(_("Select each cost center only once."))
		seen.add(row.cost_center)
		if not available_cost_center(row.cost_center, user):
			frappe.throw(
				_("Select an accessible, active cost center that is not a group."), frappe.PermissionError
			)
		row.notify_new_donor = int(bool(cint(row.notify_new_donor)))
		row.notify_large_donation = int(bool(cint(row.notify_large_donation)))
		row.threshold = flt(row.threshold)
		if row.notify_large_donation and (not math.isfinite(row.threshold) or row.threshold <= 0):
			frappe.throw(_("Enter a positive threshold for large donations."))
		if not row.notify_large_donation:
			row.threshold = 0
		old = old_rules.get(row.cost_center)
		unchanged = old and all(
			row.get(key) == old.get(key) for key in ("notify_new_donor", "notify_large_donation", "threshold")
		)
		row.active_since = old.active_since if unchanged else now_datetime()
	# These values cannot be supplied through generic document APIs either.
	doc.last_digest_date = previous.last_digest_date if previous else None


def available_cost_center(cost_center: str, user: str) -> bool:
	return bool(
		cost_center
		and frappe.db.exists("Cost Center", {"name": cost_center, "disabled": 0, "is_group": 0})
		and has_cost_center_access(cost_center, user=user)
	)


def preferences_query(user: str | None = None) -> str:
	return f"`tab{PREFERENCES}`.`user` = {frappe.db.escape(user or frappe.session.user)}"


def preferences_permission(doc, ptype: str, user: str | None = None, **kwargs) -> bool:
	return ptype == "read" and doc.user == (user or frappe.session.user)


def is_donation(entry) -> bool:
	return bool(
		entry
		and entry.docstatus == 1
		and not entry.is_cancelled
		and entry.get("supporter")
		and entry.cost_center
		and entry.voucher_type != "Period Closing Voucher"
		and entry.is_opening != "Yes"
		and flt(entry.credit) - flt(entry.debit) > 0
		and frappe.get_cached_value("Account", entry.account, "root_type") == "Income"
	)


def record_donation(doc, method=None) -> None:
	"""Persist candidates in the GL transaction. Never send mail during accounting."""
	if doc.flags.from_repost or not is_donation(doc):
		return
	rules = frappe.get_all(
		RULE,
		filters={"cost_center": doc.cost_center, "parenttype": PREFERENCES, "parentfield": "rules"},
		fields=["parent", "active_since", "notify_new_donor", "notify_large_donation"],
	)
	for rule in rules:
		if not (rule.notify_new_donor or rule.notify_large_donation):
			continue
		user = rule.parent
		if not eligible_user(user) or not available_cost_center(doc.cost_center, user):
			continue
		# The deterministic primary key makes repeated hooks harmless.
		name = hashlib.sha256(f"{user}\0{doc.name}".encode()).hexdigest()
		if frappe.db.exists(DELIVERY, name):
			continue
		frappe.get_doc(
			{
				"doctype": DELIVERY,
				"name": name,
				"user": user,
				"gl_entry": doc.name,
				"cost_center": doc.cost_center,
				"active_since": rule.active_since,
				"status": "Pending",
			}
		).insert(ignore_permissions=True)


def is_first_donation(entry) -> bool:
	"""Use registration order, not posting dates, including pre-feature history."""
	first = frappe.db.sql(
		"""select gle.name from `tabGL Entry` gle
		inner join `tabAccount` account on account.name = gle.account
		where gle.cost_center = %(cost_center)s and gle.supporter = %(supporter)s
		and gle.docstatus = 1 and gle.is_cancelled = 0 and gle.credit > gle.debit
		and account.root_type = 'Income'
		and coalesce(gle.voucher_type, '') != 'Period Closing Voucher'
		and coalesce(gle.is_opening, 'No') != 'Yes'
		order by gle.creation asc, gle.name asc limit 1""",
		{"cost_center": entry.cost_center, "supporter": entry.supporter},
	)
	return bool(first and first[0][0] == entry.name)


def send_daily_digests() -> None:
	"""A failure for one recipient must not lose other recipients' digests."""
	for user in frappe.get_all(DELIVERY, filters={"status": "Pending"}, pluck="user", distinct=True):
		try:
			process_user_digest(user)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title="Donation notification digest failed")


def process_user_digest(user: str) -> None:
	# Saves and concurrent scheduler invocations serialize on this same row.
	if not frappe.db.exists(PREFERENCES, user):
		frappe.db.set_value(DELIVERY, {"user": user, "status": "Pending"}, "status", "Skipped")
		return
	prefs = frappe.get_doc(PREFERENCES, user, for_update=True)
	now = now_datetime()
	if prefs.last_digest_date and str(prefs.last_digest_date) == now.date().isoformat():
		return
	pending = frappe.get_all(
		DELIVERY,
		filters={"user": user, "status": "Pending"},
		fields=["name", "gl_entry", "cost_center", "active_since"],
		order_by="creation asc, name asc",
	)
	if not pending:
		return
	rules = {row.cost_center: row for row in prefs.rules}
	user_doc = frappe.get_doc("User", user)
	enabled = eligible_user(user)
	hits = []
	for delivery in pending:
		rule = rules.get(delivery.cost_center)
		if not enabled or not rule or not available_cost_center(delivery.cost_center, user):
			continue
		if get_datetime(rule.active_since) != get_datetime(delivery.active_since):
			continue
		if not frappe.db.exists("GL Entry", delivery.gl_entry):
			continue
		entry = frappe.get_doc("GL Entry", delivery.gl_entry)
		if not is_donation(entry) or entry.cost_center != delivery.cost_center:
			continue
		new_donor = bool(rule.notify_new_donor and is_first_donation(entry))
		large_donation = bool(
			rule.notify_large_donation and flt(entry.credit) - flt(entry.debit) >= rule.threshold
		)
		if new_donor or large_donation:
			hits.append(
				{
					"entry": entry,
					"delivery": delivery.name,
					"new_donor": new_donor,
					"large_donation": large_donation,
				}
			)
	queue = None
	if hits:
		previous_lang = frappe.local.lang
		try:
			frappe.local.lang = user_doc.language or frappe.get_system_settings("language") or "en"
			queue = frappe.sendmail(
				recipients=[user_doc.email],
					subject=_("New donation"),
				message=render_digest(hits),
				delayed=True,
				now=False,
				add_unsubscribe_link=False,
				is_notification=True,
			)
			if not queue:
				frappe.throw(_("The donation summary could not be added to the email queue."))
		finally:
			frappe.local.lang = previous_lang
		prefs.db_set("last_digest_date", now.date(), update_modified=False)
	hit_names = {hit["delivery"] for hit in hits}
	for delivery in pending:
		frappe.db.set_value(
			DELIVERY,
			delivery.name,
			{
				"status": "Queued" if delivery.name in hit_names else "Skipped",
				"email_queue": queue.name if delivery.name in hit_names else None,
			},
			update_modified=False,
		)


def render_digest(hits: list[dict]) -> str:
	groups = {}
	for hit in hits:
		groups.setdefault(hit["entry"].cost_center, []).append(hit)
	parts = [
		'<div style="max-width:600px;margin:0 auto;padding:8px 0;'
		'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;'
		'background-color:#ffffff;text-align:left;">'
		'<h2 style="margin:0 0 24px;font-size:22px;line-height:1.3;font-weight:700;color:#111827;">'
		f"{escape(_('Donation summary'))}</h2>"
	]
	for cost_center, rows in groups.items():
		center = frappe.get_doc("Cost Center", cost_center)
		parts.append(
			'<h3 style="margin:24px 0 4px;font-size:16px;line-height:1.5;font-weight:700;color:#374151;">'
			f'{escape(center.cost_center_name)}</h3><ul style="margin:0;padding:0;list-style:none;">'
		)
		for hit in rows:
			entry = hit["entry"]
			name = frappe.db.get_value("Supporter", entry.supporter, "full_name") or entry.supporter
			currency = frappe.get_cached_value("Company", entry.company, "default_currency")
			reasons = []
			if hit["new_donor"]:
				reasons.append(_("New donor"))
			if hit["large_donation"]:
				reasons.append(_("Donation at or above threshold"))
			amount = escape(fmt_money(flt(entry.credit) - flt(entry.debit), currency=currency))
			parts.append(
				'<li style="margin:0;padding:16px 0;list-style:none;border-bottom:1px solid #e5e7eb;">'
				'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
				'style="width:100%;border-collapse:collapse;border:0;"><tr>'
				'<td valign="top" style="padding:0 16px 0 0;border:0;font-family:Arial,Helvetica,sans-serif;'
				'font-size:15px;line-height:1.5;color:#111827;overflow-wrap:anywhere;">'
				f'<strong>{escape(name)}</strong></td>'
				'<td align="right" valign="top" width="1%" style="padding:0;border:0;'
				'font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;'
				f'font-weight:700;white-space:nowrap;color:#111827;">{amount}</td></tr></table>'
				'<div style="margin-top:4px;font-size:13px;line-height:1.5;color:#6b7280;">'
				f'{escape(formatdate(entry.posting_date))}</div>'
				'<div style="margin-top:6px;font-size:13px;line-height:1.5;color:#374151;">'
				f'{escape(" · ".join(reasons))}</div></li>'
			)
		parts.append("</ul>")
	bookings_url = escape(get_url("/app/cost-center-bookings"), quote=True)
	settings_url = escape(get_url("/app/donation-notifications"), quote=True)
	parts.append(
		'<div style="margin-top:24px;">'
		f'<a href="{bookings_url}" style="display:inline-block;padding:11px 18px;'
		'border:1px solid #1f2937;border-radius:6px;background-color:#1f2937;'
		'color:#ffffff !important;font-size:14px;line-height:1.5;font-weight:600;text-decoration:none !important;">'
		f'{escape(_("View bookings"))}</a></div>'
		'<div style="margin-top:16px;font-size:12px;line-height:1.5;">'
		f'<a href="{settings_url}" style="color:#6b7280 !important;text-decoration:underline;font-weight:400 !important;">'
		f'{escape(_("Manage my donation notifications"))}</a></div></div>'
	)
	return "".join(parts)
