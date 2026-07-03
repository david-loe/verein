from __future__ import annotations

from typing import Any

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, now_datetime

from verein.donation_management.permissions import (
	can_review_supporter_contact_change_requests,
	get_descendant_cost_centers,
	has_cost_center_access,
)

ALLOWED_CHANGE_FIELDS = {
	"first_name": _("First Name"),
	"last_name": _("Last Name"),
	"email_address": _("Email Address"),
	"phone": _("Phone"),
	"address_line_1": _("Address Line 1"),
	"address_line_2": _("Address Line 2"),
	"postal_code": _("Postal Code"),
	"city": _("City"),
	"country": _("Country"),
}
PENDING = "Pending"
APPROVED = "Approved"
REJECTED = "Rejected"


class SupporterContactChangeRequest(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF
		from verein.donation_management.doctype.supporter_contact_change_request_field.supporter_contact_change_request_field import SupporterContactChangeRequestField

		changes: DF.Table[SupporterContactChangeRequestField]
		cost_center: DF.Link
		from_date: DF.Date | None
		requested_by: DF.Link | None
		requested_on: DF.Datetime | None
		review_note: DF.SmallText | None
		reviewed_by: DF.Link | None
		reviewed_on: DF.Datetime | None
		status: DF.Literal["Pending", "Approved", "Rejected"]
		supporter: DF.Link
		to_date: DF.Date | None
	# end: auto-generated types

	def before_insert(self) -> None:
		self.requested_by = self.requested_by or frappe.session.user
		self.requested_on = self.requested_on or now_datetime()
		self.status = PENDING

	def validate(self) -> None:
		self.validate_supporter_access()
		self.validate_status()
		self.validate_changes()

	def validate_supporter_access(self) -> None:
		if not can_review_supporter_contact_change_requests() and not has_cost_center_access(self.cost_center):
			frappe.throw(_("You are not allowed to access this cost center."))

		if not supporter_has_income_for_cost_center(
			self.supporter,
			self.cost_center,
			self.from_date,
			self.to_date,
		):
			frappe.throw(_("The supporter has no donations for this cost center in the selected period."))

	def validate_status(self) -> None:
		if self.status not in {PENDING, APPROVED, REJECTED}:
			frappe.throw(_("Invalid status: {0}").format(self.status))

	def validate_changes(self) -> None:
		if not self.changes:
			frappe.throw(_("At least one change is required."))

		seen = set()
		for row in self.changes:
			if row.fieldname not in ALLOWED_CHANGE_FIELDS:
				frappe.throw(_("Field {0} cannot be changed through this request.").format(row.fieldname))
			if row.fieldname in seen:
				frappe.throw(_("Field {0} is listed more than once.").format(row.fieldname))
			seen.add(row.fieldname)
			row.field_label = ALLOWED_CHANGE_FIELDS[row.fieldname]

	def approve(self, review_note: str | None = None) -> dict[str, str]:
		assert_can_review()
		if self.status != PENDING:
			frappe.throw(_("Only pending requests can be approved."))

		supporter = frappe.get_doc("Supporter", self.supporter)
		for row in self.changes:
			supporter.set(row.fieldname, row.requested_value or None)
		supporter.save(ignore_permissions=True)

		self.status = APPROVED
		self.review_note = review_note
		self.reviewed_by = frappe.session.user
		self.reviewed_on = now_datetime()
		self.save(ignore_permissions=True)
		return {"status": self.status}

	def reject(self, review_note: str | None = None) -> dict[str, str]:
		assert_can_review()
		if self.status != PENDING:
			frappe.throw(_("Only pending requests can be rejected."))

		self.status = REJECTED
		self.review_note = review_note
		self.reviewed_by = frappe.session.user
		self.reviewed_on = now_datetime()
		self.save(ignore_permissions=True)
		return {"status": self.status}


def assert_can_review() -> None:
	if not can_review_supporter_contact_change_requests():
		frappe.throw(_("You are not allowed to review supporter contact change requests."))


def supporter_has_income_for_cost_center(
	supporter: str,
	cost_center: str,
	from_date: str | None,
	to_date: str | None,
) -> bool:
	if not supporter or not cost_center:
		return False

	from verein.donation_management.cost_center_dashboard import normalize_period

	normalized_from_date, normalized_to_date = normalize_period(from_date, to_date)
	cost_centers = get_descendant_cost_centers(cost_center)
	if not cost_centers:
		return False

	row = frappe.db.sql(
		"""
		select sum(`tabGL Entry`.`credit` - `tabGL Entry`.`debit`) as amount
		from `tabGL Entry`
		inner join `tabAccount` on `tabAccount`.`name` = `tabGL Entry`.`account`
		where
			`tabGL Entry`.`is_cancelled` = 0
			and `tabGL Entry`.`supporter` = %(supporter)s
			and `tabGL Entry`.`cost_center` in %(cost_centers)s
			and `tabGL Entry`.`posting_date` between %(from_date)s and %(to_date)s
			and `tabAccount`.`root_type` = 'Income'
		""",
		{
			"supporter": supporter,
			"cost_centers": tuple(cost_centers),
			"from_date": normalized_from_date,
			"to_date": normalized_to_date,
		},
		as_dict=True,
	)[0]
	return flt(row.amount) > 0


def make_change_request(
	supporter: str,
	cost_center: str,
	from_date: str | None,
	to_date: str | None,
	changes: dict[str, Any],
) -> SupporterContactChangeRequest:
	changes = frappe.parse_json(changes) or {}
	supporter_doc = frappe.get_doc("Supporter", supporter)
	doc = frappe.get_doc(
		{
			"doctype": "Supporter Contact Change Request",
			"supporter": supporter,
			"cost_center": cost_center,
			"from_date": from_date,
			"to_date": to_date,
		}
	)

	for fieldname, requested_value in (changes or {}).items():
		if fieldname not in ALLOWED_CHANGE_FIELDS:
			frappe.throw(_("Field {0} cannot be changed through this request.").format(fieldname))

		current_value = supporter_doc.get(fieldname)
		requested_value = requested_value or None
		if (current_value or None) == requested_value:
			continue

		doc.append(
			"changes",
			{
				"fieldname": fieldname,
				"field_label": ALLOWED_CHANGE_FIELDS[fieldname],
				"current_value": current_value,
				"requested_value": requested_value,
			},
		)

	doc.insert()
	return doc


@frappe.whitelist()
def approve_request(name: str, review_note: str | None = None) -> dict[str, str]:
	return frappe.get_doc("Supporter Contact Change Request", name).approve(review_note)


@frappe.whitelist()
def reject_request(name: str, review_note: str | None = None) -> dict[str, str]:
	return frappe.get_doc("Supporter Contact Change Request", name).reject(review_note)
